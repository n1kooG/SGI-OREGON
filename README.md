# SGI Tienda Oregón — base de la aplicación

Avance del Proyecto Integrado (INACAP). Stack del informe: React (PWA) + Node.js/Express + PostgreSQL + Redis.

## Requisitos (Mac)
- Node 20 o superior (`node -v`)
- PostgreSQL 16 y Redis locales: `brew install postgresql@16 redis`
- Sin Docker. En producción: Amazon RDS (PostgreSQL) + EC2 + S3.

## Puesta en marcha

```bash
# 1) Servicios locales
brew services start postgresql@16
brew services start redis

# 2) Base de datos (la primera vez; db/02 es solo para desarrollo)
createdb sgi_oregon
psql sgi_oregon -f db/01_modelo_datos.sql
psql sgi_oregon -f db/02_datos_ejemplo.sql

# 3) Backend  → http://localhost:3000
cd backend
cp .env.example .env        # edita JWT_SECRET y DATABASE_URL (con brew, el usuario de la BD es el de tu Mac, sin clave)
npm install
npm run dev
npm test                    # necesita la BD arriba

# 4) Frontend → http://localhost:5173
cd frontend
npm install
npm run dev
```

Usuarios de ejemplo (clave `Demo-Oregon-2026`): `admin@tiendaoregon.cl`, `bodega@tiendaoregon.cl`, `chofer@tiendaoregon.cl`.
El login pide solo correo y contraseña: el rol sale de la base de datos y define la pantalla de destino.

**Reiniciar la BD desde cero:** `dropdb sgi_oregon && createdb sgi_oregon` y repetir el paso 2.
Redis es opcional: sin él, el dashboard funciona sin caché (cabecera `X-Cache: OFF`).
Pruebas de integridad de la BD: `psql sgi_oregon -f db/03_pruebas_integridad.sql` (deben aprobar las 39).

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
