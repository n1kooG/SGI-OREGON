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

## Etiquetas de despacho importadas

El sistema **no genera** etiquetas: cada marketplace (p. ej. Mercado Libre) las exporta en PDF y el administrador las importa.
Esquema para bases existentes (idempotente): `psql -d sgi_oregon -f db/10_etiqueta_importada.sql` (columnas `url_etiqueta`,
`etiqueta_nombre_archivo`, `etiqueta_importada_en` en `orden_venta` y permiso `pedidos:etiquetas` para ADMINISTRADOR). Los pedidos
anteriores quedan sin etiqueta.

| Método y ruta | Permiso | Cuerpo → respuesta |
|---|---|---|
| `PUT /api/pedidos/:id/etiqueta` | `pedidos:etiquetas` (ADMIN) | multipart, campo `archivo` (un PDF de ≤ 2 MB): el administrador lo asigna a mano al pedido (las etiquetas las genera cada marketplace; el sistema no las lee ni las asocia solo). → `{ id_orden, estado: "ASOCIADA" \| "REEMPLAZADA", etiqueta_nombre_archivo, etiqueta_importada_en }`. 400 `ARCHIVO_INVALIDO`, 404; audita `ETIQUETA_IMPORTADA` con `manual: true` |
| `DELETE /api/pedidos/:id/etiqueta` | `pedidos:etiquetas` (ADMIN) | → `{ id_orden }`; borra el archivo y limpia las columnas. 404 `SIN_ETIQUETA` / `NO_ENCONTRADO`; audita `ETIQUETA_ELIMINADA` |
| `GET /api/pedidos/:id/etiqueta` | `pedidos:preparar` o `pedidos:leer` | → PDF (`application/pdf`, `attachment; filename="etiqueta_<codigo_externo>.pdf"`). 404 `SIN_ETIQUETA` si el pedido no tiene; audita `ETIQUETA` |

`GET /api/pedidos` y `GET /api/pedidos/:id` (Administrador y Bodega) incluyen `tiene_etiqueta`, `etiqueta_nombre_archivo` y
`etiqueta_importada_en`; la clave de almacenamiento nunca se expone.

Almacenamiento: con S3 activo el PDF queda en `etiquetas/<id_orden>.pdf` (clave determinista, reemplaza la anterior). Con
`STORAGE_ENABLED=false` (desarrollo) se guarda en disco en `ETIQUETAS_DIR` (por defecto `backend/storage-local/etiquetas/`, ignorado
por git) como `<id_orden>.pdf`. El nombre del archivo subido solo se guarda como texto (sin rutas); nunca forma parte de una ruta.

## Reprogramar entrega, ruta con paradas programadas y productos sin ubicación

Migración para bases existentes (idempotente): `psql -d sgi_oregon -f db/11_reprogramacion.sql`. Agrega la función `fn_hoy()` y, en
`despacho`, `fecha_programada` (DATE, desde cuándo el chofer ve y puede cerrar la parada; los despachos previos toman su
`fecha_asignacion`), `nota_admin` (≤300) e `id_usuario_asigna` (quién asignó o reprogramó; NULL en los despachos anteriores).
Las bases nuevas lo traen en `db/01_modelo_datos.sql`.

**Zona horaria.** «Hoy» es la fecha civil de **`America/Santiago`**, calculada en la base con `fn_hoy()`
(`(now() AT TIME ZONE 'America/Santiago')::date`); no depende de la zona de la sesión ni de la hora del servidor Node. Rige para
validar `fecha_entrega`, para `fecha_programada` por defecto, para el corte «cerradas hoy» y para `FUERA_DE_FECHA`. Las fechas
viajan como texto `AAAA-MM-DD`.

