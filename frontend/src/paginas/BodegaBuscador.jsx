import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Icono } from '../componentes/ui.jsx';

export default function BodegaBuscador() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null); // null = aún no se busca
  const [error, setError] = useState('');

  // Búsqueda predictiva: espera 250 ms tras la última tecla; el backend exige 2+ caracteres. `viva` descarta respuestas viejas.
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes(null); setError(''); return undefined; }
    let viva = true;
    const h = setTimeout(async () => {
      try {
        const { data } = await api(`/inventario/buscar?q=${encodeURIComponent(t)}`);
        if (viva) { setRes(data); setError(''); }
      } catch (e) { if (viva) setError(mensajeError(e)); }
    }, 250);
    return () => { viva = false; clearTimeout(h); };
  }, [q]);

  return (
    <div className="movil-pagina">
      <span className="etiqueta">Búsqueda rápida de pasillo y stock</span>
      <div className="buscador grande">
        <Icono n="search" />
        <input className="entrada" type="search" autoFocus aria-label="Buscar por SKU o modelo" placeholder="SKU o modelo (ej. TH-45)" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      <p className="ayuda">Escribe al menos 2 caracteres del SKU, modelo o nombre.</p>
      <Alerta>{error}</Alerta>
      {res && !res.length && !error && <p className="vacio">Sin resultados para «{q.trim()}».</p>}
      {res?.map((p) => (
        <article className={`tarjeta-stock ${p.stock_disponible <= 0 ? 'sin-stock' : ''}`} key={p.sku}>
          <div className="fila-sb">
            <span className="chip-sku">{p.sku}</span>
            <span className={`badge ${p.stock_disponible > 0 ? 'ok' : 'mal'}`}>{p.stock_disponible > 0 ? `${p.stock_disponible} un. disponibles` : 'Sin stock disponible'}</span>
          </div>
          <h2>{p.nombre}</h2>
          <p className="tenue">{[p.marca && `Marca: ${p.marca}`, p.modelo && `Modelo: ${p.modelo}`].filter(Boolean).join(' · ')}</p>
          <div className="stock-cols">
            <div><span className="etiqueta">Stock físico</span><div className="cifra">{p.stock_fisico}<small> un.</small></div>{p.stock_reservado > 0 && <span className="tenue">{p.stock_reservado} reservadas</span>}</div>
            <div><span className="etiqueta">Ubicación en bodega</span><div className="ubicacion">{p.ubicacion_bodega ?? 'Sin ubicación'}</div></div>
          </div>
        </article>
      ))}
    </div>
  );
}
