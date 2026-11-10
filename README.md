# SGI Tienda Oregón

**Sistema de Gestión de Inventario** para una comercializadora que vende por varios canales. Controla existencias, compras a proveedores, pedidos multicanal, la preparación en bodega y el reparto en terreno, dejando registro de cada acción.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-PWA-646CFF?logo=vite&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-relacional-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-caché-DC382D?logo=redis&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-S3%20%C2%B7%20RDS%20%C2%B7%20EC2-232F3E?logo=amazonaws&logoColor=white)

Proyecto Integrado de INACAP.

## Qué problema resuelve

Una tienda que vende por sitio web, marketplaces y mayoristas necesita saber en todo momento cuánto stock tiene, dónde está en bodega, cuánto cuesta y deja cada producto, y qué pedidos ya salieron a reparto. SGI reúne esa información en un solo sistema, con control de acceso por rol y bitácora de auditoría.

## A quién sirve

| Rol | Qué hace en el sistema |
|---|---|
| **Administrador** | Mantiene el catálogo y los precios, registra compras, carga pedidos, asigna choferes, supervisa indicadores y administra usuarios y la bitácora. |
| **Bodega** | Consulta stock y ubicaciones, prepara pedidos, descarga camiones contra la factura y genera etiquetas de despacho. |
| **Chofer** | Revisa su ruta del día y registra cada entrega o rechazo, con foto y ubicación. |

## Módulos y funcionalidades

- **Catálogo maestro:** productos con SKU inmutable, costo de adquisición y precios de venta por canal (Web, Marketplace y Mayorista), con margen calculado automáticamente.
- **Compras y facturas:** recepción de la factura del proveedor con neto, IVA (19 %) y total, y PDF de respaldo opcional. Cada recepción suma el stock en la misma operación.
- **Descarga de camión:** conteo de bultos por SKU contra el número de factura, con detalle de las diferencias encontradas.
- **Carga masiva de pedidos:** importación desde Excel por canal de venta. La planilla se simula antes de escribir; si tiene errores, no se guarda nada.
- **Picking y etiquetas:** lista de recolección por pedido, avance de estados (sin recolectar, armado, etiquetado, en camión) y etiqueta de despacho con código de barras Code 128.
- **Búsqueda de stock:** consulta rápida por SKU, modelo o nombre, con stock disponible y ubicación en bodega.
- **Asignación y reparto:** el administrador asigna un chofer a cada pedido en camión. El chofer confirma la entrega con foto y geolocalización, o la rechaza con una causal obligatoria.
- **Dashboard y alertas:** valorización del inventario, stock crítico, ventas del día y margen promedio, con aviso de quiebres inminentes.
- **Bitácora de auditoría:** registro inmutable de las acciones del sistema, con filtros y exportación a Excel y PDF.

## Seguridad

- **Acceso por rol:** cada función exige un permiso. Lo que no está permitido se deniega por defecto y el intento queda registrado.
- **Roles leídos desde la base de datos:** el rol y los permisos se consultan en cada solicitud, no se confían al token, así que un cambio de rol surte efecto de inmediato.
- **Costos y márgenes protegidos:** solo el Administrador los recibe; la API no los entrega a Bodega ni a Chofer.
- **Autenticación robusta:** contraseñas cifradas con bcrypt, mensaje de error único al ingresar y bloqueo temporal tras varios intentos fallidos.
- **Sesión por inactividad:** la sesión expira tras un período sin actividad.
- **Bitácora inmutable:** inicios de sesión, cambios de estado, operaciones de inventario, precios y usuarios quedan registrados.

## Stack tecnológico

| Capa | Tecnología | Uso |
|---|---|---|
| Frontend | React + Vite (PWA) | Panel de oficina y vistas móviles para bodega y chofer |
| Backend | Node.js + Express | API REST, autenticación con JWT, validaciones y permisos |
| Base de datos | PostgreSQL | Modelo relacional con restricciones, disparadores y transacciones |
| Caché | Redis | Caché de indicadores del dashboard y control de inactividad (opcional) |
| Documentos | ExcelJS, PDFKit | Importación y exportación de planillas, bitácora, etiquetas |
| Producción | AWS (S3, RDS, EC2) | Archivos de respaldo, base de datos administrada y servidor de aplicación |

## Arquitectura

```
Solicitud HTTP → Rutas (entrada y permisos) → Servicios (reglas de negocio) → Repositorios (SQL parametrizado)
```

- **Capa transversal:** middleware de autenticación, permisos, filtro de costos y auditoría.
- **Observer para alertas de stock:** cuando cambia el inventario, un sujeto notifica a sus observadores. Uno evalúa el stock crítico y genera la alerta; otro actualiza las métricas del dashboard.
- **Transacciones con auditoría:** las operaciones que mueven stock, precios o estados se confirman junto con su registro en la bitácora. Si una parte falla, no queda nada a medias.

## Estructura del repositorio

```
backend/
  src/routes/        endpoints por módulo
  src/services/      reglas de negocio
  src/repositories/  acceso a datos (SQL)
  src/middleware/    autenticación, permisos y control de costos
  src/observers/     alertas de stock y métricas del dashboard
  src/pdf/           etiquetas de despacho y reportes en PDF
  tests/             pruebas automatizadas de la API
db/                  modelo de datos, datos de ejemplo, pruebas de integridad, concurrencia y rendimiento
frontend/
  src/paginas/       pantallas por módulo
  src/componentes/   diseño, navegación y componentes compartidos
```

## Estado del proyecto

- **Sprints 1 a 4:** completados.
- **Contexto:** Proyecto Integrado de INACAP, desarrollado como sistema de gestión para una comercializadora.
