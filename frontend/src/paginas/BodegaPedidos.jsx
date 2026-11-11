import { useCallback, useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, useAviso } from '../componentes/ui.jsx';
import { ESTADOS, EstadoBadge, fechaCorta } from './Pedidos.jsx';

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

function Tarjeta({ p, abierta, onAbrir, onCambio }) {
  const aviso = useAviso();
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

  async function etiqueta() {
    setError('');
    try {
      const { data } = await api(`/pedidos/${p.id_orden}/etiqueta`, { blob: true });
      const url = URL.createObjectURL(data);
      const a = Object.assign(document.createElement('a'), { href: url, download: `etiqueta_${p.codigo_externo}.pdf` });
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(mensajeError(e)); }
  }

  const items = det?.items ?? [];
  const completo = items.length > 0 && items.every((i) => marcados[i.sku]);
  return (
    <article className={`tarjeta-pedido ${abierta ? 'abierta' : ''}`}>
      <button type="button" className="tarjeta-cab" aria-expanded={abierta} onClick={onAbrir}>
        <div className="fila-sb"><span className="chip-sku">#{p.codigo_externo}</span><EstadoBadge e={p.estado_orden} /></div>
        <span className="dato-fecha"><Calendario />Fecha: {fechaCorta(p.fecha_orden)}</span>
        <strong>Cliente: {p.nombre_cliente}</strong>
        <span className="resumen"><Badge tono="info">{p.unidades} un. en total</Badge><span className="ver-detalle">{abierta ? 'Ocultar detalle' : 'Ver detalle'}</span></span>
      </button>
      {abierta && (
        <div className="tarjeta-cuerpo">
          <span className="etiqueta">Cambiar estado</span>
          <div className="estados" role="group" aria-label="Cambiar estado">
            {FLUJO.map((e) => <button type="button" key={e} className={`pastilla ${p.estado_orden === e ? 'activa' : ''}`} aria-pressed={p.estado_orden === e} disabled={ocupado} onClick={() => p.estado_orden !== e && estado(e)}>{ESTADOS[e][0]}</button>)}
          </div>
          <Boton className="bloque-sm" onClick={etiqueta}>Descargar etiquetas de este pedido</Boton>
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

export default function BodegaPedidos() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [abierta, setAbierta] = useState(null);
  const cargar = useCallback(async () => {
    try { setFilas((await api('/pedidos')).data); setError(''); } catch (e) { setError(mensajeError(e)); setFilas((f) => f ?? []); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porCanal = Map.groupBy(filas ?? [], (p) => p.canal_origen);
  const pendientes = (filas ?? []).filter((p) => p.estado_orden === 'PENDIENTE_PREPARACION').length;
  return (
    <div className="movil-pagina pedidos-bodega">
      <div className="cab-pagina"><div className="fila-sb"><h1>Pedidos pendientes</h1><Badge tono="ink">{pendientes} sin recolectar</Badge></div>
      <p className="tenue">Toque una orden para desplegar los productos a recolectar</p></div>
      <Alerta>{error}</Alerta>
      {filas && !filas.length && !error && <p className="vacio">No hay pedidos pendientes.</p>}
      {[...porCanal].map(([canal, ps]) => (
        <section key={canal}>
          <div className="seccion etiqueta">{canal}</div>
          {ps.map((p) => <Tarjeta key={p.id_orden} p={p} abierta={abierta === p.id_orden} onAbrir={() => setAbierta(abierta === p.id_orden ? null : p.id_orden)} onCambio={cargar} />)}
        </section>
      ))}
    </div>
  );
}
