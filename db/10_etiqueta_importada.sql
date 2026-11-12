-- Etiqueta de despacho importada desde el marketplace y asociada al pedido. Idempotente; para bases nuevas el mismo esquema
-- está en 01_modelo_datos.sql y el permiso en roles_permisos.sql.
--  · orden_venta: clave de almacenamiento del PDF (etiquetas/<id_orden>.pdf), nombre original y fecha de importación.
--  · Permiso pedidos:etiquetas (importar, asignar y quitar etiquetas) solo para ADMINISTRADOR; Bodega descarga con pedidos:preparar.
ALTER TABLE orden_venta ADD COLUMN IF NOT EXISTS url_etiqueta             VARCHAR(255);
ALTER TABLE orden_venta ADD COLUMN IF NOT EXISTS etiqueta_nombre_archivo  VARCHAR(200);
ALTER TABLE orden_venta ADD COLUMN IF NOT EXISTS etiqueta_importada_en    TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_etiqueta_coherente') THEN
    ALTER TABLE orden_venta ADD CONSTRAINT ck_etiqueta_coherente
      CHECK ((url_etiqueta IS NULL) = (etiqueta_nombre_archivo IS NULL) AND (url_etiqueta IS NULL) = (etiqueta_importada_en IS NULL));
  END IF;
END $$;

UPDATE rol SET permisos = permisos || '["pedidos:etiquetas"]'::jsonb
 WHERE nombre_rol = 'ADMINISTRADOR' AND NOT (permisos ? 'pedidos:etiquetas');
