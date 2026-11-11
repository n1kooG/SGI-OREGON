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

## Cambio de contraseña (API, sin pantalla)

`PUT /api/auth/clave` con `Authorization: Bearer <token>` y cuerpo `{ "actual": "...", "nueva": "..." }`.

- Política de la nueva clave: mínimo 12 caracteres, máximo 72 bytes (límite de bcrypt), distinta de la actual y
  distinta de la clave de ejemplo (`src/politicaClave.js`). Rechazo: `400` con código `CLAVE_NO_VALIDA`.
- Clave actual incorrecta: `403` `CLAVE_ACTUAL_INCORRECTA`; cuenta como intento fallido (bloqueo tras `MAX_INTENTOS`).
  Con la cuenta bloqueada: `423`.
- Éxito: `200 { "mensaje": "Contraseña actualizada" }`. Hash bcrypt costo 12, intentos y bloqueo en cero, evento
  `CLAVE_CAMBIADA` en la bitácora (sin claves) y revocación de las sesiones activas del usuario: debe iniciar sesión
  de nuevo con la clave nueva.

## Scripts de administración

Se ejecutan en el servidor, con `node --env-file=.env`. Usan `DATABASE_URL_MIGRACION` (rol propietario) y, si falta,
`DATABASE_URL`. La clave **nunca** va como argumento: por stdin o variable de entorno.

```bash
# Primer arranque de producción (sin datos de ejemplo): roles + primer administrador. Se niega si ya hay uno.
ADMIN_EMAIL=jefatura@tienda.cl ADMIN_RUT=12.345.678-5 ADMIN_NOMBRE='Jefatura' \
  node --env-file=.env scripts/arranque-produccion.mjs < clave.txt      # clave en la primera línea; o ADMIN_CLAVE
# Restablecer la clave de un usuario (reinicia el bloqueo y deja CLAVE_RESTABLECIDA en la bitácora)
node --env-file=.env scripts/clave-usuario.mjs correo@tienda.cl < clave.txt   # o CLAVE_NUEVA
```

Orden de un despliegue nuevo: `db/01_modelo_datos.sql` → `db/07_rol_aplicacion.sql` → `scripts/arranque-produccion.mjs`
(`db/02_datos_ejemplo.sql` es solo desarrollo y trae la clave de ejemplo pública). El administrador inicial no tiene
marca de «cambio obligatorio» (no existe esa columna): debe rotar su clave tras el primer ingreso con
`PUT /api/auth/clave` o con `clave-usuario.mjs`. Los permisos de los roles viven en `db/roles_permisos.sql`
(fuente única del seed y del arranque).

## Entrega, rechazo y resúmenes de Bodega

Migración para bases existentes (idempotente): `psql -d sgi_oregon -f db/09_firma_y_reingreso.sql` (columnas de firma, receptor
y reingreso en `despacho`, transición `RECHAZADO → EN_CAMION`, permisos `entregas:reingresar` y `pedidos:documentar`). Las bases
nuevas la traen en `db/01_modelo_datos.sql` y `db/roles_permisos.sql`.

Decisiones de modelo: `despacho.id_orden` deja de ser `UNIQUE` y pasa a un índice único parcial (un solo despacho `PENDIENTE` por
pedido), de modo que un rechazo reprogramado conserva su historial de intentos. `RECHAZADO → EN_CAMION` solo lo permite el trigger
si el último despacho del pedido está rechazado **y reingresado**. Los listados de pedidos toman el último despacho.

