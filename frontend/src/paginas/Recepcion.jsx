import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, mensajeError } from '../api.js';
import '../oficina.css';
import './admin.css';
import HistorialCompras from './HistorialCompras.jsx';
import { Alerta, Boton, Campo, Icono, Tabla, clp, useAviso } from '../componentes/ui.jsx';

const PAGOS = ['Contado', 'Transferencia', 'Crédito 30 días', 'Crédito 60 días'];
const hoy = () => new Date().toISOString().slice(0, 10);
const captura = () => ({ producto: null, cantidad: '1', precio: '' });
const vacio = () => ({ rut: '', razon: '', numero: '', fecha: hoy(), pago: PAGOS[0], lineas: [] });

// Mismo cálculo que el backend (centavos enteros, IVA 19 % redondeado al peso); el backend recalcula y manda.
export function montos(lineas) {
  const cent = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * Math.round((Number(l.precio) || 0) * 100), 0);
  const iva = Math.floor((cent * 19 + 5000) / 10000);
  return { neto: cent / 100, iva, total: (cent + iva * 100) / 100 };
}

// Combobox de productos activos del catálogo: busca por SKU, modelo o marca y solo permite elegir de la lista.
function SelectorProducto({ etiqueta, valor, onElegir, error }) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [opciones, setOpciones] = useState([]);
  const [activa, setActiva] = useState(0);
  const [cargando, setCargando] = useState(false);
  const caja = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    let vigente = true;
    setCargando(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api(`/productos?q=${encodeURIComponent(texto.trim())}&activo=1&limite=8`);
        if (vigente) { setOpciones(data); setActiva(0); }
      } catch { if (vigente) setOpciones([]); } finally { if (vigente) setCargando(false); }
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [texto, abierto]);

  const elegir = (p) => { onElegir(p); setTexto(''); setAbierto(false); };
  const teclas = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActiva((a) => Math.min(a + 1, opciones.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiva((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && abierto && opciones[activa]) { e.preventDefault(); elegir(opciones[activa]); }
    else if (e.key === 'Escape') setAbierto(false);
  };

  return (
    <div className={`campo selector-producto ${error ? 'error' : ''}`} ref={caja}
      onBlur={(e) => { if (!caja.current.contains(e.relatedTarget)) setAbierto(false); }}>
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} className="entrada" role="combobox" aria-expanded={abierto} aria-controls={`${id}-l`} aria-autocomplete="list" autoComplete="off"
        placeholder="Buscar por SKU, modelo o marca"
        value={abierto ? texto : valor ? `${valor.sku} · ${valor.nombre}` : texto}
        onFocus={() => { setTexto(''); setAbierto(true); }}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); if (valor) onElegir(null); }}
        onKeyDown={teclas} />
      {abierto && (
        <ul id={`${id}-l`} className="selector-lista" role="listbox">
          {opciones.map((p, i) => (
            <li key={p.sku} role="option" aria-selected={i === activa} tabIndex={-1} className={i === activa ? 'activa' : ''}
              onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(p)}>
              <span className="dato sku">{p.sku}</span><span>{p.nombre}</span><span className="tenue">{p.marca}</span>
            </li>
          ))}
          {!opciones.length && <li className="sin-resultados">{cargando ? 'Buscando…' : 'Sin productos activos que coincidan'}</li>}
        </ul>
      )}
      {error && <span className="msg-error" role="alert">{error}</span>}
    </div>
  );
}

