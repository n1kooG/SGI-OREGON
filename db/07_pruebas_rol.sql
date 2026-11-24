-- =====================================================================
-- SGI Tienda Oregón - Pruebas del rol de aplicación (mínimos privilegios, bitácora inmutable)
-- Ejecutar CONECTADO COMO EL ROL DE LA APLICACIÓN sobre una base con 01, 02 y 07 cargados:
--   PGPASSWORD="$SGI_APP_PASSWORD" psql -h localhost -U sgi_app -d sgi_oregon -f db/07_pruebas_rol.sql
-- Todo se revierte al final (ROLLBACK): no deja filas en audit_log ni cambios en los datos.
-- =====================================================================
\set ON_ERROR_STOP off
BEGIN;
CREATE TEMP TABLE resultado (id TEXT, prueba TEXT, esperado TEXT, obtenido TEXT, ok BOOLEAN);

-- Espera que `p_sql` falle con `p_sqlstate`.
CREATE FUNCTION pg_temp.espera_error(p_id TEXT, p_prueba TEXT, p_sqlstate TEXT, p_sql TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_state TEXT := 'sin error';
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  INSERT INTO resultado VALUES (p_id, p_prueba, p_sqlstate, v_state, v_state = p_sqlstate);
END $$;

-- Espera que `p_sql` se ejecute sin error (el efecto se descarta con una subtransacción).
CREATE FUNCTION pg_temp.espera_ok(p_id TEXT, p_prueba TEXT, p_sql TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_estado TEXT := 'ejecutado';
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'revertir prueba';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
            WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
  END;
  INSERT INTO resultado VALUES (p_id, p_prueba, 'ejecutado', v_estado, v_estado = 'ejecutado');
END $$;

CREATE FUNCTION pg_temp.espera_valor(p_id TEXT, p_prueba TEXT, p_esperado TEXT, p_sql TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  EXECUTE p_sql INTO v;
  INSERT INTO resultado VALUES (p_id, p_prueba, p_esperado, v, v = p_esperado);
END $$;

\o /dev/null
-- ---- Identidad del rol ----------------------------------------------------------------------
SELECT pg_temp.espera_valor('ROL-01', 'La aplicación no es superusuaria ni crea roles/bases', 'false',
  $q$SELECT (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)::text FROM pg_roles WHERE rolname = current_user$q$);
SELECT pg_temp.espera_valor('ROL-02', 'La aplicación no es dueña de ninguna tabla, vista ni función del esquema', '0',
  $q$SELECT (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND pg_get_userbyid(c.relowner) = current_user)::text$q$);

-- ---- La bitácora no se puede alterar ni desactivar -----------------------------------------
SELECT pg_temp.espera_error('AUD-01', 'audit_log: UPDATE rechazado', '42501', $q$UPDATE audit_log SET accion = 'ALTERADO'$q$);
SELECT pg_temp.espera_error('AUD-02', 'audit_log: DELETE rechazado', '42501', $q$DELETE FROM audit_log$q$);
SELECT pg_temp.espera_error('AUD-03', 'audit_log: TRUNCATE rechazado', '42501', $q$TRUNCATE audit_log$q$);
SELECT pg_temp.espera_error('AUD-04', 'audit_log: ALTER TABLE ... DISABLE TRIGGER (uno) rechazado', '42501',
  $q$ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_no_update_delete$q$);
SELECT pg_temp.espera_error('AUD-05', 'audit_log: ALTER TABLE ... DISABLE TRIGGER ALL rechazado', '42501',
  $q$ALTER TABLE audit_log DISABLE TRIGGER ALL$q$);
SELECT pg_temp.espera_error('AUD-06', 'audit_log: DROP TRIGGER rechazado', '42501',
  $q$DROP TRIGGER trg_audit_log_no_update_delete ON audit_log$q$);
SELECT pg_temp.espera_error('AUD-07', 'audit_log: crear un trigger propio rechazado', '42501',
  $q$CREATE TRIGGER trg_x BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fn_audit_log_inmutable()$q$);
SELECT pg_temp.espera_error('AUD-08', 'audit_log: DROP TABLE rechazado', '42501', $q$DROP TABLE audit_log$q$);
SELECT pg_temp.espera_error('AUD-09', 'audit_log: cambiarse el dueño rechazado', '42501', $q$ALTER TABLE audit_log OWNER TO CURRENT_USER$q$);
SELECT pg_temp.espera_error('AUD-10', 'Reemplazar la función que garantiza la inmutabilidad rechazado', '42501',
  $q$CREATE OR REPLACE FUNCTION fn_audit_log_inmutable() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'$q$);
SELECT pg_temp.espera_error('AUD-11', 'SET session_replication_role = replica rechazado', '42501',
  $q$SET session_replication_role = replica$q$);
SELECT pg_temp.espera_error('AUD-12', 'set_config(session_replication_role) también rechazado', '42501',
  $q$SELECT set_config('session_replication_role', 'replica', false)$q$);
SELECT pg_temp.espera_valor('AUD-13', 'audit_log: privilegios efectivos = solo SELECT e INSERT', 'INSERT,SELECT',
  $q$SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      WHERE has_table_privilege(current_user, 'audit_log', p)$q$);
SELECT pg_temp.espera_error('AUD-14', 'No puede crear objetos en el esquema public', '42501', $q$CREATE TABLE tabla_intrusa (x INT)$q$);

-- ---- Otras tablas: sin DELETE ni cambio de estructura ---------------------------------------
SELECT pg_temp.espera_error('PRV-01', 'usuario: DELETE rechazado', '42501', $q$DELETE FROM usuario$q$);
SELECT pg_temp.espera_error('PRV-02', 'detalle_venta: DELETE rechazado', '42501', $q$DELETE FROM detalle_venta$q$);
SELECT pg_temp.espera_error('PRV-03', 'usuario: no puede modificar el RUT ni el correo (UPDATE por columnas)', '42501',
  $q$UPDATE usuario SET email = 'otro@x.cl' WHERE email = 'admin@tiendaoregon.cl'$q$);
SELECT pg_temp.espera_error('PRV-04', 'rol: no puede modificar los permisos', '42501', $q$UPDATE rol SET permisos = '[]'$q$);
SELECT pg_temp.espera_error('PRV-05', 'rol: no puede crear roles de negocio', '42501', $q$INSERT INTO rol (nombre_rol, descripcion) VALUES ('X','x')$q$);
SELECT pg_temp.espera_error('PRV-06', 'ALTER TABLE usuario rechazado', '42501', $q$ALTER TABLE usuario DISABLE TRIGGER ALL$q$);
SELECT pg_temp.espera_error('PRV-07', 'detalle_venta: UPDATE rechazado (no se usa)', '42501', $q$UPDATE detalle_venta SET cantidad_vendida = 1$q$);
SELECT pg_temp.espera_error('PRV-08', 'No puede crear roles', '42501', $q$CREATE ROLE intruso$q$);
SELECT pg_temp.espera_error('PRV-09', 'detalle_recepcion: DELETE rechazado', '42501', $q$DELETE FROM detalle_recepcion$q$);
SELECT pg_temp.espera_error('PRV-10', 'recepcion_compra: DELETE rechazado', '42501', $q$DELETE FROM recepcion_compra$q$);
SELECT pg_temp.espera_error('PRV-11', 'orden_venta: DELETE rechazado', '42501', $q$DELETE FROM orden_venta$q$);

-- ---- Borrar un producto sin historial: DELETE solo sobre producto, inventario y lista_precio ----
SELECT pg_temp.espera_ok('DEL-01', 'producto, inventario y lista_precio: DELETE permitido (producto sin historial)',
  $q$WITH p AS (INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto) VALUES ('ZZ-DEL','m','n','x',1000) RETURNING sku),
          i AS (INSERT INTO inventario (sku) SELECT sku FROM p RETURNING sku),
          l AS (INSERT INTO lista_precio (sku, canal_venta, precio_venta_neto) SELECT sku, 'WEB', 2000 FROM p RETURNING sku)
     SELECT 1 FROM p, i, l$q$);
SELECT pg_temp.espera_valor('DEL-02', 'privilegio DELETE sobre producto, inventario y lista_precio', '3',
  $q$SELECT count(*)::text FROM unnest(ARRAY['producto','inventario','lista_precio']) t WHERE has_table_privilege(current_user, t, 'DELETE')$q$);
SELECT pg_temp.espera_valor('DEL-03', 'sin DELETE sobre audit_log, detalle_recepcion, detalle_venta, recepcion_compra, orden_venta, despacho, usuario', '0',
  $q$SELECT count(*)::text FROM unnest(ARRAY['audit_log','detalle_recepcion','detalle_venta','recepcion_compra','orden_venta','despacho','lote_importacion','usuario']) t WHERE has_table_privilege(current_user, t, 'DELETE')$q$);

-- ---- El flujo normal de la aplicación sí funciona --------------------------------------------
SELECT pg_temp.espera_ok('OK-01', 'audit_log: INSERT permitido (auditar)', $q$INSERT INTO audit_log (id_usuario, tabla_afectada, accion, ip_origen) VALUES (NULL, 'usuario', 'PRUEBA_ROL', '127.0.0.1')$q$);
SELECT pg_temp.espera_ok('OK-02', 'audit_log: SELECT permitido', $q$SELECT 1 FROM audit_log LIMIT 1$q$);
SELECT pg_temp.espera_ok('OK-03', 'login: lectura con crypt() y bloqueo FOR UPDATE de la fila',
  $q$SELECT (password_hash = crypt('x', password_hash)) FROM usuario WHERE lower(email) = 'admin@tiendaoregon.cl' FOR UPDATE OF usuario$q$);
SELECT pg_temp.espera_ok('OK-04', 'login: contador de intentos y último acceso',
  $q$UPDATE usuario SET intentos_fallidos = intentos_fallidos + 1, bloqueado_hasta = now(), ultimo_acceso = now() WHERE lower(email) = 'admin@tiendaoregon.cl'$q$);
SELECT pg_temp.espera_ok('OK-05', 'usuarios: alta y cambio de clave, rol y estado',
  $q$WITH n AS (INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol)
                VALUES ('44.444.444-4', 'Prueba', 'prueba.rol@x.cl', crypt('una-clave-larga-1', gen_salt('bf', 12)), 1) RETURNING id_usuario)
     UPDATE usuario SET password_hash = crypt('otra-clave-larga-2', gen_salt('bf', 12)), clave_cambiada_en = clock_timestamp(), id_rol = 2, activo = false FROM n WHERE usuario.id_usuario = n.id_usuario$q$);
SELECT pg_temp.espera_ok('OK-06', 'catálogo: producto, inventario y precios (alta y cambio)',
  $q$WITH p AS (INSERT INTO producto (sku, modelo, nombre, marca, costo_adquisicion_neto) VALUES ('ZZ-ROL','m','n','x',1000) RETURNING sku),
          i AS (INSERT INTO inventario (sku) SELECT sku FROM p RETURNING sku),
          l AS (INSERT INTO lista_precio (sku, canal_venta, precio_venta_neto) SELECT sku, 'WEB', 2000 FROM p RETURNING sku)
     UPDATE producto SET stock_minimo = 3 WHERE sku IN (SELECT sku FROM p)$q$);
SELECT pg_temp.espera_ok('OK-07', 'compras: recepción, detalle e incremento de stock',
  $q$WITH r AS (INSERT INTO recepcion_compra (id_usuario, numero_factura, rut_proveedor, nombre_proveedor, fecha_emision, forma_pago, monto_neto, monto_iva, monto_total)
                SELECT id_usuario, 'ZZ-1', '78.806.090-4', 'P', CURRENT_DATE, 'Contado', 100, 19, 119 FROM usuario LIMIT 1 RETURNING id_recepcion),
          d AS (INSERT INTO detalle_recepcion (id_recepcion, sku, cantidad_recibida, precio_unitario_neto) SELECT id_recepcion, 'TH-4500', 1, 100 FROM r RETURNING 1)
     UPDATE inventario SET stock_fisico = stock_fisico + 1 WHERE sku = 'TH-4500'$q$);
SELECT pg_temp.espera_ok('OK-08', 'pedidos: lote, orden, detalle, cambio de estado y despacho',
  $q$WITH l AS (INSERT INTO lote_importacion (id_usuario, nombre_archivo, url_archivo_s3, total_ordenes, total_lineas)
                SELECT id_usuario, 'zz.xlsx', 'x', 1, 1 FROM usuario LIMIT 1 RETURNING id_lote),
          o AS (INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, nombre_cliente) SELECT id_lote, 'ZZ-1', 'Web', 'C' FROM l RETURNING id_orden),
          d AS (INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, precio_unitario) SELECT id_orden, 'TH-4500', 1, 100 FROM o RETURNING 1)
     UPDATE orden_venta SET estado_orden = 'ARMADO' WHERE id_orden IN (SELECT id_orden FROM o)$q$);
SELECT pg_temp.espera_ok('OK-09', 'despachos: cierre de entrega', $q$UPDATE despacho SET estado_entrega = 'ENTREGADO', fecha_cierre = now() WHERE false$q$);
SELECT pg_temp.espera_ok('OK-10', 'vista de stock crítico y funciones de validación',
  $q$SELECT count(*), fn_rut_valido('11.111.111-1') FROM v_stock_critico$q$);

\o
\echo
\echo '==================== RESULTADO DE PRUEBAS DEL ROL DE APLICACIÓN ===================='
SELECT current_user AS conectado_como;
SELECT id, prueba, esperado, obtenido, CASE WHEN ok THEN 'OK' ELSE 'FALLA' END AS estado FROM resultado ORDER BY id;
SELECT count(*) AS total, count(*) FILTER (WHERE ok) AS aprobadas, count(*) FILTER (WHERE NOT ok) AS fallidas FROM resultado;
ROLLBACK;
