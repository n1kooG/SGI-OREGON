import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const clp = (n) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export default function Productos() {
  const { puede } = useAuth();
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { api('/productos').then(({ data }) => setFilas(data)).catch((e) => setError(e.message)); }, []);
  const verCostos = puede('costos:leer');

  return (
    <>
      <h2>Catálogo</h2>
      {/* TODO(HU01/HU02): botón "Nuevo producto", edición de ficha y de listas de precio (catalogo:escribir / precios:escribir). */}
      {error && <p className="error">{error}</p>}
      <div className="scroll"><table>
        <thead><tr>
          <th>SKU</th><th>Modelo</th><th>Nombre</th><th>Marca</th><th className="n">Stock</th>
          {verCostos && <th className="n">Costo neto</th>}<th>Precios (neto)</th><th>Estado</th>
        </tr></thead>
        <tbody>{filas.map((p) => (
          <tr key={p.sku}>
            <td>{p.sku}</td><td>{p.modelo}</td><td>{p.nombre}</td><td>{p.marca}</td>
            <td className={`n ${p.stock_fisico <= p.stock_minimo ? 'crit' : ''}`}>{p.stock_fisico}</td>
            {verCostos && <td className="n">{clp(p.costo_adquisicion_neto)}</td>}
            <td>{p.precios ? Object.entries(p.precios).map(([c, v]) => (
              <div key={c}>{c}: {clp(v.precio)}{v.margen != null && <small className="suave"> ({v.margen}%)</small>}</div>
            )) : '—'}</td>
            <td>{p.estado}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
