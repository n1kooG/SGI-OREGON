import { useCallback, useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Icono, useAviso } from '../componentes/ui.jsx';
import SelectorUbicacion from '../componentes/SelectorUbicacion.jsx';
import { useEscritorio } from '../componentes/useEscritorio.js';

const LOTE_SIN = { escritorio: 4, movil: 3 }; // filas visibles de «Sin ubicación» antes de «Ver los N restantes»
const TOPE_SIN = 100; // máximo que acepta el endpoint por consulta
const ubi = (u) => u.replace(' - ', ' · ');

// Selector de ubicación en línea: sirve a los resultados y a los productos sin ubicación.
function EditorUbicacion({ sku, onGuardado, onCancelar }) {
  const aviso = useAviso();
  const [valor, setValor] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    setError(''); setOcupado(true);
    try {
      const { data } = await api(`/inventario/${encodeURIComponent(sku)}/ubicacion`, { metodo: 'PUT', cuerpo: { ubicacion_bodega: valor } });
      aviso(`Ubicación de ${sku} actualizada.`);
      onGuardado(data.ubicacion_bodega);
    } catch (e) { setError(mensajeError(e)); setOcupado(false); }
  }
  return (
    <div className="editor-ubi">
      <SelectorUbicacion valor={valor} onChange={setValor} />
      <Alerta>{error}</Alerta>
      <div className="acciones-ubi">
        <Boton onClick={onCancelar} disabled={ocupado}>Cancelar</Boton>
        <Boton variante="primario" onClick={guardar} disabled={ocupado || !valor}>{ocupado ? 'Guardando…' : 'Guardar'}</Boton>
      </div>
    </div>
  );
}