export default function Recepcion() {
  const avisar = useAviso();
  const [f, setF] = useState(vacio);
  const [cap, setCap] = useState(captura);
  const [errCap, setErrCap] = useState('');
  const [pdf, setPdf] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const entradaPdf = useRef(null);
  const elegirPdf = (f) => { if (f) setPdf(f); }; // el backend valida tipo y tamaño
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(null);
  const [pestana, setPestana] = useState('registrar');
  const m = useMemo(() => montos(f.lineas), [f.lineas]);
  const unidades = f.lineas.reduce((s, l) => s + l.cantidad, 0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function anadir() {
    const cantidad = Number(cap.cantidad);
    const precio = Number(cap.precio);
    if (!cap.producto) return setErrCap('Elige un producto del catálogo');
    if (!Number.isInteger(cantidad) || cantidad < 1) return setErrCap('La cantidad debe ser un entero mayor a 0');
    if (cap.precio === '' || !Number.isFinite(precio) || precio < 0) return setErrCap('El precio unitario neto debe ser mayor o igual a 0');
    const { sku, nombre, marca } = cap.producto;
    const previa = f.lineas.find((l) => l.sku === sku);
    if (previa && previa.precio !== precio) return setErrCap(`${sku} ya está en la factura a ${clp(previa.precio)}; quítalo para ingresarlo con otro precio`);
    setErrCap('');
    setF({ ...f, lineas: previa
      ? f.lineas.map((l) => (l.sku === sku ? { ...l, cantidad: l.cantidad + cantidad } : l)) // mismo producto: se suma
      : [...f.lineas, { sku, nombre, marca, cantidad, precio }] });
    setCap(captura());
  }
  const quitar = (sku) => setF({ ...f, lineas: f.lineas.filter((l) => l.sku !== sku) });
  // Editar = devolver el ítem a la fila de captura para corregirlo y volver a añadirlo.
  const editar = (l) => { setCap({ producto: l, cantidad: String(l.cantidad), precio: String(l.precio) }); quitar(l.sku); };

  async function enviar(e) {
    e.preventDefault();
    setError(''); setOk(null);
    if (!f.lineas.length) return setError('Añade al menos un ítem a la factura');
    if (pdf && pdf.type !== 'application/pdf') return setError('El archivo adjunto debe ser un PDF');
    if (pdf && pdf.size > 5 * 1024 * 1024) return setError('El PDF supera 5 MB');
    const datos = {
      rut_proveedor: f.rut, razon_social: f.razon, numero_factura: f.numero, fecha_emision: f.fecha, forma_pago: f.pago,
      items: f.lineas.map((l) => ({ sku: l.sku, cantidad: l.cantidad, precio_unitario_neto: l.precio })),
    };
    let cuerpo = datos;
    if (pdf) { cuerpo = new FormData(); cuerpo.append('datos', JSON.stringify(datos)); cuerpo.append('pdf', pdf); }
    setEnviando(true);
    try {
      const { data } = await api('/compras/recepciones', { metodo: 'POST', cuerpo });
      setOk(data); avisar('Recepción registrada'); setF(vacio()); setCap(captura()); setPdf(null);
    } catch (err) { setError(mensajeError(err)); } finally { setEnviando(false); }
  }

  return (
    <div className="vista compras">
      <div className="cabecera">
        <div><h1>Módulo de Compras y Recepción</h1><p>Ingreso formal de mercadería contra factura electrónica SII y consulta del historial de recepciones.</p></div>
        {f.numero.trim() && <span className="badge ink">Factura electrónica SII N° {f.numero.trim()}</span>}
      </div>
      <div className="pestanas" role="tablist" aria-label="Compras y Facturas">
        {[['registrar', 'Registrar recepción'], ['historial', 'Historial']].map(([k, t]) => (
          <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={pestana === k} aria-controls={`panel-${k}`} className={pestana === k ? 'activa' : ''} onClick={() => setPestana(k)}>{t}</button>
        ))}
      </div>
      {pestana === 'historial' && <div role="tabpanel" id="panel-historial" aria-labelledby="tab-historial"><HistorialCompras /></div>}
      <div hidden={pestana !== 'registrar'} role="tabpanel" id="panel-registrar" aria-labelledby="tab-registrar" className="vista-registrar">
      {ok && (
        <div className="alerta info" role="status">
          Factura {ok.numero_factura} registrada: {ok.unidades} unidades · neto {clp(ok.monto_neto)} · IVA {clp(ok.monto_iva)} · total <strong>{clp(ok.monto_total)}</strong>.
          {!ok.url_pdf_factura && ' Sin PDF adjunto.'}
        </div>
      )}
      <form onSubmit={enviar}>
       <div className="panel">
        <div className="seccion">1. Cabecera del documento tributario (proveedor)</div>
        <div className="grid5">
          <Campo etiqueta="R.U.T. proveedor *" placeholder="76.123.456-7" value={f.rut} onChange={set('rut')} required />
          <Campo etiqueta="Razón social proveedor *" value={f.razon} onChange={set('razon')} maxLength={120} required />
          <Campo etiqueta="N° factura electrónica *" value={f.numero} onChange={set('numero')} maxLength={20} required />
          <Campo etiqueta="Fecha de emisión *" type="date" max={hoy()} value={f.fecha} onChange={set('fecha')} required />
          <Campo etiqueta="Forma de pago" como="select" value={f.pago} onChange={set('pago')}>{PAGOS.map((p) => <option key={p}>{p}</option>)}</Campo>
          <div className="campo zona-pdf">
            <span className="rotulo solo-lectores">Factura en PDF (opcional, máx. 5 MB)</span>
            <div className={`zona-carga compacta ${arrastrando ? 'activa' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegirPdf(e.dataTransfer.files[0]); }}>
              <Icono n="factura" />
              <div className="zona-texto">
                {pdf ? <><strong>{pdf.name}</strong><span className="tenue">{(pdf.size / 1024).toFixed(0)} KB</span></> : <span className="tenue">Ningún archivo seleccionado</span>}
              </div>
              {pdf && <Boton className="icono-solo" aria-label="Quitar PDF" icono="x" onClick={() => setPdf(null)} />}
              <Boton onClick={() => entradaPdf.current.click()}>{pdf ? 'Cambiar archivo' : 'Adjuntar PDF'}</Boton>
              <input ref={entradaPdf} type="file" accept="application/pdf" hidden aria-label="Factura en PDF" onChange={(e) => { elegirPdf(e.target.files[0]); e.target.value = ''; }} />
            </div>
          </div>
        </div>
        <p className="ayuda">Permite archivar digitalmente la factura oficial para respaldo contable y auditorías. Opcional, máx. 5 MB.</p>
       </div>

       <div className="panel">
        <div className="seccion">2. Detalle de ítems y unidades físicas facturadas</div>
        <div className="captura">
          <SelectorProducto etiqueta="Producto / modelo *" valor={cap.producto} onElegir={(producto) => setCap({ ...cap, producto })} error={errCap} />
          <Campo etiqueta="Cantidad *" type="number" min="1" step="1" value={cap.cantidad} onChange={(e) => setCap({ ...cap, cantidad: e.target.value })} />
          <Campo etiqueta="Precio unitario neto ($) *" type="number" min="0" step="0.01" value={cap.precio} onChange={(e) => setCap({ ...cap, precio: e.target.value })} />
          <Boton onClick={anadir} disabled={f.lineas.length >= 200}>Añadir ítem a factura</Boton>
        </div>

        <Tabla columnas={['SKU', 'Descripción del producto', 'Marca', { t: 'Cantidad', d: true }, { t: 'Precio neto ($)', d: true }, { t: 'Total neto ($)', d: true }, 'Acciones']}
          vacio={f.lineas.length ? null : 'Aún no hay ítems: elige un producto y pulsa «Añadir ítem a factura».'}>
          {f.lineas.map((l) => (
            <tr key={l.sku}>
              <td className="dato sku">{l.sku}</td>
              <td>{l.nombre}</td>
              <td><span className="badge">{l.marca}</span></td>
              <td className="dato derecha">{l.cantidad} un.</td>
              <td className="dato derecha">{clp(l.precio)}</td>
              <td className="dato derecha sku">{clp(l.cantidad * l.precio)}</td>
              <td><div className="acciones-fila">
                <Boton className="icono-solo" aria-label={`Editar ${l.sku}`} icono="pencil" onClick={() => editar(l)} />
                <Boton className="icono-solo" aria-label={`Quitar ${l.sku}`} icono="x" onClick={() => quitar(l.sku)} />
              </div></td>
            </tr>
          ))}
        </Tabla>

        <div className="resumen">
        <dl className="totales">
          <div><dt>Total unidades físicas</dt><dd className="dato">{unidades} un.</dd></div>
          <div><dt>Monto neto</dt><dd className="dato">{clp(m.neto)}</dd></div>
          <div><dt>I.V.A. (19 %)</dt><dd className="dato">{clp(m.iva)}</dd></div>
          <div className="total"><dt>Total facturado</dt><dd className="dato">{clp(m.total)}</dd></div>
        </dl>
        <Alerta>{error}</Alerta>
        <Boton type="submit" variante="primario" disabled={enviando}>{enviando ? 'Registrando…' : 'Confirmar ingreso y actualizar stock en bodega'}</Boton>
        <p className="nota">Una sola transacción: recepción, detalle, stock físico y auditoría.</p>
        </div>
       </div>
      </form>
      </div>
    </div>
  );
}
