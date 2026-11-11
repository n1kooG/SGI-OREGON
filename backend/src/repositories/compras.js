import { query } from '../db.js';

export const skusExistentes = async (skus) =>
  new Set((await query(`SELECT sku FROM producto WHERE sku = ANY($1) AND estado = 'ACTIVO'`, [skus])).rows.map((r) => r.sku));

export async function insertarRecepcion(c, r) {
  const { rows } = await c.query(
    `INSERT INTO recepcion_compra (id_usuario, numero_factura, rut_proveedor, nombre_proveedor, fecha_emision, forma_pago, url_pdf_factura, monto_neto, monto_iva, monto_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id_recepcion`,
    [r.idUsuario, r.numeroFactura, r.rutProveedor, r.nombreProveedor, r.fechaEmision, r.formaPago, r.clavePdf, r.neto, r.iva, r.total]);
  return rows[0].id_recepcion;
}

export const insertarDetalle = (c, idRecepcion, items) => c.query(
  `INSERT INTO detalle_recepcion (id_recepcion, sku, cantidad_recibida, precio_unitario_neto)
   SELECT $1, sku, cant, precio FROM unnest($2::text[], $3::int[], $4::numeric[]) AS t(sku, cant, precio)`,
  [idRecepcion, items.map((i) => i.sku), items.map((i) => i.cantidad), items.map((i) => i.precio)]);

// Sin precios: sirve a Bodega (T49).
export async function recepcionesPorFactura(numeroFactura, rutProveedor) {
  const { rows } = await query(
    `SELECT id_recepcion, numero_factura, nombre_proveedor, estado_documento FROM recepcion_compra
      WHERE numero_factura = $1 AND ($2::text IS NULL OR rut_proveedor = $2)`, [numeroFactura, rutProveedor]);
  return rows;
}

export const detalleEsperado = async (idRecepcion, c) =>
  (await c.query(`SELECT sku, cantidad_recibida::int AS cantidad FROM detalle_recepcion WHERE id_recepcion = $1 ORDER BY sku`, [idRecepcion])).rows;

export const marcarEstado = (c, idRecepcion, estado) =>
  c.query(`UPDATE recepcion_compra SET estado_documento = $2 WHERE id_recepcion = $1`, [idRecepcion, estado]);

// Recepciones cuya descarga aún no se confirmó (sin evento DESCARGA_CONFIRMADA), de la más antigua a la más reciente, sin montos.
// Los eventos se agrupan una sola vez (ix_audit_tabla_accion los localiza) y se cruzan por hash: no es una subconsulta por factura.
export async function descargasPendientes() {
  const { rows } = await query(
    `SELECT r.id_recepcion, r.numero_factura, r.nombre_proveedor, r.fecha_emision, r.fecha_recepcion,
            COALESCE(d.unidades, 0)::int AS unidades, COALESCE(d.detalle, '[]'::json) AS detalle
       FROM recepcion_compra r
       LEFT JOIN (SELECT DISTINCT (valores_nuevos->>'id_recepcion')::int AS id FROM audit_log
                   WHERE tabla_afectada = 'recepcion_compra' AND accion = 'DESCARGA_CONFIRMADA') c ON c.id = r.id_recepcion
       LEFT JOIN LATERAL (SELECT sum(cantidad_recibida) AS unidades, json_agg(json_build_object('sku', sku, 'cantidad', cantidad_recibida) ORDER BY sku) AS detalle
                            FROM detalle_recepcion WHERE id_recepcion = r.id_recepcion) d ON true
      WHERE c.id IS NULL
      ORDER BY r.fecha_recepcion, r.id_recepcion`);
  return rows;
}

// Último DESCARGA_CONFIRMADA de cada recepción (si existe): de él salen el estado de la descarga y los bultos contados.
// Sin evento la descarga está PENDIENTE (estado_documento nace en CONFORME y por sí solo no lo dice).
const ULTIMA_DESCARGA = `LEFT JOIN LATERAL (SELECT a.valores_nuevos FROM audit_log a
   WHERE a.tabla_afectada = 'recepcion_compra' AND a.accion = 'DESCARGA_CONFIRMADA' AND (a.valores_nuevos->>'id_recepcion')::int = r.id_recepcion
   ORDER BY a.id_log DESC LIMIT 1) e ON true`;
const ESTADO_DESCARGA = `CASE WHEN e.valores_nuevos IS NULL THEN 'PENDIENTE' ELSE r.estado_documento END`;

function dondeHistorial({ proveedor, desde, hasta, q }) {
  const p = [];
  const w = [];
  const con = (sql, v) => { p.push(v); w.push(sql.replaceAll('?', `$${p.length}`)); };
  if (proveedor) con(`(r.rut_proveedor = ? OR position(lower(?) in lower(r.nombre_proveedor)) > 0)`, proveedor);
  if (desde) con('r.fecha_emision >= ?', desde);
  if (hasta) con('r.fecha_emision <= ?', hasta);
  if (q) con('position(lower(?) in lower(r.numero_factura)) > 0', q);
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', p };
}

export async function listarRecepciones(f, limite, offset) {
  const { sql, p } = dondeHistorial(f);
  const { rows } = await query(
    `SELECT r.id_recepcion, r.fecha_emision, r.nombre_proveedor, r.rut_proveedor, r.numero_factura,
            r.monto_neto, r.monto_iva, r.monto_total, (r.url_pdf_factura IS NOT NULL) AS tiene_pdf, ${ESTADO_DESCARGA} AS estado_descarga
       FROM recepcion_compra r ${ULTIMA_DESCARGA} ${sql}
      ORDER BY r.fecha_emision DESC, r.id_recepcion DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`,
    [...p, limite, offset]);
  return rows;
}

export async function contarRecepciones(f) {
  const { sql, p } = dondeHistorial(f);
  return (await query(`SELECT count(*)::int AS n FROM recepcion_compra r ${sql}`, p)).rows[0].n;
}

export const proveedores = async () =>
  (await query(`SELECT DISTINCT ON (rut_proveedor) rut_proveedor, nombre_proveedor FROM recepcion_compra ORDER BY rut_proveedor, fecha_recepcion DESC`)).rows
    .sort((a, b) => a.nombre_proveedor.localeCompare(b.nombre_proveedor, 'es'));

export async function recepcion(id) {
  const { rows: [r] } = await query(
    `SELECT r.id_recepcion, r.fecha_emision, r.fecha_recepcion, r.nombre_proveedor, r.rut_proveedor, r.numero_factura, r.forma_pago,
            r.monto_neto, r.monto_iva, r.monto_total, r.url_pdf_factura, (r.url_pdf_factura IS NOT NULL) AS tiene_pdf,
            ${ESTADO_DESCARGA} AS estado_descarga, e.valores_nuevos->'bultos' AS bultos
       FROM recepcion_compra r ${ULTIMA_DESCARGA} WHERE r.id_recepcion = $1`, [id]);
  if (!r) return null;
  const { rows: items } = await query(
    `SELECT d.sku, p.nombre, d.cantidad_recibida::int AS facturada, d.precio_unitario_neto, (d.cantidad_recibida * d.precio_unitario_neto) AS total_neto
       FROM detalle_recepcion d JOIN producto p ON p.sku = d.sku WHERE d.id_recepcion = $1 ORDER BY d.id_detalle_rec`, [id]);
  return { ...r, items };
}
