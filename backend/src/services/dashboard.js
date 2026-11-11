import { config } from '../config.js';
import { conCache } from '../cache.js';
import { AppError } from '../errors.js';
import * as repo from '../repositories/dashboard.js';

// Caché Redis de 30 s para cumplir PR-04 (< 400 ms); DashboardMetricObserver la invalida al cambiar el stock.
export async function kpis() {
  return conCache('kpis:dashboard', config.kpiTtl, async () => ({ ...(await repo.kpis()), generado: new Date().toISOString() }));
}

export const topProductos = () => conCache('top:dashboard', config.kpiTtl, () => repo.topProductos());

export async function alertas() {
  return conCache('alertas:dashboard', config.kpiTtl, async () => {
    const items = await repo.alertas();
    return { quiebres: items.length, items };
  });
}

export const PERIODOS = ['semana', 'mes', 'anio'];
export const UMBRAL_ROTACION = 3; // desde esta rotación el producto es de «alta rotación»
export const CANALES = [['web', 'Web'], ['marketplace', 'Marketplace'], ['mayorista', 'Mayorista']];

const DIA_MS = 864e5;
const SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const fecha = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const mas = (s, n) => iso(new Date(fecha(s).getTime() + n * DIA_MS));
const finDeMes = (s) => { const d = fecha(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
const corto = (s) => `${+s.slice(8)} ${MES[+s.slice(5, 7) - 1]}`;

export function validarPeriodo(periodo = 'mes') {
  if (!PERIODOS.includes(periodo)) throw new AppError(400, `periodo debe ser uno de: ${PERIODOS.join(', ')}`, 'VALIDACION');
  return periodo;
}

// Tramos del período hasta `hoy`: semana = últimos 7 días por día; mes = mes en curso por semana (la última, parcial si no
// está completa); año = año en curso por mes (el actual, parcial). `desde`/`hasta` son fechas locales inclusive.
export function tramos(periodo, hoy) {
  const [a, m] = [+hoy.slice(0, 4), +hoy.slice(5, 7)];
  if (periodo === 'semana') {
    const desde = mas(hoy, -6);
    const lista = Array.from({ length: 7 }, (_, i) => { const d = mas(desde, i); return { ini: d, fin: d, etiqueta: SEM[fecha(d).getUTCDay()], detalle: corto(d), parcial: false }; });
    const rango = desde.slice(5, 7) === hoy.slice(5, 7) ? `${+desde.slice(8)}–${corto(hoy)}` : `${corto(desde)}–${corto(hoy)}`;
    return { desde, lista, etiqueta: `Semana ${rango} ${a} · últimos 7 días` };
  }
  if (periodo === 'mes') {
    const desde = `${hoy.slice(0, 7)}-01`, finMes = finDeMes(hoy), lista = [];
    for (let ini = desde, k = 1; ini <= hoy; ini = mas(ini, 7), k++) {
      const fin = mas(ini, 6) < finMes ? mas(ini, 6) : finMes, ultimo = mas(ini, 7) > hoy;
      const parcial = ultimo && (hoy < fin || fin !== mas(ini, 6));
      lista.push({ ini, fin, etiqueta: `Sem ${k}${parcial ? '*' : ''}`, detalle: `${+ini.slice(8)}–${+fin.slice(8)} ${MES[m - 1]}`, parcial });
    }
    return { desde, lista, etiqueta: `${MES_LARGO[m - 1]} ${a} · consolidado mensual (1–${+hoy.slice(8)} ${MES[m - 1]})` };
  }
  const lista = Array.from({ length: m }, (_, i) => {
    const ini = `${a}-${String(i + 1).padStart(2, '0')}-01`, fin = finDeMes(ini);
    return { ini, fin, etiqueta: MES_LARGO[i].slice(0, 3), detalle: String(a), parcial: i + 1 === m && hoy < fin };
  });
  return { desde: `${a}-01-01`, lista, etiqueta: `${a} · consolidado anual (1 ene–${corto(hoy)})` };
}

const redondear = (n) => Math.round(n * 10) / 10;

// Arma la respuesta de /graficos a partir de las consultas. Los campos «margen*» los omite el filtro global de costos si el rol no tiene `costos:leer`.
async function calcular(periodo) {
  const hoy = await repo.hoy();
  const { desde, lista, etiqueta } = tramos(periodo, hoy);
  const r = await repo.graficos(desde, hoy);
  const serie = lista.map((t) => ({ clave: t.ini, etiqueta: t.etiqueta, detalle: t.detalle, parcial: t.parcial, total: 0, ...Object.fromEntries(CANALES.flatMap(([k]) => [[k, 0], [`margen_${k}`, null]])), _m: {} }));
  const total = { ventas: 0, margen: 0, ordenes: 0 }, porCanal = Object.fromEntries(CANALES.map(([k]) => [k, { ventas: 0, margen: 0 }]));
  for (const f of r.serie) {
    const i = lista.findIndex((t) => f.dia >= t.ini && f.dia <= t.fin), s = serie[i];
    s[f.grupo] += f.ventas; s.total += f.ventas; s._m[f.grupo] = (s._m[f.grupo] ?? 0) + f.margen_bruto;
    porCanal[f.grupo].ventas += f.ventas; porCanal[f.grupo].margen += f.margen_bruto;
    total.ventas += f.ventas; total.margen += f.margen_bruto; total.ordenes += f.ordenes;
  }
  for (const s of serie) {
    for (const [k] of CANALES) s[`margen_${k}`] = s[k] ? redondear(100 * s._m[k] / s[k]) : null;
    delete s._m;
  }
  const pct = (a, b) => (b ? redondear(100 * a / b) : null);
  const inmo = r.inmovilizado, valorInmo = inmo.reduce((a, x) => a + x.valor, 0);
  return {
    periodo, desde, hasta: hoy, etiqueta,
    ventas_por_canal: r.ventas, margenes: r.margenes,
    totales: { ventas: total.ventas, ordenes: total.ordenes, margen_bruto: total.margen, margen_pct: pct(total.margen, total.ventas) },
    canales: CANALES.map(([k, canal]) => ({ canal, ventas: porCanal[k].ventas, pct_ventas: pct(porCanal[k].ventas, total.ventas), margen_bruto: porCanal[k].margen, margen_pct: pct(porCanal[k].margen, porCanal[k].ventas) })),
    serie,
    umbral_rotacion: UMBRAL_ROTACION,
    rotacion: r.rotacion.map((x) => ({ ...x, alta: x.rotacion >= UMBRAL_ROTACION })),
    inmovilizado: inmo,
    inmovilizado_resumen: { skus: inmo.length, valor: valorInmo, pct_valorizacion: pct(valorInmo, r.valorizacion) },
  };
}

// La caché guarda todo; el valor inmovilizado (stock × costo) se quita aquí si el rol no tiene `costos:leer`
// (los campos «margen*» y «*valorizacion*» ya los omite el filtro global de middleware/costos.js).
// «mes» conserva la clave histórica para no invalidar nada que ya dependa de ella.
export async function graficos(conCostos, periodo = 'mes') {
  validarPeriodo(periodo);
  const r = await conCache(periodo === 'mes' ? 'graficos:dashboard' : `graficos:dashboard:${periodo}`, config.kpiTtl, () => calcular(periodo));
  if (conCostos) return r;
  const { valor, ...resumen } = r.data.inmovilizado_resumen;
  return { ...r, data: { ...r.data, inmovilizado_resumen: resumen, inmovilizado: r.data.inmovilizado.map(({ valor: _, ...resto }) => resto) } };
}
