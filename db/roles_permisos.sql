-- =====================================================================
-- SGI Tienda Oregón - Roles y permisos (fuente única)
-- Lo cargan 02_datos_ejemplo.sql (\ir) y backend/scripts/arranque-produccion.mjs.
-- Idempotente: se puede volver a ejecutar para actualizar los permisos de cada rol.
-- =====================================================================

-- Roles y permisos (JSONB). Formato "modulo:accion", igual que validarToken(jwt, "pedidos:importar")
INSERT INTO rol (nombre_rol, descripcion, permisos) VALUES
 ('ADMINISTRADOR', 'Jefatura Administrativa y Comercial: acceso total, incluye costos y márgenes',
  '["catalogo:leer","catalogo:escribir","costos:leer","precios:leer","precios:escribir",
    "compras:recepcionar","pedidos:importar","pedidos:leer","pedidos:asignar_chofer",
    "inventario:leer","alertas:leer","reportes:leer","auditoria:leer","usuarios:administrar"]'),
 ('BODEGA', 'Operario de bodega: consulta de stock, preparación de pedidos y descarga de camión; sin costos ni márgenes',
  '["inventario:consultar","pedidos:preparar","compras:confirmar_descarga"]'),
 ('CHOFER', 'Chofer de reparto: hoja de ruta y cierre de entregas; sin costos ni márgenes',
  '["ruta:leer","entregas:registrar"]')
ON CONFLICT (nombre_rol) DO UPDATE SET descripcion = EXCLUDED.descripcion, permisos = EXCLUDED.permisos;
