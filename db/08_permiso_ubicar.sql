-- Agrega el permiso inventario:ubicar (asignar la ubicación en bodega de un SKU) a ADMINISTRADOR y BODEGA
-- en bases ya creadas. Idempotente. Para bases nuevas basta db/roles_permisos.sql.
UPDATE rol SET permisos = permisos || '["inventario:ubicar"]'::jsonb
 WHERE nombre_rol IN ('ADMINISTRADOR', 'BODEGA') AND NOT (permisos ? 'inventario:ubicar');
