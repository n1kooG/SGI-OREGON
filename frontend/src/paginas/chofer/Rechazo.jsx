import { useId, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Alerta, useAviso } from '../../componentes/ui.jsx';
import { Ico } from './iconos.jsx';
import { useCierre, useParada, useUbicacion, validarFoto } from './datos.js';
import { Aviso, BarraAcciones, Titulo, Volver } from './comunes.jsx';

const CAUSALES = ['Cliente ausente', 'Dirección incorrecta', 'Rechaza el producto', 'Producto dañado', 'Otro'];
const MAX_MOTIVO = 300; // el backend guarda «Causal — detalle» en un solo campo de texto

export default function Rechazo() {
  const { id } = useParams();
  const irA = useNavigate();
  const aviso = useAviso();
  const { parada: d, error: errCarga, n } = useParada(id);
  const ubicacion = useUbicacion();
  const campoFoto = useId();
  const [causal, setCausal] = useState(CAUSALES[0]);
  const [detalle, setDetalle] = useState('');
  const [foto, setFoto] = useState(null);
  const [errFoto, setErrFoto] = useState('');
  const [intento, setIntento] = useState(false);
  const cierre = useCierre({ parada: d, ubicacion, alTerminar: (msg) => { if (msg) aviso(msg); irA('/chofer/ruta', { replace: true }); } });

  if (errCarga) return <div className="ch-cont"><Alerta>{errCarga}</Alerta><Link className="ch-btn" to="/chofer/ruta">Volver a la ruta</Link></div>;
  if (!d) return <div className="ch-cont"><p className="ch-vacio-txt">Cargando…</p></div>;
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

  return (
    <form onSubmit={confirmar} noValidate className="ch-form">
      <Volver a={`/chofer/ruta/${id}`}>{n ? `Parada ${n} · ` : ''}Orden #{d.codigo_externo}</Volver>
      <div className="ch-cont">
        <Titulo h="Registrar rechazo" sub={`${n ? `Parada ${n} · ` : ''}Orden #${d.codigo_externo} · ${d.nombre_cliente}`} />
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
      </div>
      <BarraAcciones>
        <button type="submit" className="ch-btn pel grande" disabled={cierre.ocupado}><Ico n="x" />{cierre.ocupado ? 'Registrando…' : 'Confirmar rechazo'}</button>
        <Link className="ch-btn xs" to={`/chofer/ruta/${id}`} aria-disabled={cierre.ocupado}>Cancelar</Link>
      </BarraAcciones>
    </form>
  );
}
