-- Firma del receptor (T32/PI-04) y rechazo completo (PI-05). Idempotente; para bases nuevas el mismo esquema está en 01_modelo_datos.sql.
--  · despacho: firma (clave S3), nombre del receptor y registro del reingreso físico de un rechazo.
--  · Un pedido rechazado y reingresado vuelve a EN_CAMION y puede tener un despacho nuevo: la restricción UNIQUE (id_orden)
--    pasa a un índice único parcial (un solo despacho PENDIENTE por pedido); el historial de intentos se conserva.
--  · Permiso entregas:reingresar para ADMINISTRADOR y BODEGA.
ALTER TABLE despacho ADD COLUMN IF NOT EXISTS url_firma_s3          VARCHAR(255);
ALTER TABLE despacho ADD COLUMN IF NOT EXISTS nombre_receptor       VARCHAR(120);
ALTER TABLE despacho ADD COLUMN IF NOT EXISTS reingresado_en        TIMESTAMPTZ;
ALTER TABLE despacho ADD COLUMN IF NOT EXISTS id_usuario_reingreso  INTEGER REFERENCES usuario (id_usuario) ON UPDATE RESTRICT ON DELETE RESTRICT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_reingreso_coherente') THEN
    ALTER TABLE despacho ADD CONSTRAINT ck_reingreso_coherente
      CHECK ((reingresado_en IS NULL) = (id_usuario_reingreso IS NULL) AND (reingresado_en IS NULL OR estado_entrega = 'RECHAZADO'));
  END IF;
END $$;

ALTER TABLE despacho DROP CONSTRAINT IF EXISTS despacho_id_orden_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_despacho_orden_abierto ON despacho (id_orden) WHERE estado_entrega = 'PENDIENTE';
CREATE INDEX IF NOT EXISTS ix_despacho_orden ON despacho (id_orden);

CREATE OR REPLACE FUNCTION fn_orden_transicion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bodega TEXT[] := ARRAY['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION'];
BEGIN
  IF NEW.estado_orden = OLD.estado_orden THEN RETURN NEW; END IF;
  IF (OLD.estado_orden = ANY (bodega) AND NEW.estado_orden = ANY (bodega))
     OR (OLD.estado_orden = 'EN_CAMION' AND NEW.estado_orden = 'EN_RUTA')
     OR (OLD.estado_orden = 'EN_RUTA'   AND NEW.estado_orden IN ('ENTREGADO', 'RECHAZADO'))
     OR (OLD.estado_orden = 'RECHAZADO' AND NEW.estado_orden = 'EN_CAMION'              -- reprogramación: solo tras el reingreso físico
         AND EXISTS (SELECT 1 FROM despacho d
                      WHERE d.id_despacho = (SELECT max(id_despacho) FROM despacho WHERE id_orden = OLD.id_orden)
                        AND d.estado_entrega = 'RECHAZADO' AND d.reingresado_en IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Transición de estado no permitida: % -> %', OLD.estado_orden, NEW.estado_orden
        USING ERRCODE = 'check_violation';
END $$;

UPDATE rol SET permisos = permisos || '["entregas:reingresar"]'::jsonb
 WHERE nombre_rol IN ('ADMINISTRADOR', 'BODEGA') AND NOT (permisos ? 'entregas:reingresar');