| Método y ruta | Permiso | Cuerpo → respuesta |
|---|---|---|
| `POST /api/pedidos/:id/reprogramar` | `pedidos:asignar_chofer` (ADMIN) | `{ id_chofer, fecha_entrega: "AAAA-MM-DD", nota?, direccion_despacho?, comuna?, telefono_contacto? }` → `{ id_despacho, id_orden, id_usuario_chofer, estado_orden: "EN_RUTA", fecha_programada, nota_admin, ...solo los datos de entrega que cambiaron }`. Una transacción: actualiza los datos de entrega enviados, crea el despacho nuevo (`fecha_programada`, `nota_admin`, `id_usuario_asigna`), pasa el pedido a `EN_RUTA` y audita `REPROGRAMACION` (antes/después de los campos cambiados, más `nota_largo`; la nota completa no se guarda). Límites: `nota` ≤300, `direccion_despacho` ≤200, `comuna` ≤60 (largo real de la columna), `telefono_contacto` ≤20 con solo `+` inicial, dígitos, espacios y guiones; un campo enviado no puede ir vacío. Errores: 400 `VALIDACION` (campos) o `FECHA_PASADA` (anterior a hoy); 401/403; 404; 409 `NO_REPROGRAMABLE` (el pedido no está `EN_CAMION` con su último despacho `RECHAZADO` y reingresado), 409 `TRANSICION_INVALIDA` (el usuario no es un chofer activo; no queda nada a medias) |
| `POST /api/pedidos/:id/asignar-chofer` | `pedidos:asignar_chofer` | Sin cambios de contrato. Ahora fija `fecha_programada` = hoy e `id_usuario_asigna` |
| `GET /api/pedidos` y `GET /api/pedidos/:id` | `pedidos:leer` o `pedidos:preparar` | Cada pedido suma `intento` (N° de despachos), `reprogramado` (`intento > 1`), `fecha_programada` y `nota_admin` del último despacho (NULL si no hay), `fecha_rechazo` (cierre del último despacho si está rechazado, si no NULL) y, en el listado, `direccion_despacho` (ya estaba en el detalle) |
| `GET /api/pedidos/:id` | ídem | Además `intentos: [{ intento, id_despacho, chofer, fecha_asignacion, fecha_programada, estado_entrega, motivo_rechazo, reingresado_en, nota_admin, asignado_por }]` de menor a mayor. `chofer` y `asignado_por` (nombres) solo con `pedidos:leer` (ADMIN); Bodega recibe el resto sin ellos |
| `GET /api/despachos/mi-ruta` | `ruta:leer` (CHOFER) | Sigue siendo un **arreglo**: pendientes de hoy o vencidas (`fecha_programada` ≤ hoy), las cerradas hoy y también las pendientes con fecha futura, con `futura: true` y al final de las pendientes. Cada parada suma `fecha_programada`, `nota_admin`, `futura`, `intento` y `reprogramada` (`intento > 1`) |
| `GET /api/despachos/mi-ruta/resumen` | `ruta:leer` | `pendientes` cuenta solo las de hoy o vencidas (las futuras no); `entregadas` y `rechazadas` = cerradas hoy |
| `GET /api/despachos/:id` y `GET /api/despachos/historial` | `ruta:leer` | Incluyen `fecha_programada`, `nota_admin`, `futura`, `intento` y `reprogramada` |
| `PATCH /api/despachos/:id` | `entregas:registrar` | Cerrar una parada con `fecha_programada` futura responde 409 `FUERA_DE_FECHA` («La parada está programada para el DD-MM-AAAA: solo se puede cerrar desde ese día») |
| `GET /api/inventario/sin-ubicacion?limite=20&pagina=1&q=` | `inventario:consultar` o `inventario:leer` (BODEGA, ADMIN) | `limite` 1–100, `pagina` ≥1 (400 `VALIDACION` si no), `q` opcional por SKU o nombre (sin distinguir mayúsculas, comodines literales, máx. 40 caracteres) → `{ total, pagina, limite, items: [{ sku, nombre, modelo, marca, stock_fisico }] }`. Productos `ACTIVO` con `ubicacion_bodega` NULL o vacía, por stock físico descendente y SKU; sin costos ni precios. `total` coincide con `sin_ubicacion` de `GET /api/inventario/resumen` (misma definición en el código) cuando no hay `q`. La ubicación se asigna con `PUT /api/inventario/:sku/ubicacion` |

## Producción y seguridad

