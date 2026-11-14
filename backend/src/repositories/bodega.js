import { query } from '../db.js';

export const etiquetaUbicacion = (pasillo, letra, piso) => `Pasillo ${pasillo}, Rack ${letra}, Piso ${piso}`;

export async function estructura() {
  const [p, r, u] = await Promise.all([
    query(`SELECT numero FROM bodega_pasillo ORDER BY numero`),
    query(`SELECT numero_pasillo, letra, pisos FROM bodega_rack ORDER BY numero_pasillo, letra`),
    query(`SELECT ubicacion_bodega AS ubicacion, count(*)::int AS productos FROM inventario
            WHERE ubicacion_bodega IS NOT NULL GROUP BY 1`),
  ]);
  return { pasillos: p.rows, racks: r.rows, ocupacion: new Map(u.rows.map((x) => [x.ubicacion, x.productos])) };
}

export const letrasEnUso = async (client) => (await client.query(`SELECT DISTINCT letra FROM bodega_rack`)).rows.map((x) => x.letra);
export const pasilloExiste = async (n, client) => (await client.query(`SELECT 1 FROM bodega_pasillo WHERE numero = $1 FOR UPDATE`, [n])).rowCount === 1;
export const siguientePasillo = async (client) => (await client.query(`SELECT COALESCE(max(numero), 0) + 1 AS n FROM bodega_pasillo`)).rows[0].n;
export const crearPasillo = (n, client) => client.query(`INSERT INTO bodega_pasillo (numero) VALUES ($1)`, [n]);
export const borrarPasillo = (n, client) => client.query(`DELETE FROM bodega_pasillo WHERE numero = $1`, [n]);
export const racksDePasillo = async (n, client) => (await client.query(`SELECT letra, pisos FROM bodega_rack WHERE numero_pasillo = $1 ORDER BY letra`, [n])).rows;

// Bloquea el rack para que una asignación de ubicación no se cruce con un cambio de estructura.
export async function rackBloqueado(n, letra, client, modo = 'UPDATE') {
  const { rows } = await client.query(`SELECT pisos FROM bodega_rack WHERE numero_pasillo = $1 AND letra = $2 FOR ${modo}`, [n, letra]);
  return rows[0]?.pisos;
}
export const crearRack = (n, letra, pisos, client) => client.query(`INSERT INTO bodega_rack (numero_pasillo, letra, pisos) VALUES ($1,$2,$3)`, [n, letra, pisos]);
export const fijarPisos = (n, letra, pisos, client) => client.query(`UPDATE bodega_rack SET pisos = $3 WHERE numero_pasillo = $1 AND letra = $2`, [n, letra, pisos]);
export const borrarRack = (n, letra, client) => client.query(`DELETE FROM bodega_rack WHERE numero_pasillo = $1 AND letra = $2`, [n, letra]);

// Productos ubicados en las etiquetas dadas (para impedir que la estructura deje ubicaciones huérfanas).
export async function productosEn(etiquetas, client) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM inventario WHERE ubicacion_bodega = ANY($1)`, [etiquetas]);
  return rows[0].n;
}
