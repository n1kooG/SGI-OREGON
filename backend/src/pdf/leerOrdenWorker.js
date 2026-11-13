// Worker de la lectura de etiquetas: extrae el texto con pdfjs y devuelve SOLO el N° de orden (nunca el texto), de modo que las
// expresiones regulares sobre texto hostil también corren aquí y no en el hilo principal.
import { parentPort, workerData } from 'node:worker_threads';
import { extraerTexto, extraerNumeroOrden } from './leerOrden.js';

const MAX_TEXTO = 200_000; // una etiqueta tiene unos cientos de caracteres
const texto = (await extraerTexto(workerData.buffer)).slice(0, MAX_TEXTO);
parentPort.postMessage({ numero: extraerNumeroOrden(texto) });