Con `NODE_ENV=production` la API no arranca si `JWT_SECRET` tiene menos de 32 caracteres o es el valor de ejemplo, ni si
`CORS_ORIGIN` falta o contiene `*` (en producción el origen del frontend debe ser explícito; el valor por defecto es solo para
desarrollo). Genera el secreto con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Migración de esta etapa (idempotente): `psql -d sgi_oregon -f db/12_seguridad.sql` y, a continuación, volver a ejecutar
`db/07_rol_aplicacion.sql` para que el rol de la aplicación pueda actualizar la columna nueva. Agrega `usuario.clave_cambiada_en` y
hace que el trigger de asignación de despachos lea al chofer con `FOR SHARE`. Las bases nuevas lo traen en `db/01_modelo_datos.sql`.

### Variables de entorno de seguridad

| Variable | Por defecto | Efecto |
|---|---|---|
| `DB_SSL` | `false` | `true` activa TLS hacia PostgreSQL **y siempre valida el certificado** (`rejectUnauthorized: true`). Sin `true`, conexión sin TLS (desarrollo local). |
| `DB_SSL_CA` | vacío | Ruta a un `.pem` con la CA que firma el certificado del servidor. Para RDS, el paquete global de AWS: `curl -o /etc/ssl/rds/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`, y `DB_SSL=true DB_SSL_CA=/etc/ssl/rds/global-bundle.pem`. Si el archivo no existe o no es PEM, la API (y los scripts) no arrancan: nunca se degrada a «sin verificar». No pongas `sslmode=` en `DATABASE_URL` (anularía estas opciones). Sin `DB_SSL_CA` se usa el almacén de CA del sistema (no incluye RDS). |
| `TRUST_PROXY` | vacío (sin proxy) | Nº de proxies propios delante de la API (con un ALB de Elastic Beanstalk: `1`), o lista de IP/CIDR de confianza (`loopback, 10.0.0.0/8`). Con él, `req.ip` es la IP real del cliente (bitácora y límite de intentos). **Vacío = sin proxy: `X-Forwarded-For` se ignora** y no se puede falsificar la IP. `true` se rechaza al arrancar (confiaría en cualquier cabecera). |
| `LOGIN_VENTANA_SEGUNDOS` | `900` | Ventana fija (15 min) del límite de intentos de login. |
| `LOGIN_MAX_POR_IP` | `100` | Intentos de login por IP y ventana (cuentan al llegar; un login correcto **no** los devuelve). `0` desactiva este límite. IPv6 se cuenta por /64; `::ffff:a.b.c.d` como IPv4. |
| `LOGIN_MAX_POR_CORREO` | `20` | Intentos por correo (normalizado a minúsculas) y ventana; un login correcto reinicia el contador de ese correo. `0` lo desactiva. |
| `MAX_INTENTOS` / `BLOQUEO_MINUTOS` | `5` / `15` | Bloqueo de la cuenta (ya existente); el contador parte de cero cuando el bloqueo vence. |

**Límite de intentos.** Se aplica antes de tocar la base (no agota el pool con bcrypt). Al superarlo: `429` con `Retry-After`
(segundos hasta que cierre la ventana) y el mismo cuerpo `{ error, codigo: "DEMASIADOS_INTENTOS" }` exista o no el correo (no
permite enumerar usuarios). El contador es de ventana fija y vence solo: nadie, tampoco el administrador, queda bloqueado de forma
permanente. Usa Redis si responde y, si no, memoria por proceso (con varias instancias sin Redis el tope real se multiplica por el
nº de instancias). Correo > 254 o clave > 256 caracteres: `400`.

### Revocación de sesiones

Cambiar la clave (`PUT /api/auth/clave`) o restablecerla (`scripts/clave-usuario.mjs`) fija `usuario.clave_cambiada_en`; la API
rechaza (`401 SESION_EXPIRADA`) todo JWT cuyo `iat` sea anterior o igual a ese instante, aunque el usuario vuelva a iniciar sesión
(antes, un login nuevo reavivaba los tokens viejos). El login emite siempre un `iat` posterior al segundo del cambio. No hay cierre de
sesión individual por `jti`/logout (queda pendiente, ver abajo).

### Límites de archivos y cuerpos

