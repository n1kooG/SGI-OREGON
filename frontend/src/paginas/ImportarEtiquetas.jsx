import { useId, useRef, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Boton, Icono, Modal } from '../componentes/ui.jsx';
import { IcoPdf, IcoSubir } from './etiquetaComun.jsx';

const MAX_ARCHIVOS = 100;
const MAX_BYTES = 2 * 1024 * 1024;
// Los que necesitan una acción de la jefatura van primero.
const PRIORIDAD = { NO_RECONOCIDA: 0, PEDIDO_NO_ENCONTRADO: 1, INVALIDO: 2, ASOCIADA: 3, REEMPLAZADA: 4 };
const necesitaAccion = (r) => PRIORIDAD[r.estado] < 3;
const ROTULO = { NO_RECONOCIDA: ['aviso', 'No reconocida'], PEDIDO_NO_ENCONTRADO: ['mal', 'Pedido no encontrado'], INVALIDO: ['mal', 'Archivo inválido'], REEMPLAZADA: ['info', 'Reemplazada'] };
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Misma regla que el servidor, para no subir lo que sabemos que va a rechazar.
function invalido(f) {
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return 'No es un archivo PDF.';
  if (!f.size) return 'El archivo está vacío.';
  if (f.size > MAX_BYTES) return 'Supera los 2 MB.';
  return null;
}

