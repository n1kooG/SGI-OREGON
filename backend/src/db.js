import pg from 'pg';
import { config } from './config.js';
import { opcionesSsl } from './ssl.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  ssl: opcionesSsl(),
});

export const query = (text, params) => pool.query(text, params);

// Registra una acción para después del COMMIT de la transacción de `client` (observers: ver el estado ya confirmado). Si hay ROLLBACK se descarta.
export const trasCommit = (client, fn) => (client.trasCommit ??= []).push(fn);

// Ejecuta fn(client) dentro de una transacción: COMMIT si termina, ROLLBACK si lanza.
export async function conTransaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    for (const f of client.trasCommit ?? []) await f().catch((e) => console.error('[observer]', e.message)); // un observer nunca tumba la operación ya confirmada
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.trasCommit = null;
    client.release();
  }
}
