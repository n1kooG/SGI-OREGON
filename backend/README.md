# Backend (API) - notas técnicas

Node 20+ / Express 4 / PostgreSQL 16 / Redis. Configuración en `.env` (ver `.env.example`).

## Base de datos: roles y privilegios

La inmutabilidad de `audit_log` solo es real si la API **no** es dueña de las tablas: el dueño puede
`ALTER TABLE ... DISABLE TRIGGER`. Por eso se usan dos roles:

| Rol | Uso | Privilegios |
|---|---|---|
| `sgi_owner` (migración) | Crear/modificar el esquema y correr `scripts/*.mjs` de administración | Dueño de tablas, vistas, funciones y triggers. Sin superusuario. **No** se usa en la API. |
| `sgi_app` (aplicación) | `DATABASE_URL` de la API | Solo los `GRANT` que usa el código: `audit_log` SELECT/INSERT; nada de DELETE ni TRUNCATE en ninguna tabla; `usuario` solo actualiza rol, estado, clave e intentos/bloqueo. |

Los nombres son parametrizables. Las claves se pasan por entorno y nunca se guardan en el repositorio.

```bash
# 1. Esquema (y datos de ejemplo solo en desarrollo)
psql -d sgi_oregon -v ON_ERROR_STOP=1 -f db/01_modelo_datos.sql
# 2. Roles y privilegios (como superusuario o dueño de la base); repetir tras cada migración que cree tablas
SGI_APP_PASSWORD='...' SGI_OWNER_PASSWORD='...' psql -d sgi_oregon -v ON_ERROR_STOP=1 \
  -v app_role=sgi_app -v owner_role=sgi_owner -f db/07_rol_aplicacion.sql
```

En `backend/.env`: `DATABASE_URL=postgres://sgi_app:CLAVE@host:5432/sgi_oregon` (con `DB_SSL=true` en RDS) y,
solo para scripts de administración, `DATABASE_URL_MIGRACION=postgres://sgi_owner:CLAVE@host:5432/sgi_oregon`.

### Probar los privilegios

```bash
# Intentos de alterar/desactivar la bitácora y flujo normal, conectado como la aplicación (se revierte todo)
PGPASSWORD="$SGI_APP_PASSWORD" psql -h localhost -U sgi_app -d sgi_oregon -f db/07_pruebas_rol.sql
# Lo mismo desde Node (se omite si la variable no está definida)
TEST_APP_DATABASE_URL=postgres://sgi_app:CLAVE@localhost:5432/sgi_oregon_pruebas npm test
```

### Pruebas del backend

`npm test` corre contra la base indicada en `DATABASE_URL` (usa una base de pruebas, p. ej. `sgi_oregon_pruebas`).
La suite limpia sus propios datos con `DELETE`/`UPDATE` directos, así que **debe correr con un usuario con esos
permisos** (el de desarrollo o el propietario), no con `sgi_app`. Las pruebas de privilegios del rol restringido
son `db/07_pruebas_rol.sql` y `tests/rol_aplicacion.test.js`.

Las claves de los roles viajan en un `ALTER ROLE ... PASSWORD`: el script desactiva `log_statement` en su sesión si
corre como superusuario. Si no (p. ej. RDS), pasa en `SGI_APP_PASSWORD`/`SGI_OWNER_PASSWORD` el verificador SCRAM ya
calculado (`SCRAM-SHA-256$4096:...`; PostgreSQL lo acepta tal cual) para que la clave en claro no llegue al servidor.
