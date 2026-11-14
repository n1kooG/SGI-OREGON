-- =====================================================================
-- SGI Tienda Oregón - Mínimos privilegios: rol propietario y rol de la aplicación
-- Ejecutar DESPUÉS de 01 (y de 02 solo en desarrollo), conectado como superusuario o como un rol
-- con CREATEROLE que sea dueño de la base. Es idempotente: volver a ejecutarlo reasigna dueños,
-- rehace los GRANT y rota las claves. Vuelve a ejecutarlo tras cada migración que cree tablas.
--
--   SGI_APP_PASSWORD='...' SGI_OWNER_PASSWORD='...' psql -d sgi_oregon -v ON_ERROR_STOP=1 -f db/07_rol_aplicacion.sql
--
-- Variables psql (todas opcionales salvo la clave de la aplicación):
--   owner_role      rol propietario/migración   (por defecto sgi_owner)
--   app_role        rol de la aplicación        (por defecto sgi_app)
--   app_password    o variable de entorno SGI_APP_PASSWORD     (obligatoria)
--   owner_password  o variable de entorno SGI_OWNER_PASSWORD   (si falta, el propietario queda sin LOGIN)
-- Las claves nunca se guardan en el repositorio: se pasan por entorno (no por -v, que queda en el historial).
-- =====================================================================

\if :{?owner_role} \else \set owner_role sgi_owner \endif
\if :{?app_role}   \else \set app_role sgi_app     \endif
\if :{?app_password}   \else \getenv app_password SGI_APP_PASSWORD     \endif
\if :{?owner_password} \else \getenv owner_password SGI_OWNER_PASSWORD \endif
\if :{?owner_password} \else \set owner_password '' \endif
\if :{?app_password} \else
  \echo 'ERROR: define SGI_APP_PASSWORD (o -v app_password=...) con la clave del rol de aplicación'
  \quit
\endif
SELECT (:'owner_role' = :'app_role') AS roles_iguales \gset
\if :roles_iguales
  \echo 'ERROR: owner_role y app_role deben ser distintos'
  \quit
\endif

-- Las claves viajan en ALTER ROLE ... PASSWORD: con log_statement = ddl/all quedarían en el registro del servidor.
-- Como superusuario se desactiva ese registro en esta sesión; si no lo eres (p. ej. RDS), entrega las claves ya
-- cifradas (SGI_APP_PASSWORD='SCRAM-SHA-256$4096:...', PostgreSQL las acepta tal cual) o revisa log_statement.
SELECT current_setting('is_superuser') = 'on' AS es_super \gset
\if :es_super
  SET log_statement = 'none';
\endif

-- ---- Roles --------------------------------------------------------------------------------------
-- Propietario: dueño de tablas, vistas, funciones y triggers; sin SUPERUSER. Se usa solo para migraciones y scripts.
SELECT format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'owner_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner_role') \gexec
-- Aplicación: no es dueña de nada, no es superusuario ni puede crear roles/bases ni saltarse RLS.
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'owner_role', :'owner_password') WHERE :'owner_password' <> '' \gexec
SELECT format('ALTER ROLE %I NOLOGIN', :'owner_role') WHERE :'owner_password' = '' \gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_role', :'app_password') \gexec

-- ---- Propiedad: todo el esquema pasa al propietario (las funciones de extensiones no se tocan) ----
-- (las secuencias de columnas IDENTITY siguen a su tabla)
SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'owner_role') FROM pg_tables WHERE schemaname = 'public' \gexec
SELECT format('ALTER VIEW %I.%I OWNER TO %I', schemaname, viewname, :'owner_role')  FROM pg_views  WHERE schemaname = 'public' \gexec
SELECT format('ALTER FUNCTION %s OWNER TO %I', p.oid::regprocedure, :'owner_role')
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'owner_role') \gexec

-- ---- Privilegios de la aplicación ---------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', :'app_role') \gexec
SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', :'app_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role') \gexec

-- audit_log: solo SELECT e INSERT (sin UPDATE/DELETE/TRUNCATE/TRIGGER).
-- Lo mínimo que usan los repositorios (backend/src/repositories). Sin DELETE ni TRUNCATE salvo la estructura de la bodega:
-- la aplicación no borra datos (las bajas son lógicas) y las claves de las columnas IDENTITY no requieren
-- privilegios sobre la secuencia.
SELECT format('GRANT SELECT ON rol, v_stock_critico TO %I', :'app_role') \gexec
SELECT format('GRANT SELECT, INSERT ON audit_log, detalle_recepcion, detalle_venta TO %I', :'app_role') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE ON producto, inventario, lista_precio, recepcion_compra,
                                               lote_importacion, orden_venta, despacho TO %I', :'app_role') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON bodega_pasillo, bodega_rack TO %I', :'app_role') \gexec
SELECT format('GRANT SELECT, INSERT ON usuario TO %I', :'app_role') \gexec
SELECT format('GRANT UPDATE (id_rol, activo, password_hash, intentos_fallidos, bloqueado_hasta, ultimo_acceso, clave_cambiada_en) ON usuario TO %I', :'app_role') \gexec

-- Las funciones de validación y pgcrypto/pg_trgm siguen ejecutables por PUBLIC (crypt, gen_salt, fn_rut_valido).
-- Lo que la aplicación no puede hacer, y por qué: ALTER/DROP/CREATE TRIGGER, DISABLE TRIGGER, DROP o ALTER TABLE
-- y reemplazar funciones exigen ser dueño; TRIGGER y TRUNCATE no se concedieron; SET session_replication_role
-- exige superusuario (o GRANT SET ON PARAMETER, que no se otorga).
