import { query } from '../db.js';
import { auditar } from '../audit.js';
import { InventarioObserver } from './inventario.js';

// T36: tras una REBAJA evalúa el SKU contra su umbral (vista v_stock_critico: stock_fisico <= stock_minimo)
// y deja la alerta en la bitácora (ALERTA_STOCK_CRITICO, PI-06). Un ingreso no genera alerta.
export class AlertaStockCriticoService extends InventarioObserver {
  async evaluar(sku) {
    const { rows } = await query(`SELECT sku, stock_fisico, stock_minimo FROM v_stock_critico WHERE sku = $1`, [sku]);
    return rows[0] ?? null;
  }

  async actualizar({ tipo, sku }) {
    if (tipo !== 'REBAJA') return;
    const critico = await this.evaluar(sku);
    if (critico) await auditar({}, { tabla: 'inventario', accion: 'ALERTA_STOCK_CRITICO', despues: critico });
  }
}
