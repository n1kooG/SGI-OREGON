import { useCallback, useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Icono, Modal, useAviso } from '../componentes/ui.jsx';
import { fechaCorta } from './Pedidos.jsx';

const unidades = (n) => `${n} ${n === 1 ? 'unidad' : 'unidades'} a reingresar`;

export default function BodegaRechazados() {
  const aviso = useAviso();
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [elegido, setElegido] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [errorModal, setErrorModal] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try { setFilas((await api('/pedidos?por_reingresar=1')).data); } catch (e) { setError(mensajeError(e)); setFilas((f) => f ?? []); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function reingresar() {
    setOcupado(true); setErrorModal('');
    try {
      // El listado no trae el despacho: se toma del detalle del pedido.
      const { id_despacho } = (await api(`/pedidos/${elegido.id_orden}`)).data;
      const { data } = await api(`/despachos/${id_despacho}/reingresar`, { metodo: 'POST' });
      setFilas((f) => f.filter((p) => p.id_orden !== elegido.id_orden));
      aviso(`Pedido #${elegido.codigo_externo} reingresado: ${data.unidades} un. vuelven al stock.`);
      setElegido(null);
    } catch (e) {
      setErrorModal(mensajeError(e));
      if (e.codigo === 'YA_REINGRESADO' || e.codigo === 'NO_RECHAZADO') cargar(); // otro operario ya lo resolvió
    } finally { setOcupado(false); }
  }

  return (
    <div className="movil-pagina rechazados">
      <div className="cab-pagina">
        <div className="fila-sb"><h1>Rechazados por reingresar</h1>{filas && <Badge tono="mal">{filas.length} {filas.length === 1 ? 'orden' : 'órdenes'}</Badge>}</div>
        <p className="tenue">Mercadería que volvió en camión tras un despacho fallido.</p>
      </div>
      <div className="nota-info"><Icono n="info" /><span>Al reingresar, las unidades vuelven al stock. Luego la jefatura puede reprogramar el despacho.</span></div>
      <Alerta>{error}</Alerta>
      {error && <Boton onClick={cargar}>Reintentar</Boton>}
      {filas?.length === 0 && !error && <p className="vacio">No hay pedidos rechazados por reingresar.</p>}
      {filas?.map((p) => (
        <article className="tarjeta-pedido" key={p.id_orden}>
          <div className="fila-sb"><span className="chip-sku">#{p.codigo_externo}</span><Badge tono="mal">Rechazado</Badge></div>
          <strong>Cliente: {p.nombre_cliente}</strong>
          {p.comuna && <span className="dato-fecha"><Icono n="pin" />{p.comuna}</span>}
          <span className="dato-fecha"><Icono n="cal" />Pedido del {fechaCorta(p.fecha_orden)}</span>
          <div className="causal"><small>Causal anotada por el chofer</small><span>{p.motivo_rechazo}</span></div>
          <div className="unidades-cuadro"><b>{p.unidades}</b>{p.unidades === 1 ? 'unidad' : 'unidades'} a reingresar</div>
          <Boton variante="primario bloque" onClick={() => { setErrorModal(''); setElegido(p); }}>Reingresar a bodega</Boton>
        </article>
      ))}
      {elegido && (
        <Modal chico titulo="Reingresar a bodega" subtitulo={`#${elegido.codigo_externo} · ${elegido.nombre_cliente}`} onClose={() => !ocupado && setElegido(null)}
          pie={<><Boton onClick={() => setElegido(null)} disabled={ocupado}>Cancelar</Boton><Boton variante="primario" onClick={reingresar} disabled={ocupado}>{ocupado ? 'Reingresando…' : 'Confirmar'}</Boton></>}>
          <p>Se devolverán {elegido.unidades} {elegido.unidades === 1 ? 'unidad' : 'unidades'} al stock. Esta acción queda registrada.</p>
          <Alerta>{errorModal}</Alerta>
        </Modal>
      )}
    </div>
  );
}
