import { crearApp } from './app.js';
import { config } from './config.js';
import { iniciarCache } from './cache.js';

await iniciarCache();
crearApp().listen(config.port, () => console.log(`SGI Oregón API escuchando en http://localhost:${config.port}`));

// Un error no capturado deja el proceso en estado indefinido: se registra y se sale para que el supervisor (systemd/EB) lo reinicie.
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => { console.error(`[fatal] ${ev}:`, e); process.exit(1); });
}
