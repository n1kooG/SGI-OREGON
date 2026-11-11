import { useCallback, useEffect, useRef, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Modal, Tabla, useAviso } from '../componentes/ui.jsx';

export const ESTADOS = {
  PENDIENTE_PREPARACION: ['Sin recolectar', 'aviso'], ARMADO: ['Armado', 'info'], ETIQUETADO: ['Etiquetado', 'info'], EN_CAMION: ['En camión', 'info'],
  EN_RUTA: ['En ruta (chofer)', 'aviso'], ENTREGADO: ['Entregado', 'ok'], RECHAZADO: ['Rechazado', 'mal'],
};
export const EstadoBadge = ({ e }) => <Badge tono={ESTADOS[e]?.[1]}>{ESTADOS[e]?.[0] ?? e}</Badge>;
export const fechaCorta = (f) => new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).replaceAll('-', '/');

function AsignarChofer({ pedido, onClose, onHecho }) {
  const aviso = useAviso();
  const [choferes, setChoferes] = useState(null);
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api('/usuarios').then(({ data }) => setChoferes(data.filter((u) => u.rol === 'CHOFER' && u.activo)))
      .catch((e) => { setChoferes([]); setError(mensajeError(e)); });
  }, []);

  async function asignar() {
    setError(''); setOcupado(true);
    try {
      await api(`/pedidos/${pedido.id_orden}/asignar-chofer`, { metodo: 'POST', cuerpo: { id_chofer: Number(id) } });
      aviso(`Pedido ${pedido.codigo_externo} asignado: pasó a «En ruta».`);
      onHecho();
    } catch (e) {
      setError(e.status === 409 ? `${e.message}. Actualiza la lista e inténtalo de nuevo.` : mensajeError(e));
      setOcupado(false);
    }
  }

  return (
    <Modal chico titulo="Asignar chofer" subtitulo={`Orden #${pedido.codigo_externo} · ${pedido.nombre_cliente}`} onClose={onClose}
      pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante="primario" disabled={!id || ocupado} onClick={asignar}>{ocupado ? 'Asignando…' : 'Asignar chofer'}</Boton></>}>
      <div className="asignar-chofer" />
      <Campo como="select" etiqueta="Chofer" value={id} onChange={(e) => setId(e.target.value)} disabled={!choferes} data-inicial>
        <option value="">{choferes ? (choferes.length ? 'Selecciona un chofer' : 'No hay choferes activos') : 'Cargando…'}</option>
        {choferes?.map((c) => <option key={c.id_usuario} value={c.id_usuario}>{c.nombre_completo}</option>)}
      </Campo>
      <p className="tenue">La orden pasará a «En ruta» y quedará en la hoja de ruta del chofer. La asignación se registra en la bitácora.</p>
      <Alerta>{error}</Alerta>
    </Modal>
  );
}

export default function Pedidos() {
  const [canal, setCanal] = useState('');
  const [estado, setEstado] = useState('');
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [asignando, setAsignando] = useState(null);
  const canales = useRef(new Set()); // el canal es texto libre: se arma la lista con los vistos

  const cargar = useCallback(async () => {
    setError('');
    try {
      const q = new URLSearchParams({ ...(canal && { canal }), ...(estado && { estado }) });
      const { data } = await api(`/pedidos?${q}`);
      data.forEach((p) => canales.current.add(p.canal_origen));
      setFilas(data);
    } catch (e) { setError(mensajeError(e)); } finally { setCargando(false); }
  }, [canal, estado]);
  useEffect(() => { cargar(); }, [cargar]);
  const cerrar = useCallback(() => setAsignando(null), []);

  return (
    <>
      <div className="cabecera pedidos-cab">
        <div>
          <h1>Gestión de Pedidos y Despachos</h1>
          <p>Control del flujo: preparación en bodega y asignación a hoja de ruta para reparto.</p>
        </div>
      </div>
      <div className="barra-herr">
        <Campo como="select" etiqueta="Canal" className="filtro" value={canal} onChange={(e) => setCanal(e.target.value)}>
          <option value="">Todos los canales</option>
          {[...new Set([...canales.current, canal].filter(Boolean))].sort().map((c) => <option key={c}>{c}</option>)}
        </Campo>
        <Campo como="select" etiqueta="Estado" className="filtro" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
        </Campo>
      </div>
      <Alerta>{error}</Alerta>
      <div className="tabla-pedidos"><Tabla
        columnas={['N° orden', 'Cliente / destino', 'Canal', 'Ítems', 'Estado operativo', { t: 'Acción', d: 1 }]}
        vacio={cargando ? 'Cargando…' : !filas.length && !error ? 'No hay pedidos con esos filtros.' : null}
      >
        {filas.map((p) => (
          <tr key={p.id_orden}>
            <td className="dato">#{p.codigo_externo}</td>
            <td>{p.nombre_cliente}<div className="celda-sec">{p.comuna ?? 'Sin comuna'}</div></td>
            <td style={{ whiteSpace: 'nowrap' }}>{p.canal_origen}</td>
            <td>{p.unidades} un.</td>
            <td><EstadoBadge e={p.estado_orden} />{p.nombre_chofer && <div className="celda-sec">{p.nombre_chofer}</div>}</td>
            <td className="derecha">{p.estado_orden === 'EN_CAMION' ? <Boton onClick={() => setAsignando(p)}>Asignar chofer</Boton> : <span className="celda-sec">—</span>}</td>
          </tr>
        ))}
      </Tabla></div>
      {asignando && <AsignarChofer pedido={asignando} onClose={cerrar} onHecho={() => { cerrar(); cargar(); }} />}
    </>
  );
}
