# SGI Tienda Oregón — base de la aplicación

Avance del Proyecto Integrado (INACAP). Stack del informe: React (PWA) + Node.js/Express + PostgreSQL + Redis.

## Requisitos (Mac)
- Node 20 o superior (`node -v`)
- Docker Desktop (para PostgreSQL y Redis). Sin Docker: `brew install postgresql@16 redis` y ver "Sin Docker".

## Puesta en marcha (3 terminales)

```bash
# 1) Base de datos + Redis (la primera vez carga db/01 y db/02 solo)
docker compose up -d

# 2) Backend  → http://localhost:3000
cd backend
cp .env.example .env        # edita JWT_SECRET
npm install
npm run dev
npm test                    # pruebas de seguridad (necesita la BD arriba)

# 3) Frontend → http://localhost:5173
cd frontend
npm install
npm run dev
```

Usuarios de ejemplo (clave `Demo-Oregon-2026`): `admin@tiendaoregon.cl`, `bodega@tiendaoregon.cl`, `chofer@tiendaoregon.cl`.
En el login hay que elegir el rol que corresponde al usuario; si no coincide, se rechaza y queda en auditoría.

**Reiniciar la BD desde cero:** `docker compose down -v && docker compose up -d`.
**Sin Docker:** crea la BD `sgi_oregon`, ejecuta `db/01_modelo_datos.sql` y luego `db/02_datos_ejemplo.sql` con `psql`, y ajusta `DATABASE_URL`. Redis es opcional: sin él, el dashboard funciona sin caché (cabecera `X-Cache: OFF`).

## Estructura
```
db/        modelo relacional y datos de ejemplo (los del informe)
backend/   API REST (Express, ESM)
  src/middleware/auth.js   JWT + permisos leídos desde la BD en cada request + default deny (403) + auditoría
  src/routes/              auth, productos, inventario, dashboard, pedidos, auditoria
  src/cache.js             caché Redis con degradación si no hay Redis
  tests/api.test.js        políticas de seguridad del informe
frontend/  React + Vite, PWA (manifest + service worker que no cachea /api)
```

## Qué ya está
- Login con bcrypt (pgcrypto), mensaje único de error, bloqueo 15 min tras 5 intentos, rol validado contra la BD.
- RBAC por permisos "módulo:acción"; cada acceso denegado se registra en `audit_log`.
- Costos y márgenes solo para quien tiene `costos:leer` (Bodega/Chofer nunca los reciben).
- Dashboard (KPIs + stock crítico, caché 30 s), catálogo (solo lectura), auditoría, búsqueda de Bodega (HU06).

## Qué falta (los `TODO(...)` en el código indican dónde)
| Pendiente | HU / CU | Dónde |
|---|---|---|
| Alta y edición de productos, listas de precio | HU01, HU02 | `routes/productos.js` |
| Recepción de compras y confirmación de descarga | HU03, CU-04 | `routes/inventario.js` |
| Importación de pedidos desde Excel (una transacción) | HU04, CU-05 | `routes/pedidos.js` |
| Picking y cambio de estado de pedidos (Bodega) | HU05 | `routes/pedidos.js`, `pages/Bodega.jsx` |
| Ruta y entregas del chofer con geolocalización | HU07 | nuevo `routes/despachos.js`, `pages/Ruta.jsx` |
| Alertas de reposición y reportes | HU09 | `routes/dashboard.js` |
| Almacenamiento de archivos (S3) | — | pendiente |

## Riesgos conocidos (antes de producción)
- El token JWT está en `sessionStorage`; se debe evaluar cookie httpOnly + CSRF.
- No hay límite de peticiones por IP en el login (solo el bloqueo por cuenta, que además permite bloquear a un usuario a propósito).
- `helmet` está con valores por defecto; falta ajustar CSP cuando el front se sirva desde otro origen.
- El `.env` de ejemplo usa claves de desarrollo. No reutilizar.
