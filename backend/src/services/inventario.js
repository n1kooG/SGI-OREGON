import * as repo from '../repositories/inventario.js';

export const buscar = (q) => (q.length < 2 ? [] : repo.buscar(q));
