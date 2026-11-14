import { useCallback, useEffect, useState } from 'react';
import { api, descargarArchivo, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Icono, useAviso } from '../componentes/ui.jsx';
import { ESTADOS, EstadoBadge, fechaCorta } from './Pedidos.jsx';
import { IcoDescargar, IcoPdf } from './etiquetaComun.jsx';
import { useEscritorio } from '../componentes/useEscritorio.js';

const Calendario = () => <svg className="icono" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
const FLUJO = ['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION'];

function Comentario({ idOrden, sku }) {
  const aviso = useAviso();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState('FALTANTE');
  const [txt, setTxt] = useState('');
  const [error, setError] = useState('');
  async function enviar(e) {
    e.preventDefault();
    setError('');
    try {
      await api(`/pedidos/${idOrden}/comentarios`, { metodo: 'POST', cuerpo: { sku, tipo, comentario: txt } });
      aviso(`Discrepancia de ${sku} registrada.`);
      setAbierto(false); setTxt('');
    } catch (err) { setError(mensajeError(err)); }
  }
  if (!abierto) return <Boton className="enlace" onClick={() => setAbierto(true)}>Comentarios</Boton>;
  return (
    <form onSubmit={enviar} className="comentario">
      <Campo como="select" etiqueta="Discrepancia" value={tipo} onChange={(e) => setTipo(e.target.value)}>
        <option value="FALTANTE">Faltante</option><option value="DANADO">Dañado</option>
      </Campo>
      <Campo como="textarea" etiqueta="Comentario" rows={2} maxLength={300} value={txt} onChange={(e) => setTxt(e.target.value)} required />
      <Alerta>{error}</Alerta>
      <div className="acciones"><Boton onClick={() => setAbierto(false)}>Cancelar</Boton><Boton type="submit" variante="primario">Guardar</Boton></div>
    </form>
  );
}

const cargadaEl = (f) => { const d = new Date(f); return d.toDateString() === new Date().toDateString() ? 'hoy' : d.toLocaleDateString('es-CL'); };

// Bodega solo descarga: si el pedido no trae la etiqueta importada, se avisa a quién pedirla.
function EtiquetaBodega({ p, esc }) {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState('');
  async function bajar() {
    setError(''); setDescargando(true);
    try { await descargarArchivo(`/pedidos/${p.id_orden}/etiqueta`, `etiqueta_${p.codigo_externo}.pdf`); }
    catch (e) { setError(mensajeError(e)); } finally { setDescargando(false); }
  }
  if (esc) {
    if (!p.tiene_etiqueta) return <div className="etq-sin esc"><IcoDescargar />Sin etiqueta: pídela a la jefatura</div>;
    return (
      <div className="etq-esc">
        <Boton disabled={descargando} onClick={bajar}><IcoDescargar />{descargando ? 'Descargando etiqueta…' : 'Descargar etiqueta'}</Boton>
        <div aria-live="assertive"><Alerta>{error}</Alerta></div>
      </div>
    );
  }
  if (!p.tiene_etiqueta) return <div className="etq-sin"><Icono n="info" />Sin etiqueta: pídela a jefatura</div>;
  const hora = new Date(p.etiqueta_importada_en).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div className="etq-bodega">
      <Boton variante="primario bloque" disabled={descargando} onClick={bajar}>{descargando ? <>Descargando etiqueta…</> : <><IcoPdf />Descargar etiqueta</>}</Boton>
      {descargando && <progress aria-label="Descargando etiqueta" />}
      <span className="etq-meta">{p.etiqueta_nombre_archivo} · {descargando ? 'descargando' : `cargada ${cargadaEl(p.etiqueta_importada_en)} ${hora}`}</span>
      <div aria-live="assertive"><Alerta>{error}</Alerta></div>
    </div>
  );
}

