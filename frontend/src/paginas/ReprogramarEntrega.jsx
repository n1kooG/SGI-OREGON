import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Icono, Modal, useAviso } from '../componentes/ui.jsx';
import { causalResumida } from './Pedidos.jsx';
import './reprogramar.css';

// «Hoy» es la fecha civil de Santiago, igual que en la API: no depende de la zona del navegador.
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
const sumarDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
export const ddmmaaaa = (iso) => iso.split('-').reverse().join('-');
export const ddmm = (iso) => iso.slice(5).split('-').reverse().join('-');
// «dd-mm-aaaa» → ISO; null si no es una fecha real.
const leerFecha = (t) => {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
};
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const telefonoValido = (t) => {
  const d = t.replace(/\D/g, '');
  return /^\+?[\d -]+$/.test(t) && (d.startsWith('56') ? d.length === 11 : d.length >= 8 && d.length <= 9);
};
const SERVIDOR = { id_chofer: 'chofer', fecha_entrega: 'fecha', nota: 'nota', direccion_despacho: 'direccion', comuna: 'comuna', telefono_contacto: 'telefono' };

function Calendario({ valor, hoy, onElegir, onCerrar }) {
  const [foco, setFoco] = useState(valor && valor >= hoy ? valor : hoy);
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('[tabindex="0"]')?.focus(); }, [foco]);
  const [y, m] = foco.split('-').map(Number);
  const primero = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const inicio = sumarDias(`${y}-${String(m).padStart(2, '0')}-01`, -((primero + 6) % 7));
  const dias = Array.from({ length: 42 }, (_, i) => sumarDias(inicio, i));
  const mover = (n) => setFoco((f) => { const x = sumarDias(f, n); return x < hoy ? hoy : x; });
  const mes = (n) => setFoco((f) => { const [a, b] = f.split('-').map(Number); const ult = new Date(Date.UTC(a, b + n, 0)).getUTCDate(); const x = new Date(Date.UTC(a, b - 1 + n, Math.min(+f.slice(8), ult))).toISOString().slice(0, 10); return x < hoy ? hoy : x; });
  function tecla(e) {
    const mapa = { ArrowLeft: () => mover(-1), ArrowRight: () => mover(1), ArrowUp: () => mover(-7), ArrowDown: () => mover(7), PageUp: () => mes(-1), PageDown: () => mes(1) };
    if (mapa[e.key]) { e.preventDefault(); mapa[e.key](); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCerrar(); } // cierra solo el calendario, no el modal
  }
  const anteriorOculto = `${y}-${String(m).padStart(2, '0')}` <= hoy.slice(0, 7);
  return (
    <div className="rep-cal" ref={ref} role="dialog" aria-label="Elegir fecha de entrega" onKeyDown={tecla}>
      <div className="rep-cal-cab">
        <button type="button" className="rep-cal-nav" aria-label="Mes anterior" disabled={anteriorOculto} onClick={() => mes(-1)}><Icono n="izq" /></button>
        <strong aria-live="polite">{MESES[m - 1]} {y}</strong>
        <button type="button" className="rep-cal-nav" aria-label="Mes siguiente" onClick={() => mes(1)}><Icono n="der" /></button>
      </div>
      <div className="rep-cal-grid" role="grid">
        {DIAS.map((d, i) => <span key={i} className="rep-cal-dia" role="columnheader">{d}</span>)}
        {dias.map((d) => {
          const pasado = d < hoy;
          const fuera = +d.slice(5, 7) !== m;
          return (
            <button key={d} type="button" tabIndex={d === foco ? 0 : -1} disabled={pasado} aria-pressed={d === valor} aria-current={d === hoy ? 'date' : undefined}
              aria-label={ddmmaaaa(d)} className={`rep-cal-celda ${fuera ? 'fuera' : ''} ${d === hoy ? 'hoy' : ''} ${d === valor ? 'sel' : ''}`} onClick={() => onElegir(d)}>
              {+d.slice(8)}
            </button>
          );
        })}
      </div>
      <p className="rep-cal-pie">Solo hoy o fechas futuras</p>
    </div>
  );
}