// Ficha de un producto (móvil): la ubicación se edita en el mismo lugar, sin salir del resultado.
function Resultado({ p, onCambio }) {
  const [editando, setEditando] = useState(false);
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
            <EditorUbicacion sku={p.sku} onGuardado={(u) => { onCambio(p.sku, u); setEditando(false); }} onCancelar={() => setEditando(false)} />
          ) : (
            <>
              <span className={`chip-ubicacion ${p.ubicacion_bodega ? '' : 'vacia'}`}>{p.ubicacion_bodega && <Icono n="pin" />}{p.ubicacion_bodega ? ubi(p.ubicacion_bodega) : 'Sin ubicación'}</span>
              <Boton className="bloque" onClick={() => setEditando(true)}>Cambiar ubicación</Boton>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

// Escritorio: tabla de resultados; al editar, la fila se despliega con el campo.
function FilaResultado({ p, onCambio }) {
  const [editando, setEditando] = useState(false);
  return (
    <div className={`bs-fila bs-res ${editando ? 'editando' : ''}`}>
      <span><span className="chip-sku">{p.sku}</span></span>
      <strong>{p.nombre}</strong>
      <span>{p.marca}</span>
      <b className={`dato ${p.stock_disponible > 0 ? 'ok' : 'mal'}`}>{p.stock_disponible}</b>
      <span className="dato">{p.stock_fisico}</span>
      <span className="dato">{p.stock_reservado}</span>
      <span><span className={`chip-ubicacion ${p.ubicacion_bodega ? '' : 'vacia'}`}>{p.ubicacion_bodega && <Icono n="pin" />}{p.ubicacion_bodega ? ubi(p.ubicacion_bodega) : 'Sin ubicación'}</span></span>
      <Boton onClick={() => setEditando(!editando)} aria-expanded={editando}>Cambiar ubicación</Boton>
      {editando && <div className="bs-edicion"><span>Ubicación</span><EditorUbicacion sku={p.sku} onGuardado={(u) => { onCambio(p.sku, u); setEditando(false); }} onCancelar={() => setEditando(false)} /></div>}
    </div>
  );
}

// Producto sin ubicación: «Asignar ubicación» abre el campo en la misma fila (escritorio) o tarjeta (móvil).
function ProductoSin({ p, escritorio, onAsignado }) {
  const [editando, setEditando] = useState(false);
  const boton = <Boton icono="pin" onClick={() => setEditando(!editando)} aria-expanded={editando}>Asignar ubicación</Boton>;
  const editor = editando && <EditorUbicacion sku={p.sku} onGuardado={(u) => onAsignado(p.sku, u)} onCancelar={() => setEditando(false)} />;
  if (escritorio) {
    return (
      <div className={`bs-fila bs-sin ${editando ? 'editando' : ''}`}>
        <span><span className="chip-sku">{p.sku}</span></span>
        <strong>{p.nombre}</strong>
        <span>{p.marca}</span>
        <span className="dato">{p.stock_fisico} un.</span>
        {boton}
        {editando && <div className="bs-edicion"><span>Ubicación</span>{editor}</div>}
      </div>
    );
  }
  return (
    <article className={`tarjeta-sin ${editando ? 'editando' : ''}`}>
      <span className="chip-sku">{p.sku}</span>
      <strong>{p.nombre}</strong>
      <p className="marca-fila"><span className="tenue">Marca:</span><b>{p.marca}</b><span className="tenue">·</span><span className="tenue">Stock físico:</span><b className="dato">{p.stock_fisico} un.</b></p>
      {editando ? editor : boton}
    </article>
  );
}

function SinUbicacion({ escritorio, sin, error, onVerMas, onAsignado, cargando }) {
  if (!sin) return error ? <Alerta>{error}</Alerta> : null;
  const restantes = sin.total - sin.items.length;
  return (
    <section className="bs-sin-sec">
      <div className="bs-sin-cab"><h2>Sin ubicación ({sin.total})</h2>{sin.total > 0 && <span className="badge aviso">{escritorio ? 'Falta pasillo, rack y piso' : 'Falta ubicar'}</span>}</div>
      <p className="tenue">{escritorio ? 'Productos con stock en bodega que todavía no tienen una ubicación asignada.' : 'Productos con stock que todavía no tienen pasillo ni rack.'}</p>
      <Alerta>{error}</Alerta>
      {sin.total === 0 ? (
        <div className="sin-nada bs-vacio">
          <span className="sello-ok"><Icono n="check" /></span>
          <strong>Todos los productos tienen ubicación</strong>
          <p>No hay nada por asignar. Los productos nuevos sin ubicación aparecerán aquí.</p>
        </div>
      ) : (
        <div className={escritorio ? 'bs-tabla' : 'bs-tarjetas'}>
          {escritorio && <div className="bs-fila bs-sin bs-cab"><span>SKU</span><span>Producto</span><span>Marca</span><span>Stock físico</span><span /></div>}
          {sin.items.map((p) => <ProductoSin key={p.sku} p={p} escritorio={escritorio} onAsignado={onAsignado} />)}
          {restantes > 0 && (escritorio
            ? <div className="bs-mas"><button type="button" className="bi-ver" onClick={onVerMas} disabled={cargando}>Ver los {restantes} restantes</button></div>
            : <Boton className="ver-mas" onClick={onVerMas} disabled={cargando}>Ver los {restantes} restantes</Boton>)}
        </div>
      )}
    </section>
  );
}

export default function BodegaBuscador() {
  const escritorio = useEscritorio();
  const lote = escritorio ? LOTE_SIN.escritorio : LOTE_SIN.movil;
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null); // null = aún no se busca
  const [error, setError] = useState('');
  const [sin, setSin] = useState(null);
  const [errorSin, setErrorSin] = useState('');
  const [cargandoSin, setCargandoSin] = useState(false);

  // Pide siempre desde la primera página con `limite` filas: así quitar una fila asignada no desplaza ni salta productos.
  const cargarSin = useCallback(async (limite) => {
    setCargandoSin(true);
    try { setSin((await api(`/inventario/sin-ubicacion?limite=${limite}&pagina=1`)).data); setErrorSin(''); } catch (e) { setErrorSin(mensajeError(e)); } finally { setCargandoSin(false); }
  }, []);
  useEffect(() => { cargarSin(lote); }, [cargarSin, lote]);

  // Una ubicación guardada desde los resultados saca al producto de «Sin ubicación», y viceversa.
  const cambio = (sku, u) => {
    setRes((r) => r && r.map((x) => (x.sku === sku ? { ...x, ubicacion_bodega: u } : x)));
    setSin((s) => (s && s.items.some((x) => x.sku === sku) ? { ...s, total: s.total - 1, items: s.items.filter((x) => x.sku !== sku) } : s));
  };

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

  const sinProps = { escritorio, sin, onAsignado: cambio, error: errorSin, cargando: cargandoSin, onVerMas: () => cargarSin(Math.min(TOPE_SIN, sin.total)) };
  const buscador = (
    <div className="buscador grande">
      <Icono n="search" />
      <input className="entrada" type="search" autoFocus aria-label="Buscar por SKU o modelo" placeholder="SKU o modelo (ej. TH-45)" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
    </div>
  );
  if (escritorio) {
    return (
      <div className="bs-esc buscador-stock">
        <header className="bd-cab"><div><h1>Buscador de stock</h1><span className="tenue">Busque por SKU o parte del nombre; los resultados se actualizan mientras escribe.</span></div></header>
        {buscador}
        <Alerta>{error}</Alerta>
        {res && !error && <p className="bs-cuenta">{res.length ? `${res.length} ${res.length === 1 ? 'resultado' : 'resultados'} para «${q.trim()}»` : `Sin resultados para «${q.trim()}».`}</p>}
        {res?.length > 0 && (
          <div className="bs-tabla">
            <div className="bs-fila bs-res bs-cab"><span>SKU</span><span>Producto</span><span>Marca</span><span>Disponible</span><span>Físico</span><span>Reservadas</span><span>Ubicación</span><span /></div>
            {res.map((p) => <FilaResultado key={p.sku} p={p} onCambio={cambio} />)}
          </div>
        )}
        <SinUbicacion {...sinProps} />
      </div>
    );
  }
  return (
    <div className="movil-pagina buscador-stock">
      <span className="rotulo-busca">Búsqueda rápida de pasillo y stock</span>
      {buscador}
      <p className="ayuda">Escriba un SKU o parte del nombre; los resultados se actualizan mientras escribe.</p>
      <Alerta>{error}</Alerta>
      {res && !res.length && !error && <p className="vacio">Sin resultados para «{q.trim()}».</p>}
      {res?.map((p) => <Resultado key={p.sku} p={p} onCambio={cambio} />)}
      <SinUbicacion {...sinProps} />
    </div>
  );
}
