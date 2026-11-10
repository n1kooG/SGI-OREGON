import { query } from '../db.js';

// Filtros opcionales: usuario (nombre o email, parcial), accion (exacta), desde/hasta (fechas inclusivas).
function filtrar({ usuario, accion, desde, hasta }) {
  const cond = [], p = [];
  if (usuario) { p.push(usuario.replace(/[\\%_]/g, '\\$&')); cond.push(`(u.nombre_completo ILIKE '%' || $${p.length} || '%' OR u.email ILIKE '%' || $${p.length} || '%')`); }
  if (accion) { p.push(accion); cond.push(`a.accion = $${p.length}`); }
  if (desde) { p.push(desde); cond.push(`a.fecha_hora >= $${p.length}::date`); }
  if (hasta) { p.push(hasta); cond.push(`a.fecha_hora < $${p.length}::date + 1`); }
  return { donde: cond.length ? `WHERE ${cond.join(' AND ')}` : '', p };
}

const DESDE = `FROM audit_log a LEFT JOIN usuario u ON u.id_usuario = a.id_usuario LEFT JOIN rol r ON r.id_rol = u.id_rol`;

export async function listar(filtros, limite, offset = 0) {
  const { donde, p } = filtrar(filtros);
  const { rows } = await query(
    `SELECT a.id_log, a.fecha_hora, u.nombre_completo AS usuario, r.nombre_rol AS rol,
            a.accion, a.tabla_afectada AS modulo, host(a.ip_origen) AS ip_origen, a.valores_nuevos AS detalle
       ${DESDE} ${donde}
      ORDER BY a.fecha_hora DESC, a.id_log DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`,
    [...p, limite, offset],
  );
  return rows;
}

export async function contar(filtros) {
  const { donde, p } = filtrar(filtros);
  const { rows: [r] } = await query(`SELECT count(*)::int AS n ${DESDE} ${donde}`, p);
  return r.n;
}
