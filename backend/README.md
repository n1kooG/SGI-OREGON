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
| `POST /api/pedidos/etiquetas` | `pedidos:etiquetas` (ADMIN) | multipart, campo `archivos` repetido (hasta 100 PDF de ≤ 2 MB). Lee el «Nº de orden» de cada PDF y lo busca en `codigo_externo` (sin espacios, mayúsculas, sin `#`/`ORD-` ni ceros iniciales). → 200 `{ total, resultados: [{ archivo, estado, id_orden?, codigo_externo?, motivo? }] }` con `estado` = `ASOCIADA` \| `REEMPLAZADA` \| `NO_RECONOCIDA` (sin N° de orden legible) \| `PEDIDO_NO_ENCONTRADO` (sin pedido, o más de uno) \| `INVALIDO` (no es PDF, vacío, > 2 MB, ilegible). Un archivo malo no aborta el lote. 400 sin archivos o con más de 100; 413 si un archivo supera 3 MB; audita `ETIQUETA_IMPORTADA` por asociación |
| `PUT /api/pedidos/:id/etiqueta` | `pedidos:etiquetas` (ADMIN) | multipart, campo `archivo` (un PDF): asigna a mano sin leer su texto. → `{ id_orden, estado: "ASOCIADA" \| "REEMPLAZADA", etiqueta_nombre_archivo, etiqueta_importada_en }`. 400 `ARCHIVO_INVALIDO`, 404; audita `ETIQUETA_IMPORTADA` con `manual: true` |
| `DELETE /api/pedidos/:id/etiqueta` | `pedidos:etiquetas` (ADMIN) | → `{ id_orden }`; borra el archivo y limpia las columnas. 404 `SIN_ETIQUETA` / `NO_ENCONTRADO`; audita `ETIQUETA_ELIMINADA` |
| `GET /api/pedidos/:id/etiqueta` | `pedidos:preparar` o `pedidos:leer` | → PDF (`application/pdf`, `attachment; filename="etiqueta_<codigo_externo>.pdf"`). 404 `SIN_ETIQUETA` si el pedido no tiene; audita `ETIQUETA` |

`GET /api/pedidos` y `GET /api/pedidos/:id` (Administrador y Bodega) incluyen `tiene_etiqueta`, `etiqueta_nombre_archivo` y
`etiqueta_importada_en`; la clave de almacenamiento nunca se expone.

Almacenamiento: con S3 activo el PDF queda en `etiquetas/<id_orden>.pdf` (clave determinista, reemplaza la anterior). Con
`STORAGE_ENABLED=false` (desarrollo) se guarda en disco en `ETIQUETAS_DIR` (por defecto `backend/storage-local/etiquetas/`, ignorado
por git) como `<id_orden>.pdf`. El nombre del archivo subido solo se guarda como texto (sin rutas); nunca forma parte de una ruta.
Para reconocer otro marketplace se agrega un patrón a `PATRONES_ORDEN` en `src/pdf/leerOrden.js`.

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

## Producción

Con `NODE_ENV=production` la API no arranca si `JWT_SECRET` tiene menos de 32 caracteres o es el valor de ejemplo.
Genera uno con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Hallazgos de la auditoría pendientes

No se abordaron en este trabajo: límite de memoria al leer `.xlsx` (bomba de descompresión), paginación del listado de
pedidos, reasignación de despachos al dar de baja a un chofer, límite de
peticiones en el login, revocación individual de tokens (`jti`/logout; el cambio de clave revoca las sesiones por
usuario) y los hallazgos Bajo/Informativos restantes.
