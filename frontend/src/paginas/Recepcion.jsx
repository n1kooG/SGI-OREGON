import { useMemo, useRef, useState } from 'react';
import { api, mensajeError } from '../api.js';
import '../oficina.css';
import { Alerta, Boton, Campo, Icono, clp, useAviso } from '../componentes/ui.jsx';

const PAGOS = ['Contado', 'Transferencia', 'Crédito 30 días', 'Crédito 60 días'];
const hoy = () => new Date().toISOString().slice(0, 10);
const linea = () => ({ sku: '', cantidad: '', precio: '' });
const vacio = () => ({ rut: '', razon: '', numero: '', fecha: hoy(), pago: PAGOS[0], lineas: [linea()] });

// Mismo cálculo que el backend (centavos enteros, IVA 19 % redondeado al peso); el backend recalcula y manda.
export function montos(lineas) {
  const cent = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * Math.round((Number(l.precio) || 0) * 100), 0);
  const iva = Math.floor((cent * 19 + 5000) / 10000);
  return { neto: cent / 100, iva, total: (cent + iva * 100) / 100 };
}

export default function Recepcion() {
  const avisar = useAviso();
  const [f, setF] = useState(vacio);
  const [pdf, setPdf] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const entradaPdf = useRef(null);
  const elegirPdf = (f) => { if (f) setPdf(f); }; // el backend valida tipo y tamaño
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(null);
  const m = useMemo(() => montos(f.lineas), [f.lineas]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setL = (i, k) => (e) => setF({ ...f, lineas: f.lineas.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)) });

  async function enviar(e) {
    e.preventDefault();
    setError(''); setOk(null);
    if (pdf && pdf.type !== 'application/pdf') return setError('El archivo adjunto debe ser un PDF');
    if (pdf && pdf.size > 5 * 1024 * 1024) return setError('El PDF supera 5 MB');
    const datos = {
      rut_proveedor: f.rut, razon_social: f.razon, numero_factura: f.numero, fecha_emision: f.fecha, forma_pago: f.pago,
      items: f.lineas.map((l) => ({ sku: l.sku, cantidad: Number(l.cantidad), precio_unitario_neto: Number(l.precio) })),
    };
    let cuerpo = datos;
    if (pdf) { cuerpo = new FormData(); cuerpo.append('datos', JSON.stringify(datos)); cuerpo.append('pdf', pdf); }
    setEnviando(true);
    try {
      const { data } = await api('/compras/recepciones', { metodo: 'POST', cuerpo });
      setOk(data); avisar('Recepción registrada'); setF(vacio()); setPdf(null);
    } catch (err) { setError(mensajeError(err)); } finally { setEnviando(false); }
  }

  return (
    <div className="vista compras">
      <div className="cabecera"><div><h1>Módulo de Compras y Recepción</h1><p>Ingreso formal de mercadería contra factura electrónica SII, desglose multiproducto y archivo digital en PDF.</p></div></div>
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
          <Campo etiqueta="RUT proveedor" placeholder="76.123.456-7" value={f.rut} onChange={set('rut')} required />
          <Campo etiqueta="Razón social" value={f.razon} onChange={set('razon')} maxLength={120} required />
          <Campo etiqueta="N° de factura" value={f.numero} onChange={set('numero')} maxLength={20} required />
          <Campo etiqueta="Fecha de emisión" type="date" max={hoy()} value={f.fecha} onChange={set('fecha')} required />
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
        {f.lineas.map((l, i) => (
          <div className="linea-fila" key={i}>
            <Campo etiqueta="SKU" value={l.sku} onChange={setL(i, 'sku')} required />
            <Campo etiqueta="Cantidad" type="number" min="1" step="1" value={l.cantidad} onChange={setL(i, 'cantidad')} required />
            <Campo etiqueta="Precio unitario neto" type="number" min="0" step="0.01" value={l.precio} onChange={setL(i, 'precio')} required />
            <Boton variante="enlace peligro" disabled={f.lineas.length === 1} onClick={() => setF({ ...f, lineas: f.lineas.filter((_, j) => j !== i) })}>Quitar</Boton>
          </div>
        ))}
        <Boton icono="plus" onClick={() => setF({ ...f, lineas: [...f.lineas, linea()] })} disabled={f.lineas.length >= 200}>Agregar línea</Boton>

        <div className="resumen">
        <dl className="totales">
          <div><dt>Neto</dt><dd className="dato">{clp(m.neto)}</dd></div>
          <div><dt>IVA (19 %)</dt><dd className="dato">{clp(m.iva)}</dd></div>
          <div className="total"><dt>Total</dt><dd className="dato">{clp(m.total)}</dd></div>
        </dl>
        <Alerta>{error}</Alerta>
        <Boton type="submit" variante="primario" disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar recepción'}</Boton>
        <p className="nota">Una sola transacción: recepción, detalle, stock físico y auditoría.</p>
        </div>
       </div>
      </form>
    </div>
  );
}
