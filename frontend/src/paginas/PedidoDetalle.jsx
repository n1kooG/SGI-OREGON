import { useEffect, useRef, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Icono, Modal, useAviso } from '../componentes/ui.jsx';
import { EstadoBadge, fechaCorta } from './Pedidos.jsx';
import './admin.css';

const PASOS = [['PENDIENTE_PREPARACION', 'Sin recolectar'], ['ARMADO', 'Armado'], ['ETIQUETADO', 'Etiquetado'], ['EN_CAMION', 'En camión'], ['EN_RUTA', 'En ruta']];

function LineaTiempo({ estado, rechazado }) {
  const actual = PASOS.findIndex(([k]) => k === estado);
  const pasos = [...PASOS, [rechazado ? 'RECHAZADO' : 'ENTREGADO', rechazado ? 'Rechazado' : 'Entregado']];
  const fin = rechazado || estado === 'ENTREGADO';
  return (
    <ol className="linea-tiempo" aria-label="Línea de tiempo de estados">
      {pasos.map(([k, t], i) => {
        const hecho = fin || i < actual;
        const vigente = fin ? i === pasos.length - 1 : i === actual;
        return (
          <li key={k} className={`${hecho || vigente ? 'hecho' : ''} ${vigente ? 'vigente' : ''} ${k === 'RECHAZADO' ? 'mal' : ''}`} aria-current={vigente ? 'step' : undefined}>
            <span className="nodo"><Icono n={k === 'RECHAZADO' ? 'x' : 'check'} /></span><span className="paso">{t}</span>
          </li>
        );
      })}
    </ol>
  );
}

const Dato = ({ t, children, ancho }) => <div className={ancho ? 'dato-ancho' : ''}><dt>{t}</dt><dd>{children || '—'}</dd></div>;