// Detalle del pedido, marcas de recolección y cambio de estado: lo comparten la tarjeta móvil y la fila de escritorio.
function usePedido(p, abierta, onCambio) {
  const [det, setDet] = useState(null);
  const [marcados, setMarcados] = useState({});
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!abierta || det) return;
    api(`/pedidos/${p.id_orden}`).then(({ data }) => setDet(data)).catch((e) => setError(mensajeError(e)));
  }, [abierta, det, p.id_orden]);

  async function estado(nuevo) {
    setError(''); setOcupado(true);
    try {
      await api(`/pedidos/${p.id_orden}/estado`, { metodo: 'PATCH', cuerpo: { estado: nuevo } });
      onCambio(); // recarga la lista (si pasa a otro estado sigue en la lista de bodega)
      return true;
    } catch (e) { setError(mensajeError(e)); return false; } finally { setOcupado(false); }
  }
  return { det, marcados, setMarcados, error, ocupado, estado };
}

function Tarjeta({ p, abierta, onAbrir, onCambio }) {
  const aviso = useAviso();
  const { det, marcados, setMarcados, error, ocupado, estado } = usePedido(p, abierta, onCambio);

  const items = det?.items ?? [];
  const completo = items.length > 0 && items.every((i) => marcados[i.sku]);
  return (
    <article className={`tarjeta-pedido ${abierta ? 'abierta' : ''}`}>
      <button type="button" className="tarjeta-cab" aria-expanded={abierta} onClick={onAbrir}>
        <div className="fila-sb"><span className="chip-sku">#{p.codigo_externo}</span><EstadoBadge e={p.estado_orden} /></div>
        {abierta && <span className="dato-fecha"><Calendario />Fecha: {fechaCorta(p.fecha_orden)}</span>}
        <strong>Cliente: {p.nombre_cliente}</strong>
        {abierta
          ? <span className="resumen"><Badge tono="info">{p.unidades} un. en total</Badge><span className="ver-detalle">Ocultar detalle</span></span>
          : <span className="resumen"><span className="ver-detalle">Toque para ver el detalle</span><Icono n="der" /></span>}
      </button>
      <EtiquetaBodega p={p} />
      {abierta && (
        <div className="tarjeta-cuerpo">
          <span className="etiqueta">Cambiar estado</span>
          <div className="estados" role="group" aria-label="Cambiar estado">
            {FLUJO.map((e) => <button type="button" key={e} className={`pastilla ${p.estado_orden === e ? 'activa' : ''}`} aria-pressed={p.estado_orden === e} disabled={ocupado} onClick={() => p.estado_orden !== e && estado(e)}>{ESTADOS[e][0]}</button>)}
          </div>
          <Alerta>{error}</Alerta>
          <span className="etiqueta">Detalle de productos a recolectar ({p.unidades} unidades)</span>
          <p className="tenue">Marque al recolectar</p>
          {!det && !error && <p className="tenue">Cargando…</p>}
          {items.map((i) => (
            <div className="item-recolectar" key={i.sku}>
              <label className="casilla"><input type="checkbox" checked={!!marcados[i.sku]} onChange={(e) => setMarcados({ ...marcados, [i.sku]: e.target.checked })} /><span className="chip-sku">SKU: {i.sku}</span></label>
              <strong>{i.nombre}</strong>
              <span className="detalle-item">Ubicación: {(i.ubicacion_bodega ?? 'sin ubicación').replace(' - ', ' · ')}  |  Cantidad: {i.cantidad} un.</span>
              <Comentario idOrden={p.id_orden} sku={i.sku} />
            </div>
          ))}
          {p.estado_orden === 'PENDIENTE_PREPARACION' && items.length > 0 && (
            <Boton variante="primario bloque" disabled={!completo || ocupado} onClick={() => estado('ARMADO').then((ok) => ok && aviso('Recolección completada: pedido armado.'))}>Completar recolección de {p.nombre_cliente}</Boton>
          )}
        </div>
      )}
    </article>
  );
}