| Entrada | Límites |
|---|---|
| JSON | 100 kb (`413`) |
| `.xlsx` de ventas | 10 MB subido; antes de cargarlo se revisa el ZIP: ≤ 40 MB descomprimidos (suma real, no la declarada), ≤ 200 partes, ≤ 10 hojas, ≤ 20.000 filas de datos (`MAX_FILAS`), ≤ 50 columnas, sin cifrado, sin rutas ambiguas, sin comentarios/CDATA en las hojas (`413`/`400` `ARCHIVO_INVALIDO`) |
| PDF de etiquetas | ≤ 100 archivos; válidos hasta 2 MB (3 MB por archivo en la subida); solo las 5 primeras páginas; cada lectura corre en un `worker_thread` con 8 s de tiempo, 256 MB de heap y un vigilante de RSS (+600 MB), 3 lectores a la vez en todo el proceso y 120 s de presupuesto por lote (lo no leído se informa `INVALIDO`) |
| Firma / foto de entrega | firma PNG ≤ 1 MB, foto JPG/PNG ≤ 5 MB, ambas por firma de archivo; claves `firmas/<id>.png`, `evidencias/<id>.<ext>` |
| Multipart | máx. de campos y partes acotado por ruta |

La descarga de una etiqueta se sirve siempre como `attachment`, `application/pdf`, `X-Content-Type-Options: nosniff` y
`Content-Security-Policy: default-src 'none'; sandbox`; el nombre de archivo sale de `codigo_externo` saneado a `[\w.-]`.

### Cambios de contrato de esta etapa

- `GET /api/pedidos` acepta `?pagina=` (≥ 1) y `?limite=` (1–500, por defecto 100); el cuerpo sigue siendo un arreglo y el total
  va en `X-Total-Count`. Orden estable: Administrador, más recientes primero (`fecha_orden DESC, id_orden DESC`); Bodega, más antiguos
  primero (`fecha_orden ASC, id_orden ASC`). Valores fuera de rango: `400`. Las pantallas de Administrador y Bodega piden `limite=500`.
- Bodega (sin `pedidos:leer`) solo lista los 4 estados de su flujo (y `por_reingresar=1`); `?estado=EN_RUTA|ENTREGADO|RECHAZADO` da
  `403`, y el detalle de un pedido ya en ruta o entregado da `404`. En el listado recibe `chofer_asignado` (booleano) en lugar de
  `id_usuario_chofer` y `nombre_chofer`.
- `POST /api/usuarios/:id/baja` y `PATCH /api/usuarios/:id/rol` sobre un chofer con despachos `PENDIENTE` responden
  `409 CHOFER_CON_DESPACHOS` con `detalle: { total, ordenes: [{ id_orden, codigo_externo }] }` (hasta 20). Regla: no hay reasignación
  de despachos abiertos; el chofer los cierra (entrega o rechazo) o se le mantiene activo. La BD ya impide asignar a un chofer inactivo.
- Errores de PostgreSQL por datos fuera de rango o mal formados (`22003`, `22P02`, `22021`…) responden `400`, no `500`.

### Decisiones y riesgos aceptados

- **react-router-dom 6.30.6** (última de la serie 6): `npm audit` reporta 2 moderadas (redirección abierta con `\` en `<Link>`/`navigate`,
  deserialización de errores en hidratación SSR) cuya corrección está solo en la 7.x (cambio mayor, no se hizo). No son explotables hoy:
  todos los destinos de `Navigate`/`navigate` son rutas fijas de la aplicación y no hay renderizado en el servidor.
- **uuid** (vía `exceljs`): se fija `uuid@11.1.1` con `overrides` en `package.json`; `exceljs` solo usa `v4()` (la falla afectaba a v3/v5/v6 con
  buffer). `npm audit` del backend queda en cero.
- La IP del login no se devuelve al autenticarse: una oficina con muchos usuarios tras una misma IP cuenta cada intento (100 por 15 min por defecto).
- Una subida de etiquetas de 100 PDF puede ocupar hasta ~300 MB de memoria mientras dura la solicitud (multer en memoria); solo la usa el administrador.

## Hallazgos de la auditoría pendientes

Quedan sin abordar: revocación individual de tokens (`jti`/logout y renovación del JWT), el aviso de truncamiento de la exportación de bitácora
(tope de 10.000 filas), reimportación detectada por nombre de archivo y los demás Bajo/Informativos
(hallazgos 12, 13, 15, 16, 19, 22 y 24–26 de la auditoría).
