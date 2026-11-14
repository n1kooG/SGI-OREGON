-- Estructura de la bodega: pasillos, racks (con letra) y pisos por rack. La ubicación de un SKU es el texto
-- «Pasillo 1, Rack B, Piso 2» (inventario.ubicacion_bodega) y la API solo acepta combinaciones que existan aquí.
-- Idempotente. Tras aplicarla, vuelve a ejecutar db/07_rol_aplicacion.sql (permisos sobre las tablas nuevas).

CREATE TABLE IF NOT EXISTS bodega_pasillo (
  numero SMALLINT PRIMARY KEY CHECK (numero BETWEEN 1 AND 99)
);

CREATE TABLE IF NOT EXISTS bodega_rack (
  numero_pasillo SMALLINT NOT NULL REFERENCES bodega_pasillo (numero) ON UPDATE RESTRICT ON DELETE RESTRICT,
  letra          CHAR(1)  NOT NULL CHECK (letra ~ '^[A-Z]$'),
  pisos          SMALLINT NOT NULL CHECK (pisos BETWEEN 1 AND 10),
  PRIMARY KEY (numero_pasillo, letra)
);

-- Estructura actual del cliente (solo si aún no hay ninguna): 2 pasillos y 3 racks de 2 pisos.
INSERT INTO bodega_pasillo (numero) SELECT n FROM (VALUES (1), (2)) v(n) WHERE NOT EXISTS (SELECT 1 FROM bodega_pasillo);
INSERT INTO bodega_rack (numero_pasillo, letra, pisos)
  SELECT * FROM (VALUES (1::smallint, 'A', 2::smallint), (1, 'B', 2), (2, 'C', 2)) v WHERE NOT EXISTS (SELECT 1 FROM bodega_rack);

-- Las ubicaciones de texto libre anteriores se descartan; las que ya tienen el formato nuevo se conservan.
UPDATE inventario SET ubicacion_bodega = NULL
 WHERE ubicacion_bodega IS NOT NULL AND ubicacion_bodega !~ '^Pasillo [0-9]+, Rack [A-Z], Piso [0-9]+$';

-- Permiso para configurar la estructura (solo Administrador), en bases ya creadas.
UPDATE rol SET permisos = permisos || '["bodega:configurar"]'::jsonb WHERE nombre_rol = 'ADMINISTRADOR' AND NOT (permisos ? 'bodega:configurar');
