import { useEffect, useState } from 'react';
import { api } from '../api.js';

const clp = (n) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export default function Dashboard() {
  const [k, setK] = useState(null);
  const [cache, setCache] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/dashboard/kpis').then(({ data, cache }) => { setK(data); setCache(cache); }).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!k) return <p className="centro">Cargando…</p>;
  return (
    <>
      <h2>Dashboard <small className="suave">caché: {cache}</small></h2>
      <div className="kpis">
        <div className="card kpi"><span>Valorización de inventario</span><b>{clp(k.valorizacion_inventario)}</b></div>
        <div className="card kpi"><span>Órdenes pendientes</span><b>{k.ordenes_pendientes}</b></div>
        <div className="card kpi"><span>Margen promedio</span><b>{k.margen_promedio ?? '—'}%</b></div>
        <div className={`card kpi ${k.stock_critico ? 'alerta' : ''}`}><span>Stock crítico</span><b>{k.stock_critico}</b></div>
      </div>
      <h3>Productos con stock crítico</h3>
      {k.productos_criticos.length === 0 ? <p className="suave">Sin alertas.</p> : (
        <div className="scroll"><table>
          <thead><tr><th>SKU</th><th>Producto</th><th>Marca</th><th className="n">Stock</th><th className="n">Mínimo</th><th>Ubicación</th></tr></thead>
          <tbody>{k.productos_criticos.map((p) => (
            <tr key={p.sku}><td>{p.sku}</td><td>{p.nombre}</td><td>{p.marca}</td><td className="n">{p.stock_fisico}</td><td className="n">{p.stock_minimo}</td><td>{p.ubicacion_bodega}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {/* TODO(HU09): alertas de reposición, gráfico de ventas por canal, filtros por fecha. */}
    </>
  );
}