// Escritorio: fila que se despliega con el checklist, el cambio de estado y la etiqueta.
function FilaEsc({ p, abierta, onAbrir, onCambio }) {
  const { det, marcados, setMarcados, error, ocupado, estado } = usePedido(p, abierta, onCambio);
  const [nuevo, setNuevo] = useState(p.estado_orden);
  useEffect(() => setNuevo(p.estado_orden), [p.estado_orden]);
  const items = det?.items ?? [];
  const hechos = items.filter((i) => marcados[i.sku]).length;
  return (
    <article className={`pe-fila ${abierta ? 'abierta' : ''}`}>
      <button type="button" className="pe-cab" aria-expanded={abierta} onClick={onAbrir}>
        <span className="chip-sku">#{p.codigo_externo}</span>
        <strong>Cliente: {p.nombre_cliente}</strong>
        <EstadoBadge e={p.estado_orden} />
        <Icono n={abierta ? 'abajo' : 'der'} />
      </button>
      {abierta && (
        <div className="pe-cuerpo">
          <div className="pe-sub"><span className="etiqueta">Productos del pedido ({items.length || p.unidades})</span>{items.length > 0 && <span>{hechos} de {items.length} recolectados</span>}</div>
          {!det && !error && <p className="tenue">Cargando…</p>}
          {items.map((i) => (
            <div className="pe-item" key={i.sku}>
              <label className="casilla"><input type="checkbox" aria-label={`Recolectado: ${i.sku}`} checked={!!marcados[i.sku]} onChange={(e) => setMarcados({ ...marcados, [i.sku]: e.target.checked })} /><span className="chip-sku">{i.sku}</span></label>
              <span className="pe-nombre">{i.nombre}<small>{(i.ubicacion_bodega ?? 'sin ubicación').replace(' - ', ' · ')}</small></span>
              <Comentario idOrden={p.id_orden} sku={i.sku} />
              <b className="dato">× {i.cantidad}</b>
            </div>
          ))}
          <Alerta>{error}</Alerta>
          <div className="pe-pie">
            <label htmlFor={`est-${p.id_orden}`}>Estado</label>
            <select id={`est-${p.id_orden}`} className="entrada" value={nuevo} onChange={(e) => setNuevo(e.target.value)}>
              {FLUJO.map((e) => <option key={e} value={e}>{ESTADOS[e][0]}</option>)}
            </select>
            <Boton variante="primario" disabled={ocupado || nuevo === p.estado_orden} onClick={() => estado(nuevo)}>Guardar estado</Boton>
            <EtiquetaBodega p={p} esc />
          </div>
        </div>
      )}
    </article>
  );
}

const POR_PREPARAR = ['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO'];
const CONTADORES = [['pendiente_preparacion', 'Sin recolectar', 'aviso'], ['armado', 'Armado', 'info'], ['etiquetado', 'Etiquetado', 'info'], ['en_camion_esperando_chofer', 'En camión', 'ok']];
const REFRESCO_MS = 60_000;
const hora = (d) => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });

function EnCamion({ p }) {
  const asignado = p.chofer_asignado && p.estado_entrega !== 'RECHAZADO'; // un chofer de un intento rechazado ya no cuenta
  return (
    <article className="tarjeta-pedido">
      <div className="fila-sb"><span className="chip-sku">#{p.codigo_externo}</span><Badge tono={asignado ? 'ok' : undefined}>{asignado ? 'Chofer asignado' : 'Sin chofer'}</Badge></div>
      <strong>Cliente: {p.nombre_cliente}</strong>
      {(p.direccion_despacho ?? p.comuna) && <span className="dato-fecha"><Icono n="pin" />{p.direccion_despacho ?? p.comuna}</span>}
      <span className="chofer-fila"><Icono n="persona" />Chofer: {asignado ? 'asignado' : 'sin asignar aún'}</span>
    </article>
  );
}

