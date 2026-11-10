import { config } from '../config.js';
import { conCache } from '../cache.js';
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

// La caché guarda todo; el valor inmovilizado (stock × costo) se quita aquí si el rol no tiene `costos:leer`
// (los campos «margen*» ya los omite el filtro global de middleware/costos.js).
export async function graficos(conCostos) {
  const r = await conCache('graficos:dashboard', config.kpiTtl, () => repo.graficos());
  if (conCostos) return r;
  return { ...r, data: { ...r.data, inmovilizado: r.data.inmovilizado.map(({ valor, ...resto }) => resto) } };
}