function SelChofer({ choferes, valor, onElegir, error, id }) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const q = texto.trim().toLowerCase();
  const lista = choferes.filter((c) => !q || c.nombre_completo.toLowerCase().includes(q));
  const elegir = (c) => { onElegir(c.id_usuario); setTexto(c.nombre_completo); setAbierto(false); };
  function tecla(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActivo((a) => Math.min(a + 1, lista.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && abierto && lista[activo]) { e.preventDefault(); elegir(lista[activo]); }
    else if (e.key === 'Escape' && abierto) { e.stopPropagation(); setAbierto(false); }
  }
  return (
    <div className={`sel-pedido ${error ? 'con-error' : ''}`}>
      <Icono n="search" />
      <input id={id} role="combobox" aria-expanded={abierto} aria-controls={`${id}-l`} aria-autocomplete="list" autoComplete="off" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined}
        aria-activedescendant={abierto && lista[activo] ? `${id}-${lista[activo].id_usuario}` : undefined}
        placeholder="Buscar chofer por nombre…" value={texto}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActivo(0); if (valor) onElegir(null); }}
        onFocus={() => setAbierto(true)} onBlur={() => setAbierto(false)} onKeyDown={tecla} />
      <Icono n="abajo" />
      {abierto && (
        <ul id={`${id}-l`} role="listbox" className="sel-lista">
          {lista.length === 0 && <li className="sel-vacio">{choferes.length ? 'Ningún chofer coincide.' : 'No hay choferes activos.'}</li>}
          {lista.map((c, i) => (
            // mouseDown (y no click) para ganarle al blur del campo
            <li key={c.id_usuario} id={`${id}-${c.id_usuario}`} role="option" aria-selected={i === activo} className={i === activo ? 'activo' : ''} onMouseDown={(e) => { e.preventDefault(); elegir(c); }}>{c.nombre_completo}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MsgError = ({ id, children }) => children ? <span id={id} className="msg-error rep-error"><Icono n="alerta" />{children}</span> : null;

export default function ReprogramarEntrega({ pedido, comunas = [], onClose, onHecho }) {
  const aviso = useAviso();
  const id = useId();
  const hoy = useMemo(hoyISO, []);
  const [det, setDet] = useState(null);
  const [choferes, setChoferes] = useState(null);
  const [errCarga, setErrCarga] = useState('');
  const [direccion, setDireccion] = useState('');
  const [comuna, setComuna] = useState('');
  const [telefono, setTelefono] = useState('');
  const [idChofer, setIdChofer] = useState(null);
  const [fecha, setFecha] = useState('');
  const [nota, setNota] = useState('');
  const [cal, setCal] = useState(false);
  const [errores, setErrores] = useState({});
  const [general, setGeneral] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const zonaFecha = useRef(null);

  useEffect(() => {
    Promise.all([api(`/pedidos/${pedido.id_orden}`), api('/usuarios')]).then(([{ data: p }, { data: u }]) => {
      setDet(p);
      setDireccion(p.direccion_despacho ?? ''); setComuna(p.comuna ?? ''); setTelefono(p.telefono_contacto ?? '');
      setChoferes(u.filter((x) => x.rol === 'CHOFER' && x.activo));
    }).catch((e) => setErrCarga(mensajeError(e)));
  }, [pedido.id_orden]);

  // El calendario se cierra al hacer clic fuera de él.
  useEffect(() => {
    if (!cal) return undefined;
    const fuera = (e) => { if (!zonaFecha.current?.contains(e.target)) setCal(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [cal]);

  const previo = det?.intentos?.findLast((i) => i.estado_entrega === 'RECHAZADO');
  const fechaPrevio = det?.fecha_rechazo ?? det?.fecha_cierre;
  const horaPrevio = fechaPrevio && new Date(fechaPrevio).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\//g, '-').replace(',', ' ·');
  const iso = leerFecha(fecha);
  const sugerencias = useMemo(() => [...new Set(comunas)].sort((a, b) => a.localeCompare(b, 'es')), [comunas]);

  function validar() {
    const e = {};
    if (!idChofer) e.chofer = 'Selecciona un chofer para la entrega.';
    if (!fecha.trim()) e.fecha = 'Indica la fecha de entrega.';
    else if (!iso) e.fecha = 'Fecha no válida. Usa el formato dd-mm-aaaa.';
    else if (iso < hoy) e.fecha = `La fecha no puede ser anterior a hoy (${ddmmaaaa(hoy)}).`;
    if (!direccion.trim() && det.direccion_despacho) e.direccion = 'La dirección no puede quedar vacía.';
    else if (direccion.trim().length > 200) e.direccion = 'La dirección admite máximo 200 caracteres.';
    if (!comuna.trim() && det.comuna) e.comuna = 'La comuna no puede quedar vacía.';
    else if (comuna.trim().length > 60) e.comuna = 'La comuna admite máximo 60 caracteres.';
    if (telefono.trim() ? !telefonoValido(telefono.trim()) : det.telefono_contacto) e.telefono = 'Teléfono no válido. Usa el formato +56 9 1234 5678.';
    if (nota.length > 300) e.nota = 'La nota admite máximo 300 caracteres.';
    return e;
  }

  async function enviar() {
    const e = validar();
    setErrores(e); setGeneral('');
    if (Object.keys(e).length) return;
    // Solo se envían los datos de entrega que cambiaron: la API audita únicamente esas diferencias.
    const cambio = (nuevo, antes) => nuevo.trim() !== (antes ?? '') && nuevo.trim();
    const cuerpo = {
      id_chofer: idChofer, fecha_entrega: iso,
      ...(nota.trim() && { nota: nota.trim() }),
      ...(cambio(direccion, det.direccion_despacho) && { direccion_despacho: direccion.trim() }),
      ...(cambio(comuna, det.comuna) && { comuna: comuna.trim() }),
      ...(cambio(telefono, det.telefono_contacto) && { telefono_contacto: telefono.trim() }),
    };
    setOcupado(true);
    try {
      await api(`/pedidos/${pedido.id_orden}/reprogramar`, { metodo: 'POST', cuerpo });
      aviso(`Entrega reprogramada para el ${ddmm(iso)} con ${choferes.find((c) => c.id_usuario === idChofer).nombre_completo}`);
      onHecho();
    } catch (err) {
      const campo = err.codigo === 'FECHA_PASADA' ? 'fecha' : SERVIDOR[/^\w+/.exec(err.message)?.[0]];
      if (err.status === 400 && campo) setErrores({ [campo]: err.codigo === 'FECHA_PASADA' ? `La fecha no puede ser anterior a hoy (${ddmmaaaa(hoy)}).` : err.message });
      else setGeneral(err.status === 409 ? `${err.message}. Actualiza la lista e inténtalo de nuevo.` : mensajeError(err));
      setOcupado(false);
    }
  }

  const elegirFecha = (d) => { setFecha(ddmmaaaa(d)); setCal(false); setErrores((x) => ({ ...x, fecha: undefined })); };
  const limpiar = (k) => setErrores((x) => ({ ...x, [k]: undefined }));
  const cargado = det && choferes;

  return (
    <Modal className="modal-rep" titulo="Reprogramar entrega" subtitulo={<>Orden <span className="dato">#{pedido.codigo_externo}</span> · {pedido.nombre_cliente}</>} onClose={onClose}
      pie={cargado && <>
        <p className="rep-ayuda">El chofer verá la orden en su ruta desde la fecha elegida, con tu nota y la insignia «Reprogramada».</p>
        <Boton onClick={onClose} disabled={ocupado}>Cancelar</Boton>
        <Boton variante="primario" onClick={enviar} disabled={ocupado} aria-busy={ocupado}>{ocupado ? 'Reprogramando…' : 'Reprogramar entrega'}</Boton>
      </>}>
      <Alerta>{errCarga}</Alerta>
      {!cargado && !errCarga && <p className="vacio">Cargando…</p>}
      {cargado && (
        <div className="rep-cuerpo">
          <section className="rep-previo" aria-label="Intento anterior">
            <div className="rep-previo-cab"><span className="rep-titulo">Intento anterior</span><span className="rep-intento">Intento <b className="dato">{previo?.intento ?? det.intento}</b></span></div>
            <div className="rep-previo-datos">
              <div><span>Chofer</span><p>{previo?.chofer ?? det.nombre_chofer ?? '—'}</p></div>
              <div><span>Fecha del intento</span><p className="dato">{horaPrevio ?? '—'}</p></div>
              <div><span>Causal del rechazo</span><Badge tono="mal">{causalResumida(previo?.motivo_rechazo ?? det.motivo_rechazo ?? '') || 'Sin causal'}</Badge></div>
            </div>
          </section>

          <fieldset className="rep-grupo">
            <legend className="rep-titulo">Datos de entrega</legend>
            <div className={`campo ${errores.direccion ? 'error' : ''}`}>
              <label htmlFor={`${id}-dir`}>Dirección</label>
              <input id={`${id}-dir`} className="entrada" value={direccion} aria-invalid={!!errores.direccion} aria-describedby={errores.direccion ? `${id}-dir-e` : undefined} onChange={(e) => { setDireccion(e.target.value); limpiar('direccion'); }} data-inicial />
              <MsgError id={`${id}-dir-e`}>{errores.direccion}</MsgError>
            </div>
            <div className="rep-fila">
              <div className={`campo ${errores.comuna ? 'error' : ''}`}>
                <label htmlFor={`${id}-com`}>Comuna</label>
                <input id={`${id}-com`} className="entrada" list={`${id}-comunas`} autoComplete="off" value={comuna} aria-invalid={!!errores.comuna} aria-describedby={errores.comuna ? `${id}-com-e` : undefined} onChange={(e) => { setComuna(e.target.value); limpiar('comuna'); }} />
                <datalist id={`${id}-comunas`}>{sugerencias.map((c) => <option key={c} value={c} />)}</datalist>
                <MsgError id={`${id}-com-e`}>{errores.comuna}</MsgError>
              </div>
              <div className={`campo ${errores.telefono ? 'error' : ''}`}>
                <label htmlFor={`${id}-tel`}>Teléfono de contacto</label>
                <input id={`${id}-tel`} className="entrada" type="tel" value={telefono} maxLength={20} aria-invalid={!!errores.telefono} aria-describedby={errores.telefono ? `${id}-tel-e` : undefined} onChange={(e) => { setTelefono(e.target.value); limpiar('telefono'); }} />
                <MsgError id={`${id}-tel-e`}>{errores.telefono}</MsgError>
              </div>
            </div>
          </fieldset>

          <fieldset className="rep-grupo">
            <legend className="rep-titulo">Nueva asignación</legend>
            <div className="rep-fila">
              <div className={`campo ${errores.chofer ? 'error' : ''}`}>
                <label htmlFor={`${id}-cho`}>Chofer</label>
                <SelChofer id={`${id}-cho`} choferes={choferes} valor={idChofer} error={errores.chofer} onElegir={(v) => { setIdChofer(v); if (v) limpiar('chofer'); }} />
                <MsgError id={`${id}-cho-e`}>{errores.chofer}</MsgError>
              </div>
              <div className={`campo rep-fecha ${errores.fecha ? 'error' : ''}`} ref={zonaFecha}>
                <label htmlFor={`${id}-fec`}>Fecha de entrega</label>
                <div className="rep-fecha-campo">
                  <button type="button" className="rep-fecha-ico" aria-label="Abrir calendario" onClick={() => setCal((v) => !v)}><Icono n="cal" /></button>
                  <input id={`${id}-fec`} className="entrada" inputMode="numeric" autoComplete="off" placeholder="dd-mm-aaaa" maxLength={10} value={fecha} aria-invalid={!!errores.fecha} aria-describedby={errores.fecha ? `${id}-fec-e` : undefined}
                    onChange={(e) => { setFecha(e.target.value); limpiar('fecha'); }} onClick={() => setCal(true)} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setCal(true); } }} />
                </div>
                {cal && <Calendario valor={iso} hoy={hoy} onElegir={elegirFecha} onCerrar={() => { setCal(false); zonaFecha.current?.querySelector('input').focus(); }} />}
                <MsgError id={`${id}-fec-e`}>{errores.fecha}</MsgError>
                <div className="rep-atajos">
                  <button type="button" className="rep-atajo" aria-pressed={iso === hoy} onClick={() => elegirFecha(hoy)}>Hoy</button>
                  <button type="button" className="rep-atajo" aria-pressed={iso === sumarDias(hoy, 1)} onClick={() => elegirFecha(sumarDias(hoy, 1))}>Mañana</button>
                </div>
              </div>
            </div>
          </fieldset>

          <div className={`campo rep-nota ${errores.nota || nota.length > 300 ? 'error' : ''}`}>
            <div className="rep-nota-cab">
              <label htmlFor={`${id}-not`}>Nota para el chofer (opcional)</label>
              <span className={`dato ${nota.length > 300 ? 'excede' : ''}`} aria-live="polite">{nota.length}/300</span>
            </div>
            <textarea id={`${id}-not`} className="entrada" rows={3} placeholder="Ej. Tocar el timbre 402, llamar antes de llegar" value={nota} aria-invalid={nota.length > 300} aria-describedby={errores.nota ? `${id}-not-e` : undefined} onChange={(e) => { setNota(e.target.value); limpiar('nota'); }} />
            <MsgError id={`${id}-not-e`}>{errores.nota}</MsgError>
          </div>
          <div aria-live="polite" aria-atomic="true"><Alerta>{general}</Alerta></div>
        </div>
      )}
    </Modal>
  );
}