export default function BodegaPedidos() {
  const [filas, setFilas] = useState(null);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [cuando, setCuando] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [abierta, setAbierta] = useState(null);
  // La API pagina (100 por defecto, 500 como tope, los más antiguos primero); esta vista pide el tope. Los contadores salen de /pedidos/resumen, que cuenta todo.
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [l, r] = await Promise.all([api('/pedidos?limite=500'), api('/pedidos/resumen')]);
      setFilas(l.data); setRes(r.data); setCuando(new Date()); setError('');
    } catch (e) { setError(mensajeError(e)); setFilas((f) => f ?? []); } finally { setCargando(false); }
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar]);

  const esc = useEscritorio();
  const [todas, setTodas] = useState(false);
  const porPreparar = (filas ?? []).filter((p) => POR_PREPARAR.includes(p.estado_orden));
  const enCamion = (filas ?? []).filter((p) => p.estado_orden === 'EN_CAMION');
  const abrir = (id) => setAbierta(abierta === id ? null : id);
  if (esc) {
    const visibles = todas ? porPreparar : porPreparar.slice(0, 4);
    return (
      <div className="pe-esc pedidos-bodega">
        <header className="bd-cab">
          <div><h1>Pedidos pendientes</h1><span className="tenue">{cuando ? `Actualizado hoy a las ${hora(cuando)}` : 'Cargando…'}</span></div>
          <Boton icono="refrescar" onClick={cargar} disabled={cargando}>Actualizar</Boton>
        </header>
        <Alerta>{error}</Alerta>
        {res && <div className="contadores">{CONTADORES.map(([k, rotulo, tono]) => <div className="contador" key={k}><span className="rotulo"><span className={`punto ${tono}`} />{rotulo}</span><b>{res[k]}</b></div>)}</div>}
        {filas && !error && !porPreparar.length && !enCamion.length && <p className="vacio">No hay pedidos pendientes.</p>}
        <div className="pe-cols">
          <section>
            <div className="fila-sb"><h2>Por preparar</h2><Badge tono="ink">{porPreparar.length} {porPreparar.length === 1 ? 'pedido' : 'pedidos'}</Badge></div>
            {visibles.map((p) => <FilaEsc key={p.id_orden} p={p} abierta={abierta === p.id_orden} onAbrir={() => abrir(p.id_orden)} onCambio={cargar} />)}
            {!todas && porPreparar.length > visibles.length && <button type="button" className="bi-ver" onClick={() => setTodas(true)}>Ver los {porPreparar.length - visibles.length} restantes</button>}
          </section>
          <section>
            <div className="fila-sb"><h2>En camión, esperando chofer</h2><Badge tono="ink">{enCamion.length}</Badge></div>
            {enCamion.map((p) => <EnCamion key={p.id_orden} p={p} />)}
          </section>
        </div>
      </div>
    );
  }
  return (
    <div className="movil-pagina pedidos-bodega">
      <div className="cab-pagina"><h1>Pedidos pendientes</h1></div>
      <div className="fila-sb actualizar-fila">
        <span className="tenue">{cuando ? `Actualizado hoy a las ${hora(cuando)}` : 'Cargando…'}</span>
        <Boton icono="refrescar" onClick={cargar} disabled={cargando}>Actualizar</Boton>
      </div>
      <Alerta>{error}</Alerta>
      {res && (
        <div className="contadores">
          {CONTADORES.map(([k, rotulo, tono]) => <div className="contador" key={k}><span className={`punto ${tono}`} />{rotulo}<b>{res[k]}</b></div>)}
        </div>
      )}
      {filas && !error && !porPreparar.length && !enCamion.length && <p className="vacio">No hay pedidos pendientes.</p>}
      {porPreparar.length > 0 && (
        <section>
          <div className="fila-sb"><h2>Por preparar</h2><Badge tono="ink">{porPreparar.length} {porPreparar.length === 1 ? 'pedido' : 'pedidos'}</Badge></div>
          {porPreparar.map((p) => <Tarjeta key={p.id_orden} p={p} abierta={abierta === p.id_orden} onAbrir={() => abrir(p.id_orden)} onCambio={cargar} />)}
        </section>
      )}
      {enCamion.length > 0 && (
        <section>
          <div className="fila-sb"><h2>En camión, esperando chofer</h2><Badge tono="ink">{enCamion.length}</Badge></div>
          {enCamion.map((p) => <EnCamion key={p.id_orden} p={p} />)}
        </section>
      )}
    </div>
  );
}
