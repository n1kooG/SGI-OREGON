// Caché Redis (PR-04). Si Redis no está disponible el sistema sigue funcionando sin caché.
import { createClient } from 'redis';
import { config } from './config.js';

let client = null;

export async function iniciarCache() {
  if (!config.redisUrl) return;
  try {
    client = createClient({ url: config.redisUrl, socket: { reconnectStrategy: false } });
    client.on('error', () => {});
    await client.connect();
  } catch {
    client = null;
    console.warn('[cache] Redis no disponible: el dashboard funcionará sin caché');
  }
}

export async function cerrarCache() {
  if (client) await client.quit().catch(() => {});
  client = null;
}

export async function conCache(clave, ttlSegundos, calcular) {
  if (client) {
    try {
      const hit = await client.get(clave);
      if (hit) return { data: JSON.parse(hit), cache: 'HIT' };
    } catch { /* se ignora: se calcula directo */ }
  }
  const data = await calcular();
  if (client) {
    try { await client.set(clave, JSON.stringify(data), { EX: ttlSegundos }); } catch { /* idem */ }
  }
  return { data, cache: client ? 'MISS' : 'OFF' };
}
