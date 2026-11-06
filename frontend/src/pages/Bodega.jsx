import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Búsqueda predictiva por SKU / modelo / nombre (HU06). Sin costos ni márgenes (PU-09).
export default function Bodega() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => {
      api(`/inventario/buscar?q=${encodeURIComponent(q.trim())}`).then(({ data }) => { setRes(data); setError(''); }).catch((e) => setError(e.message));
    }, 250); // debounce
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <h2>Consulta de inventario</h2>
      <input className="buscar" autoFocus placeholder="SKU, modelo o nombre (mín. 2 letras)" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <div className="lista">
        {res.map((p) => (
          <div className="card item" key={p.sku}>
            <div><b>{p.sku}</b> · {p.marca}<br />{p.nombre}<br /><span className="suave">{p.ubicacion_bodega ?? 'Sin ubicación'}</span></div>
            <div className="disp"><b>{p.stock_disponible}</b><span>disponibles</span><small>{p.stock_fisico} físico · {p.stock_reservado} reservado</small></div>
          </div>
        ))}
      </div>
      {/* TODO(HU05): lista de picking (pedidos pendientes) y cambio de estado ARMADO → ETIQUETADO → EN_CAMION. */}
    </>
  );
}
