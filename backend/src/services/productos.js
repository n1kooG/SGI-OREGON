import * as repo from '../repositories/productos.js';

export const listar = (permisos) =>
  repo.listar({ verCostos: permisos.includes('costos:leer'), verPrecios: permisos.includes('precios:leer') });
