-- Cierre de pendientes de seguridad. Idempotente; para bases nuevas el mismo esquema está en 01_modelo_datos.sql.
--  · usuario.clave_cambiada_en: instante del último cambio o restablecimiento de clave. La API rechaza todo JWT emitido
--    antes (claim `iat`), de modo que un token anterior no revive aunque el usuario vuelva a iniciar sesión.
--    Tras aplicar esto, vuelve a ejecutar db/07_rol_aplicacion.sql para que la aplicación pueda actualizar la columna.
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS clave_cambiada_en TIMESTAMPTZ;
