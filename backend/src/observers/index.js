import { SujetoInventario } from './inventario.js';
import { AlertaStockCriticoService } from './alertaStockCritico.js';
import { DashboardMetricObserver } from './dashboardMetric.js';

export const alertaStock = new AlertaStockCriticoService();
export const metricasDashboard = new DashboardMetricObserver();
export const sujetoInventario = new SujetoInventario().suscribir(alertaStock).suscribir(metricasDashboard);
