import { useId, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Alerta, useAviso } from '../../componentes/ui.jsx';
import Firma from './Firma.jsx';
import { Ico } from './iconos.jsx';
import { direccion, useCierre, useParada, useUbicacion, validarFoto } from './datos.js';
import { Aviso, BarraAcciones, Dialogo, Titulo, Volver } from './comunes.jsx';

const UBICACION = {
  buscando: 'Obteniendo la ubicación del lugar de entrega…',
  lista: 'Se guardará la ubicación del lugar de entrega',
  sin: 'Sin ubicación: la entrega se registrará sin ella',
};

// En pantallas anchas se abre como diálogo sobre la ruta (recibe `ruta` y `alTerminar`); en móvil ocupa toda la pantalla.
export default function Entrega({ ruta, alTerminar }) {
  const { id } = useParams();
  const irA = useNavigate();
  const aviso = useAviso();
  const enDialogo = !!ruta;
  const { parada: d, error: errCarga, n } = useParada(id, ruta);
  const ubicacion = useUbicacion();
  const firma = useRef(null);
  const campoFoto = useId();
  const [receptor, setReceptor] = useState('');
  const [foto, setFoto] = useState(null);
  const [errFoto, setErrFoto] = useState('');
  const [intento, setIntento] = useState(false); // la validación se muestra al pulsar «Confirmar»
  const [sinFirma, setSinFirma] = useState(true);
  const terminar = alTerminar ?? ((msg) => { if (msg) aviso(msg); irA('/chofer/ruta', { replace: true }); });
  const cierre = useCierre({ parada: d, ubicacion, alTerminar: terminar });
  const volver = `/chofer/ruta/${id}`;

  if (errCarga) return <div className="ch-cont"><Alerta>{errCarga}</Alerta><Link className="ch-btn" to="/chofer/ruta">Volver a la ruta</Link></div>;
  if (!d) return enDialogo ? null : <div className="ch-cont"><p className="ch-vacio-txt">Cargando…</p></div>;
  if (d.estado_entrega !== 'PENDIENTE') return <Navigate to="/chofer/ruta" replace />;

  const falta = intento && (sinFirma || !receptor.trim());
  const elegirFoto = (e) => {
    const f = e.target.files[0];
    const msg = validarFoto(f);
    setErrFoto(msg); setFoto(msg ? null : f ?? null);
    if (msg) e.target.value = '';
  };

  async function confirmar(e) {
    e.preventDefault();
    setIntento(true);
    if (firma.current.vacia() || !receptor.trim()) return;
    cierre.enviar('ENTREGADO', { receptor: receptor.trim(), firma: await firma.current.exportar(), foto });
  }

  const cuerpo = (
    <>
      {falta && !enDialogo && <Aviso>Falta la firma o el nombre de quien recibe</Aviso>}
      <Aviso>{cierre.error}</Aviso>
      <div className="ch-campo">
        <div className="ch-fila"><span className="ch-etiqueta">Firma de quien recibe *</span>
          <button type="button" className="ch-btn xs ch-limpiar" onClick={() => { firma.current.limpiar(); setSinFirma(true); }}><Ico n="actualizar" />Limpiar</button></div>
        <Firma ref={firma} error={intento && sinFirma} alCambiar={() => setSinFirma(false)} />
        {enDialogo && intento && sinFirma && <span className="ch-msg-error"><Ico n="aviso" t={16} />Falta la firma de quien recibe</span>}
      </div>
      <div className={`ch-campo ${intento && !receptor.trim() ? 'error' : ''}`}>
        <label className="ch-etiqueta" htmlFor="ch-receptor">Nombre de quien recibe *</label>
        <input id="ch-receptor" className="ch-entrada" placeholder="Ej.: María Soto" maxLength={120} autoComplete="off" value={receptor} onChange={(e) => setReceptor(e.target.value)} aria-invalid={intento && !receptor.trim()} />
        {intento && !receptor.trim() && <span className="ch-msg-error"><Ico n="aviso" t={16} />Ingresa el nombre de quien recibe</span>}
      </div>
      <div className="ch-campo">
        <span className="ch-etiqueta">Foto de evidencia · opcional</span>
        <label className="ch-btn" htmlFor={campoFoto}><Ico n="camara" />{foto ? foto.name : 'Agregar foto de evidencia'}</label>
        <input id={campoFoto} type="file" accept="image/jpeg,image/png" capture="environment" className="solo-lectores" onChange={elegirFoto} />
        {errFoto && <span className="ch-msg-error"><Ico n="aviso" t={16} />{errFoto}</span>}
      </div>
      <p className="ch-ubicacion"><Ico n="pin" t={16} />{UBICACION[ubicacion.estado]}</p>
    </>
  );
  const confirmarBtn = <button type="submit" className="ch-btn pri grande" disabled={cierre.ocupado}><Ico n="ok" />{cierre.ocupado ? 'Registrando…' : 'Confirmar entrega'}</button>;

  if (enDialogo) {
    return (
      <Dialogo titulo="Confirmar entrega" subtitulo={`${n ? `Parada ${n} · ` : ''}Orden #${d.codigo_externo} · ${d.nombre_cliente}`} ancho={640} onClose={() => irA(volver)} onSubmit={confirmar}
        pie={<><Link className="ch-btn" to={volver} aria-disabled={cierre.ocupado}>Cancelar</Link>{confirmarBtn}</>}>
        {cuerpo}
      </Dialogo>
    );
  }
  return (
    <form onSubmit={confirmar} noValidate className="ch-form">
      <Volver a={volver}>{n ? `Parada ${n} · ` : ''}Orden #{d.codigo_externo}</Volver>
      <div className="ch-cont">
        <Titulo h="Confirmar entrega" sub={`${d.nombre_cliente} · ${direccion(d)}`} />
        {cuerpo}
      </div>
      <BarraAcciones>{confirmarBtn}</BarraAcciones>
    </form>
  );
}
