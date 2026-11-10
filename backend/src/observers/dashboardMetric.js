import { redisDel } from '../cache.js';
import { InventarioObserver } from './inventario.js';

export const CLAVES_DASHBOARD = ['kpis:dashboard', 'alertas:dashboard', 'graficos:dashboard'];

// T43: cualquier movimiento de stock invalida la caché de KPI; la próxima consulta recalcula (el TTL de 30 s queda como red de seguridad).
export class DashboardMetricObserver extends InventarioObserver {
  async actualizar() { await redisDel(...CLAVES_DASHBOARD); }
}
