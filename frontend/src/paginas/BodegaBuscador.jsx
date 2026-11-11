import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Icono, useAviso } from '../componentes/ui.jsx';

const MAX_UBI = 40;

// Ficha de un producto: la ubicación se edita en el mismo lugar, sin salir del resultado.
function Resultado({ p, onCambio }) {
  const aviso = useAviso();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    setError(''); setOcupado(true);
    try {
      const { data } = await api(`/inventario/${encodeURIComponent(p.sku)}/ubicacion`, { metodo: 'PUT', cuerpo: { ubicacion_bodega: valor.trim() } });
      onCambio({ ...p, ubicacion_bodega: data.ubicacion_bodega });
      aviso(`Ubicación de ${p.sku} actualizada.`);
      setEditando(false);
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(false); }
  }

  const hay = p.stock_disponible > 0;
  return (
    <article className={`tarjeta-stock ${!hay ? 'sin-stock' : ''} ${editando ? 'editando' : ''}`}>
      <div className="fila-sb">
        <span className="chip-sku">{p.sku}</span>
        <Badge tono={hay ? 'ok' : 'mal'}>{hay ? 'Stock disponible' : 'Sin stock disponible'}</Badge>
      </div>
      <h2>{p.nombre}</h2>
      {p.marca && <p className="marca-fila"><span className="tenue">Marca:</span><span>{p.marca}</span></p>}
      <div className="stock-cols">
        <div><span className="etiqueta">Stock disponible</span><div className="cifra">{p.stock_disponible}<small> unidades</small></div></div>
        <div>
          <span className="etiqueta">Ubicación en bodega</span>
          {editando ? (
            <>
              <div className="campo-ubicacion">
                <input className="entrada" autoFocus aria-label="Nueva ubicación" placeholder="Ej. Pasillo A - Estante 2" maxLength={MAX_UBI} value={valor} onChange={(e) => setValor(e.target.value)} />
                <span className="dato">{valor.length}/{MAX_UBI}</span>
              </div>
              <span className="ayuda">Máximo {MAX_UBI} caracteres. Se registra quién y cuándo la cambió.</span>
              <Alerta>{error}</Alerta>
              <div className="acciones-ubi">
                <Boton onClick={() => { setEditando(false); setError(''); }} disabled={ocupado}>Cancelar</Boton>
                <Boton variante="primario" onClick={guardar} disabled={ocupado || !valor.trim()}>{ocupado ? 'Guardando…' : 'Guardar'}</Boton>
              </div>
            </>
          ) : (
            <>
              <span className={`chip-ubicacion ${p.ubicacion_bodega ? '' : 'vacia'}`}>{p.ubicacion_bodega && <Icono n="pin" />}{p.ubicacion_bodega ? p.ubicacion_bodega.replace(' - ', ' · ') : 'Sin ubicación'}</span>
              <Boton className="bloque" onClick={() => { setValor(''); setEditando(true); }}>Cambiar ubicación</Boton>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

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
    <div className="movil-pagina buscador-stock">
      <span className="rotulo-busca">Búsqueda rápida de pasillo y stock</span>
      <div className="buscador grande">
        <Icono n="search" />
        <input className="entrada" type="search" autoFocus aria-label="Buscar por SKU o modelo" placeholder="SKU o modelo (ej. TH-45)" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      <p className="ayuda">Escriba un SKU o parte del nombre; los resultados se actualizan mientras escribe.</p>
      <Alerta>{error}</Alerta>
      {res && !res.length && !error && <p className="vacio">Sin resultados para «{q.trim()}».</p>}
      {res?.map((p) => <Resultado key={p.sku} p={p} onCambio={(n) => setRes((r) => r.map((x) => (x.sku === n.sku ? n : x)))} />)}
    </div>
  );
}
