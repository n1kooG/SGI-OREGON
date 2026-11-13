-- Reprogramar entrega. Idempotente; para bases nuevas el mismo esquema está en 01_modelo_datos.sql.
--  · fn_hoy(): «hoy» del negocio en America/Santiago (la zona de la sesión suele ser UTC y desplazaría el día).
--  · despacho: fecha_programada (desde cuándo el chofer ve y puede cerrar la parada), nota_admin y quién asignó o reprogramó.
CREATE OR REPLACE FUNCTION fn_hoy() RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Santiago')::date $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'despacho' AND column_name = 'fecha_programada') THEN
    ALTER TABLE despacho ADD COLUMN fecha_programada DATE NOT NULL DEFAULT fn_hoy();
    UPDATE despacho SET fecha_programada = fecha_asignacion; -- los despachos previos se programaron el día en que se asignaron
  END IF;
END $$;
ALTER TABLE despacho ADD COLUMN IF NOT EXISTS nota_admin        VARCHAR(300);
ALTER TABLE despacho ADD COLUMN IF NOT EXISTS id_usuario_asigna INTEGER REFERENCES usuario (id_usuario) ON UPDATE RESTRICT ON DELETE RESTRICT;
