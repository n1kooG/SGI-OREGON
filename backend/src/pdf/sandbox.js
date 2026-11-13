// Ejecuta una tarea sobre datos NO confiables (PDF) en un worker_thread con tiempo y memoria acotados. pdfjs corre en el hilo
// que lo llama: un PDF hostil que cicle o pida GB bloquearía todo el servidor, y un Promise.race no interrumpe código síncrono.
// Con un worker, el hilo principal sigue atendiendo y `terminate()` corta la tarea a la fuerza.
import { Worker } from 'node:worker_threads';

// memoriaMb limita el heap de cada worker, pero NO los ArrayBuffer/Buffer (un PDF que se descomprime en miles de veces los usa): por eso
// un vigilante mide el RSS del proceso y corta todos los workers si crece más de rssMb por encima de lo que había al empezar.
export const LIMITES_TAREA = { tiempoMs: 8000, memoriaMb: 256, concurrencia: 3, rssMb: 600, vigilanciaMs: 25 };

let activos = 0;
const vivos = new Set(); // workers en ejecución: { terminar }
let vigilante = null, rssBase = 0;
const cola = [];

function vigilar() {
  if (vigilante || !vivos.size) return;
  rssBase = process.memoryUsage.rss();
  vigilante = setInterval(() => {
    if (!vivos.size) { clearInterval(vigilante); vigilante = null; return; }
    if (process.memoryUsage.rss() - rssBase > LIMITES_TAREA.rssMb * 1024 * 1024) for (const v of [...vivos]) v.terminar('MEMORIA', 'La lectura superó el límite de memoria');
  }, LIMITES_TAREA.vigilanciaMs);
  vigilante.unref();
}

const liberar = () => { activos--; cola.shift()?.(); };
const turno = () => (activos < LIMITES_TAREA.concurrencia ? (activos++, Promise.resolve()) : new Promise((ok) => cola.push(() => { activos++; ok(); })));

// Devuelve lo que el worker envía con postMessage; rechaza con Error({ code: 'TIEMPO_AGOTADO' | 'MEMORIA' | 'FALLO' }).
// `hasta` (ms epoch) es un presupuesto total compartido (p. ej. de un lote): si ya venció al obtener turno no se lanza nada.
export async function ejecutarAislado(archivoWorker, datos, { tiempoMs = LIMITES_TAREA.tiempoMs, memoriaMb = LIMITES_TAREA.memoriaMb, hasta = Infinity } = {}) {
  await turno(); // un lote de 100 archivos no lanza 100 workers a la vez
  try {
    const restante = hasta - Date.now();
    if (restante <= 0) throw Object.assign(new Error('Se agotó el presupuesto de tiempo'), { code: 'PRESUPUESTO' });
    tiempoMs = Math.min(tiempoMs, restante);
    return await new Promise((resolve, reject) => {
      const w = new Worker(archivoWorker, { workerData: datos, resourceLimits: { maxOldGenerationSizeMb: memoriaMb, maxYoungGenerationSizeMb: 32 } });
      const yo = { terminar: (code, msg) => falla(code, msg) };
      const falla = (code, msg) => { clearTimeout(reloj); vivos.delete(yo); w.terminate(); reject(Object.assign(new Error(msg), { code })); };
      const reloj = setTimeout(() => falla('TIEMPO_AGOTADO', 'Se agotó el tiempo de lectura'), tiempoMs);
      vivos.add(yo); vigilar();
      w.once('message', (m) => { clearTimeout(reloj); vivos.delete(yo); w.terminate(); resolve(m); });
      w.once('error', (e) => falla(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'MEMORIA' : 'FALLO', e.message));
      w.once('exit', (c) => falla('FALLO', `El lector terminó sin resultado (${c})`)); // no-op si ya se resolvió
    });
  } finally { liberar(); }
}