| Método y ruta | Permiso | Cuerpo → respuesta |
|---|---|---|
| `PATCH /api/despachos/:id` | `entregas:registrar` (CHOFER) | JSON o multipart: `estado` (ENTREGADO/RECHAZADO), `motivo`, `latitud`, `longitud`, `nombre_receptor` (≤120), archivos `foto` (JPG/PNG) y `firma` (PNG, ≤1 MB). Firma y receptor solo aplican a ENTREGADO (400 en RECHAZADO). → `{ id_despacho, id_orden, estado_entrega, evidencia, firma, nombre_receptor }` |
| `POST /api/despachos/:id/reingresar` | `entregas:reingresar` (BODEGA, ADMIN) | sin cuerpo → `{ id_despacho, id_orden, estado_orden: "EN_CAMION", unidades, reingresado_en }`. 409 `NO_RECHAZADO` / `YA_REINGRESADO`; 404 |
| `GET /api/despachos/historial?pagina=1&limite=20` | `ruta:leer` (CHOFER) | → `{ total, pagina, limite, items[] }` con las columnas de `mi-ruta`, solo entregas cerradas del chofer, la más reciente primero (`limite` 1–100) |
| `GET /api/despachos/:id` | `ruta:leer` (CHOFER) | → parada con `items: [{ sku, nombre, modelo, cantidad }]`, `motivo_rechazo`, `nombre_receptor`, `tiene_firma`; 404 si es de otro chofer. Sin precios ni costos |
| `GET /api/despachos/mi-ruta/resumen` | `ruta:leer` (CHOFER) | → `{ pendientes, entregadas, rechazadas }` (entregadas y rechazadas = cerradas hoy). `mi-ruta` sigue devolviendo un arreglo y ahora incluye `nombre_receptor` y `tiene_firma` |
| `GET /api/pedidos?por_reingresar=1` | `pedidos:leer` o `pedidos:preparar` | → solo RECHAZADO sin reingreso. Todos los listados y `GET /api/pedidos/:id` traen `motivo_rechazo`, `nombre_receptor`, `reingresado_en`, `reingresado` (el detalle también `tiene_firma`) |
| `GET /api/pedidos/resumen` | `pedidos:leer` o `pedidos:preparar` | → `{ pendiente_preparacion, armado, etiquetado, en_camion_esperando_chofer, rechazados_por_reingresar }` |
| `GET /api/inventario/resumen` | `inventario:consultar` o `inventario:leer` | → `{ sin_ubicacion, stock_critico }` |
| `GET /api/compras/descargas/pendientes` | `compras:confirmar_descarga` o `compras:recepcionar` | → `[{ id_recepcion, numero_factura, nombre_proveedor, fecha_emision, fecha_recepcion, unidades, detalle: [{ sku, cantidad }] }]`, de la más antigua a la más reciente; sin montos |
| `PATCH /api/pedidos/:id/documento` | `pedidos:documentar` (ADMIN) | `{ numero_documento }` (solo dígitos y guion, ≤20; vacío o `null` lo quita) → `{ id_orden, numero_documento_sii }`; audita `DOCUMENTO_SII` |

La firma se guarda en S3 como `firmas/<id_despacho>.png` (igual que `evidencias/<id>.<ext>`) y se audita solo su clave. Con
`STORAGE_ENABLED=false` la imagen se descarta sin error y `url_firma_s3` queda `NULL`; el nombre del receptor sí se guarda.
Firma y receptor son opcionales; con `EXIGIR_RECEPTOR_ENTREGA=true` un ENTREGADO sin ninguno de los dos responde 400
`RECEPTOR_OBLIGATORIO`. El reingreso suma el stock de cada línea (los observers de stock crítico se notifican tras el commit),
marca `reingresado_en`/`id_usuario_reingreso`, deja el pedido en `EN_CAMION` (listo para `asignar-chofer`, que crea un despacho
nuevo) y audita `REINGRESO` con orden, despacho y unidades, todo en una transacción.

## Producción

Con `NODE_ENV=production` la API no arranca si `JWT_SECRET` tiene menos de 32 caracteres o es el valor de ejemplo.
Genera uno con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Hallazgos de la auditoría pendientes

No se abordaron en este trabajo: límite de memoria al leer `.xlsx` (bomba de descompresión), paginación del listado de
pedidos, reasignación de despachos al dar de baja a un chofer, límite de
peticiones en el login, revocación individual de tokens (`jti`/logout; el cambio de clave revoca las sesiones por
usuario) y los hallazgos Bajo/Informativos restantes.
