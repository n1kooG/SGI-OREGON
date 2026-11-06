import { query } from '../db.js';

export async function listar(estado) {
  const { rows } = await query(
    `SELECT o.id_orden, o.codigo_externo, o.canal_origen, o.fecha_orden, o.nombre_cliente, o.comuna, o.estado_orden,
            (SELECT COALESCE(SUM(d.cantidad_vendida), 0)::int FROM detalle_venta d WHERE d.id_orden = o.id_orden) AS unidades
       FROM orden_venta o
      WHERE ($1::text IS NULL OR o.estado_orden = $1)
      ORDER BY o.fecha_orden DESC LIMIT 100`,
    [estado],
  );
  return rows;
}

// RUT -> válido, en una sola consulta (la planilla puede traer miles de filas).
export async function rutsInvalidos(ruts) {
  const { rows } = await query(`SELECT r FROM unnest($1::text[]) AS t(r) WHERE NOT fn_rut_valido(r)`, [ruts]);
  return new Set(rows.map((x) => x.r));
}

export async function insertarLote(c, { idUsuario, archivo, ordenes, lineas }) {
  const { rows } = await c.query(
    `INSERT INTO lote_importacion (id_usuario, nombre_archivo, url_archivo_s3, total_ordenes, total_lineas) VALUES ($1,$2,'pendiente',$3,$4) RETURNING id_lote`,
    [idUsuario, archivo, ordenes, lineas]);
  return rows[0].id_lote;
}

export const fijarClaveLote = (c, idLote, clave) => c.query(`UPDATE lote_importacion SET url_archivo_s3 = $2 WHERE id_lote = $1`, [idLote, clave]);

// Inserta todas las órdenes del lote de una vez; devuelve codigo_externo -> id_orden.
export async function insertarOrdenes(c, idLote, canal, ordenes) {
  const { rows } = await c.query(
    `INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, rut_cliente, nombre_cliente)
     SELECT $1, cod, $2, rut, nombre FROM unnest($3::text[], $4::text[], $5::text[]) AS t(cod, rut, nombre)
     RETURNING id_orden, codigo_externo`,
    [idLote, canal, ordenes.map((o) => o.codigo), ordenes.map((o) => o.rut), ordenes.map((o) => o.nombre)]);
  return new Map(rows.map((r) => [r.codigo_externo, r.id_orden]));
}

export const insertarDetalles = (c, lineas) => c.query(
  `INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, precio_unitario)
   SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::numeric[])`,
  [lineas.map((l) => l.idOrden), lineas.map((l) => l.sku), lineas.map((l) => l.cantidad), lineas.map((l) => l.precio)]);