export default function PedidoDetalle({ id, enfocarDespacho, onClose, onCambio }) {
  const aviso = useAviso();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [doc, setDoc] = useState('');
  const [errDoc, setErrDoc] = useState('');
  const [guardando, setGuardando] = useState(false);
  const bloqueDespacho = useRef(null);

  useEffect(() => {
    api(`/pedidos/${id}`).then(({ data }) => { setP(data); setDoc(data.numero_documento_sii ?? ''); }).catch((e) => setError(mensajeError(e)));
  }, [id]);
  useEffect(() => { if (p && enfocarDespacho) bloqueDespacho.current?.scrollIntoView({ block: 'start' }); }, [p, enfocarDespacho]);

  const valido = /^[0-9-]{0,20}$/.test(doc.trim());
  const sinCambio = doc.trim() === (p?.numero_documento_sii ?? '');
  async function guardar(e) {
    e.preventDefault();
    if (!valido) return setErrDoc('Solo dígitos y guion, máximo 20 caracteres');
    setErrDoc(''); setGuardando(true);
    try {
      const { data } = await api(`/pedidos/${id}/documento`, { metodo: 'PATCH', cuerpo: { numero_documento: doc.trim() } });
      setP({ ...p, numero_documento_sii: data.numero_documento_sii });
      setDoc(data.numero_documento_sii ?? '');
      aviso(data.numero_documento_sii ? 'Documento tributario guardado' : 'Documento tributario quitado');
      onCambio?.();
    } catch (err) { setErrDoc(mensajeError(err)); } finally { setGuardando(false); }
  }

  const rechazado = p?.estado_entrega === 'RECHAZADO'; // tras el reingreso el pedido vuelve a EN_CAMION pero el último despacho sigue rechazado
  const hayDespacho = p?.id_despacho != null;
  return (
    <Modal lado className="panel-pedido" titulo={p ? `Orden #${p.codigo_externo}` : 'Detalle de pedido'} onClose={onClose}>
      <Alerta>{error}</Alerta>
      {!p && !error && <p className="vacio">Cargando…</p>}
      {p && (
        <div className="detalle-pedido">
          <div className="detalle-estado">
            {rechazado ? <Badge tono="mal">Rechazado</Badge> : <EstadoBadge e={p.estado_orden} />}
            <span className="tenue">{p.canal_origen} · Pedido del {fechaCorta(p.fecha_orden)}</span>
          </div>
          <LineaTiempo estado={p.estado_orden} rechazado={rechazado} />

          {rechazado && (
            <section className="caja-rechazo" aria-label="Causal de rechazo">
              <span className="etiqueta">Causal de rechazo</span>
              <p>{p.motivo_rechazo}</p>
              <div className="reingreso">
                <span className={`badge ${p.reingresado ? 'ok' : 'aviso'}`}>{p.reingresado ? 'Reingresado' : 'Reingreso pendiente'}</span>
                <span className="tenue">{p.reingresado ? 'Bodega ya recibió el pedido. «Reprogramar» está habilitado.' : 'Bodega aún no recibe el pedido. «Reprogramar» se habilita al reingresar.'}</span>
              </div>
            </section>
          )}

          <h3 className="etiqueta">Cliente</h3>
          <dl className="datos">
            <Dato t="Nombre">{p.nombre_cliente}</Dato>
            <Dato t="RUT"><span className="dato">{p.rut_cliente}</span></Dato>
            <Dato t="Dirección" ancho>{p.direccion_despacho}</Dato>
            <Dato t="Comuna">{p.comuna}</Dato>
            <Dato t="Teléfono"><span className="dato">{p.telefono_contacto}</span></Dato>
          </dl>

          <h3 className="etiqueta">Productos</h3>
          <div className="tabla-mini">
            <table>
              <thead><tr><th>SKU</th><th>Descripción</th><th className="derecha">Cant.</th></tr></thead>
              <tbody>{p.items.map((i) => <tr key={i.sku}><td className="dato">{i.sku}</td><td>{i.nombre}</td><td className="dato derecha">{i.cantidad}</td></tr>)}</tbody>
            </table>
          </div>

          {hayDespacho && (
            <>
              <h3 className="etiqueta" ref={bloqueDespacho}>Despacho</h3>
              <dl className="datos">
                <Dato t="Chofer">{p.nombre_chofer}</Dato>
                <Dato t="Asignado">{fechaCorta(p.fecha_asignacion)}</Dato>
                {p.fecha_cierre && <Dato t="Cierre">{`${fechaCorta(p.fecha_cierre)} · ${new Date(p.fecha_cierre).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })}`}</Dato>}
                {p.geolocalizacion && <Dato t="Geolocalización"><a className="ver-mapa" href={`https://www.openstreetmap.org/?mlat=${p.geolocalizacion.split(',')[0]}&mlon=${p.geolocalizacion.split(',')[1]}&zoom=17`} target="_blank" rel="noopener noreferrer"><Icono n="pin" />Ver en mapa</a></Dato>}
                {p.nombre_receptor && <Dato t="Recibió" ancho>{p.nombre_receptor}</Dato>}
              </dl>
              {(p.tiene_evidencia || p.tiene_firma) && (
                <div className="evidencias">
                  {p.tiene_evidencia && <div><div className="tile"><Icono n="imagen" /></div><span className="tenue">Foto de evidencia adjunta</span></div>}
                  {p.tiene_firma && <div><div className="tile"><Icono n="pencil" />Con firma</div><span className="tenue">Firma del receptor</span></div>}
                </div>
              )}
            </>
          )}

          <h3 className="etiqueta">Documento tributario</h3>
          <form className="doc-sii" onSubmit={guardar}>
            <div className={`campo ${errDoc ? 'error' : ''}`}>
              <label htmlFor="doc-sii">N° de boleta o factura SII</label>
              <div className="fila-doc">
                <input id="doc-sii" className="entrada" placeholder="Ej. 1048832" maxLength={20} value={doc} onChange={(e) => setDoc(e.target.value)} aria-invalid={!!errDoc} />
                <Boton type="submit" variante="primario" disabled={guardando || sinCambio}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
              </div>
              {errDoc && <span className="msg-error" role="alert">{errDoc}</span>}
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