function SelectorPedido({ pedidos, valor, onElegir }) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const q = texto.trim().toLowerCase();
  const lista = pedidos.filter((p) => !q || p.codigo_externo.toLowerCase().includes(q) || p.nombre_cliente.toLowerCase().includes(q)).slice(0, 50);
  const elegir = (p) => { onElegir(p); setTexto(`#${p.codigo_externo} · ${p.nombre_cliente}`); setAbierto(false); };
  function tecla(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActivo((a) => Math.min(a + 1, lista.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && abierto && lista[activo]) { e.preventDefault(); elegir(lista[activo]); }
    else if (e.key === 'Escape' && abierto) { e.stopPropagation(); setAbierto(false); } // no cierra el modal
  }
  return (
    <div className="sel-pedido">
      <Icono n="search" />
      <input role="combobox" aria-expanded={abierto} aria-controls={`${id}-l`} aria-autocomplete="list" aria-activedescendant={abierto && lista[activo] ? `${id}-${lista[activo].id_orden}` : undefined}
        aria-label="Elegir pedido" placeholder="Elegir pedido" value={texto}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActivo(0); if (valor) onElegir(null); }}
        onFocus={() => setAbierto(true)} onBlur={() => setAbierto(false)} onKeyDown={tecla} />
      <Icono n="abajo" />
      {abierto && (
        <ul id={`${id}-l`} role="listbox" className="sel-lista">
          {lista.length === 0 && <li className="sel-vacio">Ningún pedido coincide.</li>}
          {lista.map((p, i) => (
            // mouseDown (y no click) para ganarle al blur del campo
            <li key={p.id_orden} id={`${id}-${p.id_orden}`} role="option" aria-selected={i === activo} className={i === activo ? 'activo' : ''} onMouseDown={(e) => { e.preventDefault(); elegir(p); }}>
              <span className="dato">#{p.codigo_externo}</span> {p.nombre_cliente}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilaArchivo({ r, pedidos, archivo, onAsignada }) {
  const [pedido, setPedido] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const ped = pedidos.find((p) => p.id_orden === r.id_orden);

  async function asignar() {
    setError(''); setOcupado(true);
    try {
      const f = new FormData();
      f.set('archivo', archivo);
      const { data } = await api(`/pedidos/${pedido.id_orden}/etiqueta`, { metodo: 'PUT', cuerpo: f });
      onAsignada({ archivo: r.archivo, estado: data.estado, id_orden: pedido.id_orden, codigo_externo: pedido.codigo_externo });
    } catch (e) { setError(mensajeError(e)); setOcupado(false); }
  }

  const [tono, rotulo] = ROTULO[r.estado] ?? ['ok', `Asociada a #${r.codigo_externo}`];
  const mensaje = r.estado === 'ASOCIADA' ? (ped ? `Pedido de ${ped.nombre_cliente} · ${ped.comuna ?? 'Sin comuna'}` : `Pedido #${r.codigo_externo}`)
    : r.estado === 'REEMPLAZADA' ? 'Reemplazó la etiqueta anterior de este pedido.'
    : r.motivo;
  return (
    <li className="etq-archivo">
      <div className="etq-fila">
        <span className="etq-icono"><IcoPdf /></span>
        <div className="etq-texto"><span className="dato">{r.archivo}</span><span>{mensaje}</span></div>
        <span className={`badge ${tono}`}>{rotulo}</span>
      </div>
      {r.estado === 'NO_RECONOCIDA' && (
        <div className="etq-asignar">
          <div className="etq-asignar-fila">
            <SelectorPedido pedidos={pedidos} valor={pedido} onElegir={setPedido} />
            <Boton disabled={!pedido || ocupado} onClick={asignar}>{ocupado ? 'Asignando…' : 'Asignar'}</Boton>
          </div>
          <span className="ayuda">Busca por N° de orden o por cliente. Ej.: 3248452216 o Juan Pérez.</span>
          <Alerta>{error}</Alerta>
        </div>
      )}
    </li>
  );
}

export default function ImportarEtiquetas({ pedidos, onClose, onCambio }) {
  const entrada = useRef(null);
  const archivos = useRef(new Map()); // nombre → File: «Asignar» reenvía el mismo archivo sin pedirlo otra vez
  const [fase, setFase] = useState('elegir'); // elegir | enviando | resultado
  const [arrastrando, setArrastrando] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [error, setError] = useState('');
  const [enviados, setEnviados] = useState(0);

  async function procesar(lista) {
    setError('');
    if (!lista.length) return;
    if (lista.length > MAX_ARCHIVOS) return setError(`Seleccionaste ${lista.length} archivos: el máximo por carga es ${MAX_ARCHIVOS}.`);
    const locales = [], validos = [];
    for (const f of lista) { const m = invalido(f); (m ? locales.push({ archivo: f.name, estado: 'INVALIDO', motivo: m }) : validos.push(f)); }
    archivos.current = new Map(validos.map((f) => [f.name, f]));
    setEnviados(validos.length); setFase('enviando');
    let remotos = [];
    if (validos.length) {
      try {
        const f = new FormData();
        validos.forEach((a) => f.append('archivos', a));
        remotos = (await api('/pedidos/etiquetas', { metodo: 'POST', cuerpo: f })).data.resultados;
        onCambio();
      } catch (e) { setError(mensajeError(e)); return setFase('elegir'); }
    }
    setResultados([...locales, ...remotos].sort((a, b) => PRIORIDAD[a.estado] - PRIORIDAD[b.estado]));
    setFase('resultado');
  }
  const elegidos = (e) => { procesar([...e.target.files]); e.target.value = ''; };
  const soltados = (e) => { e.preventDefault(); setArrastrando(false); procesar([...e.dataTransfer.files]); };
  const actualizar = (nuevo) => { setResultados((rs) => rs.map((r) => (r.archivo === nuevo.archivo ? nuevo : r))); onCambio(); };

  const pendientes = resultados.filter(necesitaAccion).length;
  const cuenta = (e) => resultados.filter((r) => r.estado === e).length;
  const resumen = [cuenta('ASOCIADA') && plural(cuenta('ASOCIADA'), 'asociada', 'asociadas'), cuenta('REEMPLAZADA') && plural(cuenta('REEMPLAZADA'), 'reemplazada', 'reemplazadas'), pendientes && `${pendientes} sin asociar`].filter(Boolean).join(' · ');

  const pie = fase === 'resultado'
    ? <><Boton onClick={() => setFase('elegir')}><IcoSubir />Importar más</Boton><Boton variante="primario" onClick={onClose} data-inicial>Listo</Boton></>
    : <Boton onClick={onClose}>Cancelar</Boton>;

  return (
    <Modal className="modal-etq" titulo="Importar etiquetas" onClose={onClose} pie={pie}
      subtitulo={fase === 'resultado' ? 'Resultado de la última carga. Revisa los archivos que necesitan acción.' : 'Sube los PDF que exportaste desde cada marketplace.'}>
      {fase !== 'resultado' && (
        <div className={`etq-zona ${arrastrando ? 'sobre' : ''}`} onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)} onDrop={soltados}>
          <span className="etq-icono grande"><IcoPdf /></span>
          {fase === 'enviando' ? (
            <div role="status" aria-live="polite" className="etq-progreso">
              <h3>Importando {plural(enviados, 'archivo', 'archivos')}…</h3>
              <p>Leyendo el N° de orden de cada PDF. No cierres esta ventana.</p>
              <progress aria-label="Importando etiquetas" />
            </div>
          ) : (
            <>
              <h3>Arrastra los PDF de etiquetas de tus marketplaces o selecciónalos</h3>
              <p>Se asocian solos por el N° de orden que lee el sistema dentro del PDF. Máx. 100 archivos de 2 MB.</p>
              <Boton variante="primario" data-inicial onClick={() => entrada.current.click()}><IcoSubir />Seleccionar archivos</Boton>
            </>
          )}
          <input ref={entrada} type="file" multiple accept="application/pdf,.pdf" hidden onChange={elegidos} />
        </div>
      )}
      {fase !== 'resultado' && <div aria-live="assertive"><Alerta>{error}</Alerta></div>}
      {fase === 'resultado' && (
        <>
          <div className="etq-resumen" role="status" aria-live="polite">
            <span className={`etq-check ${pendientes ? 'pend' : ''}`}><Icono n="check" /></span>
            <strong>{resumen || 'Sin archivos procesados'}</strong>
          </div>
          <p className="etq-nota">{plural(resultados.length, 'archivo procesado', 'archivos procesados')}, primero los que necesitan atención.</p>
          <ul className="etq-lista">
            {resultados.map((r) => <FilaArchivo key={r.archivo} r={r} pedidos={pedidos} archivo={archivos.current.get(r.archivo)} onAsignada={actualizar} />)}
          </ul>
        </>
      )}
    </Modal>
  );
}
