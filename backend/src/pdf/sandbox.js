// Ejecuta una tarea sobre datos NO confiables (PDF) en un worker_thread con tiempo y memoria acotados. pdfjs corre en el hilo
// que lo llama: un PDF hostil que cicle o pida GB bloquearía todo el servidor, y un Promise.race no interrumpe código síncrono.
// Con un worker, el hilo principal sigue atendiendo y `terminate()` corta la tarea a la fuerza.
import { Worker } from 'node:worker_threads';

export const LIMITES_TAREA = { tiempoMs: 8000, memoriaMb: 256, concurrencia: 3 };

let activos = 0;
const cola = [];
const liberar = () => { activos--; cola.shift()?.(); };
const turno = () => (activos < LIMITES_TAREA.concurrencia ? (activos++, Promise.resolve()) : new Promise((ok) => cola.push(() => { activos++; ok(); })));

// Devuelve lo que el worker envía con postMessage; rechaza con Error({ code: 'TIEMPO_AGOTADO' | 'MEMORIA' | 'FALLO' }).
export async function ejecutarAislado(archivoWorker, datos, { tiempoMs = LIMITES_TAREA.tiempoMs, memoriaMb = LIMITES_TAREA.memoriaMb } = {}) {
  await turno(); // un lote de 100 archivos no lanza 100 workers a la vez
  try {
    return await new Promise((resolve, reject) => {
      const w = new Worker(archivoWorker, { workerData: datos, resourceLimits: { maxOldGenerationSizeMb: memoriaMb, maxYoungGenerationSizeMb: 32 } });
      const falla = (code, msg) => { clearTimeout(reloj); w.terminate(); reject(Object.assign(new Error(msg), { code })); };
      const reloj = setTimeout(() => falla('TIEMPO_AGOTADO', 'Se agotó el tiempo de lectura'), tiempoMs);
      w.once('message', (m) => { clearTimeout(reloj); w.terminate(); resolve(m); });
      w.once('error', (e) => falla(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'MEMORIA' : 'FALLO', e.message));
      w.once('exit', (c) => falla('FALLO', `El lector terminó sin resultado (${c})`)); // no-op si ya se resolvió
    });
  } finally { liberar(); }
}
