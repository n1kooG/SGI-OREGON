import { useId, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Alerta, useAviso } from '../../componentes/ui.jsx';
import { Ico } from './iconos.jsx';
import { useCierre, useParada, useUbicacion, validarFoto } from './datos.js';
import { Aviso, BarraAcciones, Dialogo, Titulo, Volver } from './comunes.jsx';

const CAUSALES = ['Cliente ausente', 'Dirección incorrecta', 'Rechaza el producto', 'Producto dañado', 'Otro'];
const MAX_MOTIVO = 300; // el backend guarda «Causal — detalle» en un solo campo de texto

// En pantallas anchas se abre como diálogo sobre la ruta (recibe `ruta` y `alTerminar`); en móvil ocupa toda la pantalla.
export default function Rechazo({ ruta, alTerminar }) {
  const { id } = useParams();
  const irA = useNavigate();
  const aviso = useAviso();
  const enDialogo = !!ruta;
  const { parada: d, error: errCarga, n } = useParada(id, ruta);
  const ubicacion = useUbicacion();
  const campoFoto = useId();
  const [causal, setCausal] = useState(CAUSALES[0]);
  const [detalle, setDetalle] = useState('');
  const [foto, setFoto] = useState(null);
  const [errFoto, setErrFoto] = useState('');
  const [intento, setIntento] = useState(false);
  const terminar = alTerminar ?? ((msg) => { if (msg) aviso(msg); irA('/chofer/ruta', { replace: true }); });
  const cierre = useCierre({ parada: d, ubicacion, alTerminar: terminar });
  const volver = `/chofer/ruta/${id}`;

  if (errCarga) return <div className="ch-cont"><Alerta>{errCarga}</Alerta><Link className="ch-btn" to="/chofer/ruta">Volver a la ruta</Link></div>;
  if (!d) return enDialogo ? null : <div className="ch-cont"><p className="ch-vacio-txt">Cargando…</p></div>;
  if (d.estado_entrega !== 'PENDIENTE') return <Navigate to="/chofer/ruta" replace />;

  const falta = causal === 'Otro' && !detalle.trim();
  const elegirFoto = (e) => {
    const f = e.target.files[0];
    const msg = validarFoto(f);
    setErrFoto(msg); setFoto(msg ? null : f ?? null);
    if (msg) e.target.value = '';
  };

  function confirmar(e) {
    e.preventDefault();
    setIntento(true);
    if (falta) return;
    cierre.enviar('RECHAZADO', { motivo: detalle.trim() ? `${causal} — ${detalle.trim()}` : causal, foto });
  }

  const subtitulo = `${n ? `Parada ${n} · ` : ''}Orden #${d.codigo_externo} · ${d.nombre_cliente}`;
  const cuerpo = (
    <>
      <Aviso>{cierre.error}</Aviso>
      <fieldset className="ch-campo ch-causales">
        <legend className="ch-etiqueta">Causal del rechazo *</legend>
        {CAUSALES.map((c) => (
          <label key={c} className={causal === c ? 'sel' : ''}>
            <input type="radio" name="causal" className="solo-lectores" checked={causal === c} onChange={() => setCausal(c)} />
            <i aria-hidden="true" />{c}
          </label>
        ))}
      </fieldset>
      <div className={`ch-campo ${intento && falta ? 'error' : ''}`}>
        <label className="ch-etiqueta" htmlFor="ch-detalle">Detalle (obligatorio si eliges «Otro»)</label>
        <textarea id="ch-detalle" className="ch-entrada" rows={3} maxLength={MAX_MOTIVO - causal.length - 3} placeholder="Cuenta qué pasó, por ejemplo: nadie contestó el timbre." value={detalle} onChange={(e) => setDetalle(e.target.value)} aria-invalid={intento && falta} />
        {intento && falta && <span className="ch-msg-error"><Ico n="aviso" t={16} />Cuenta qué pasó para registrar el rechazo</span>}
      </div>
      <div className="ch-campo">
        <span className="ch-etiqueta">Foto de evidencia · opcional</span>
        <label className="ch-btn" htmlFor={campoFoto}><Ico n="camara" />{foto ? foto.name : 'Agregar foto de evidencia'}</label>
        <input id={campoFoto} type="file" accept="image/jpeg,image/png" capture="environment" className="solo-lectores" onChange={elegirFoto} />
        {errFoto && <span className="ch-msg-error"><Ico n="aviso" t={16} />{errFoto}</span>}
      </div>
      <div className="ch-nota">
        <Ico n="volver" />
        <div><strong>El pedido volverá a Bodega</strong><p>Quedará registrado como rechazado con la causal, la hora y la ubicación.</p></div>
      </div>
    </>
  );
  const confirmarBtn = <button type="submit" className="ch-btn pel grande" disabled={cierre.ocupado}><Ico n="x" />{cierre.ocupado ? 'Registrando…' : 'Confirmar rechazo'}</button>;
  const cancelar = <Link className="ch-btn xs" to={volver} aria-disabled={cierre.ocupado}>Cancelar</Link>;

  if (enDialogo) {
    return <Dialogo titulo="Registrar rechazo" subtitulo={subtitulo} ancho={560} onClose={() => irA(volver)} onSubmit={confirmar} pie={<>{cancelar}{confirmarBtn}</>}>{cuerpo}</Dialogo>;
  }
  return (
    <form onSubmit={confirmar} noValidate className="ch-form">
      <Volver a={volver}>{n ? `Parada ${n} · ` : ''}Orden #{d.codigo_externo}</Volver>
      <div className="ch-cont">
        <Titulo h="Registrar rechazo" sub={subtitulo} />
        {cuerpo}
      </div>
      <BarraAcciones>{confirmarBtn}{cancelar}</BarraAcciones>
    </form>
  );
}
