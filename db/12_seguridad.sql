-- Cierre de pendientes de seguridad. Idempotente; para bases nuevas el mismo esquema está en 01_modelo_datos.sql.
--  · usuario.clave_cambiada_en: instante del último cambio o restablecimiento de clave. La API rechaza todo JWT emitido
--    antes (claim `iat`), de modo que un token anterior no revive aunque el usuario vuelva a iniciar sesión.
--    Tras aplicar esto, vuelve a ejecutar db/07_rol_aplicacion.sql para que la aplicación pueda actualizar la columna.
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS clave_cambiada_en TIMESTAMPTZ;

--  · fn_despacho_solo_chofer(): lee al chofer con FOR SHARE para que no se le asigne un despacho mientras se le da de baja
--    (la API rechaza la baja de un chofer con despachos PENDIENTE; sin el bloqueo ambas operaciones podían cruzarse).
CREATE OR REPLACE FUNCTION fn_despacho_solo_chofer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
                  WHERE u.id_usuario = NEW.id_usuario_chofer AND u.activo AND r.nombre_rol = 'CHOFER' FOR SHARE OF u) THEN
    RAISE EXCEPTION 'El usuario % no es un chofer activo', NEW.id_usuario_chofer
          USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
