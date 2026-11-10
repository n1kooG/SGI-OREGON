// T35: patrón Observer. El sujeto avisa a sus observadores cada vez que cambia el stock físico (sin polling).
export class InventarioObserver {
  // evento = { tipo: 'INGRESO' | 'REBAJA', sku, cantidad }
  async actualizar(_evento) { throw new Error('actualizar() no implementado'); }
}

export class SujetoInventario {
  #observadores = new Set();
  suscribir(o) { this.#observadores.add(o); return this; }
  desuscribir(o) { this.#observadores.delete(o); }
  // Un observador que falla no impide que los demás reciban el evento.
  async notificar(evento) {
    for (const o of this.#observadores) {
      try { await o.actualizar(evento); } catch (e) { console.error("[observer]", o.constructor.name, e.message); }
    }
  }
}
