import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Icono, Tabla, clp, useAviso } from '../componentes/ui.jsx';
import { fechaCorta } from './Pedidos.jsx';
import './admin.css';

const LIMITE = 20;
const DESCARGA = { PENDIENTE: ['Pendiente', ''], CONFORME: ['Conforme', 'ok'], CON_DISCREPANCIA: ['Con discrepancia', 'aviso'] };
const VACIO = { proveedor: '', desde: '', hasta: '', q: '' };

function Detalle({ fila }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/compras/recepciones/${fila.id_recepcion}`).then(({ data }) => setD(data)).catch((e) => setError(mensajeError(e))); }, [fila.id_recepcion]);
  if (error) return <Alerta>{error}</Alerta>;
  if (!d) return <p className="tenue">Cargando…</p>;
  const hayDescarga = d.estado_descarga !== 'PENDIENTE';
  const dif = d.items.filter((i) => hayDescarga && i.recibida !== i.facturada);
  return (
    <div className="detalle-compra">
      <div className="detalle-compra-cab">
        <strong>Detalle de ítems · Factura N° {d.numero_factura}</strong>
        {dif.length > 0 && <span className="aviso-disc">{dif.map((i) => `${i.sku}: se recibió ${i.recibida} de ${i.facturada} unidades facturadas`).join(' · ')}</span>}
      </div>
      <div className="tabla-mini">
        <table>
          <thead><tr><th>SKU</th><th>Descripción</th><th className="derecha">Facturada</th>{hayDescarga && <th className="derecha">Recibida</th>}<th className="derecha">Neto unit.</th><th className="derecha">Total neto</th></tr></thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.sku} className={hayDescarga && i.recibida !== i.facturada ? 'discrepancia' : ''}>
                <td className="dato">{i.sku}</td><td>{i.nombre}</td>
                <td className="dato derecha">{i.facturada} un.</td>
                {hayDescarga && <td className="dato derecha">{i.recibida} un.</td>}
                <td className="dato derecha">{clp(i.precio_unitario_neto)}</td><td className="dato derecha">{clp(i.total_neto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function HistorialCompras() {
  const avisar = useAviso();
  const [f, setF] = useState(VACIO);
  const [aplicado, setAplicado] = useState(VACIO); // la búsqueda por N° espera 300 ms; el resto aplica al cambiar
  const [pagina, setPagina] = useState(1);
  const [filas, setFilas] = useState([]);
  const [total, setTotal] = useState(0);
  const [proveedores, setProveedores] = useState([]);
  const [abierta, setAbierta] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { api('/compras/recepciones/proveedores').then(({ data }) => setProveedores(data)).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => { setAplicado(f); setPagina(1); }, f.q === aplicado.q ? 0 : 300); return () => clearTimeout(t); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  const cargar = useCallback(async () => {
    setError('');
    try {
      const q = new URLSearchParams({ limite: LIMITE, pagina, ...Object.fromEntries(Object.entries(aplicado).filter(([, v]) => v)) });
      const { data, total: n } = await api(`/compras/recepciones?${q}`);
      setFilas(data); setTotal(n);
    } catch (e) { setError(mensajeError(e)); } finally { setCargando(false); }
  }, [aplicado, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const rango = f.desde && f.hasta && f.desde > f.hasta ? 'La fecha inicial no puede ser posterior a la final' : '';
  const paginas = Math.max(1, Math.ceil(total / LIMITE));
  const desde = (pagina - 1) * LIMITE + 1;

  async function verPdf(fila) {
    try {
      const { data } = await api(`/compras/recepciones/${fila.id_recepcion}/pdf`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e) { avisar(mensajeError(e), 'error'); }
  }

  return (
    <div className="historial-compras">
      <div className="filtros-hist">
        <Campo como="select" etiqueta="Proveedor" value={f.proveedor} onChange={set('proveedor')}>
          <option value="">Todos los proveedores</option>
          {proveedores.map((p) => <option key={p.rut_proveedor} value={p.rut_proveedor}>{p.nombre_proveedor}</option>)}
        </Campo>
        <Campo etiqueta="Desde" type="date" value={f.desde} max={f.hasta || undefined} onChange={set('desde')} />
        <Campo etiqueta="Hasta" type="date" value={f.hasta} min={f.desde || undefined} onChange={set('hasta')} error={rango} />
        <div className="campo buscador-fact">
          <label htmlFor="q-factura">Buscar por N° de factura</label>
          <div className="con-icono"><Icono n="search" /><input id="q-factura" className="entrada" placeholder="Ej. 54691" maxLength={20} value={f.q} onChange={set('q')} /></div>
        </div>
        <Boton className="enlace" onClick={() => { setF(VACIO); setAplicado(VACIO); setPagina(1); }}>Limpiar</Boton>
      </div>
      <Alerta>{error}</Alerta>
      <Tabla columnas={['', 'Fecha', 'Proveedor', 'N° factura', { t: 'Neto', d: 1 }, { t: 'IVA', d: 1 }, { t: 'Total', d: 1 }, 'Estado de descarga', { t: 'PDF', d: 1 }]}
        vacio={cargando ? 'Cargando…' : !filas.length && !error ? 'No hay recepciones con esos filtros.' : null}>
        {filas.map((r) => {
          const [txt, tono] = DESCARGA[r.estado_descarga];
          const abierto = abierta === r.id_recepcion;
          return (
            <Fragment key={r.id_recepcion}>
              <tr className={abierto ? 'abierta' : ''}>
                <td><Boton className="icono-solo expandir" aria-expanded={abierto} aria-label={`${abierto ? 'Ocultar' : 'Ver'} ítems de la factura ${r.numero_factura}`} onClick={() => setAbierta(abierto ? null : r.id_recepcion)}><Icono n={abierto ? 'abajo' : 'der'} /></Boton></td>
                <td className="dato">{fechaCorta(r.fecha_emision)}</td>
                <td>{r.nombre_proveedor}</td>
                <td className="dato">{r.numero_factura}</td>
                <td className="dato derecha">{clp(r.monto_neto)}</td>
                <td className="dato derecha">{clp(r.monto_iva)}</td>
                <td className="dato derecha total-col">{clp(r.monto_total)}</td>
                <td><Badge tono={tono}>{r.estado_descarga !== 'PENDIENTE' && '● '}{txt}</Badge></td>
                <td className="derecha">
                  <Boton className="icono-solo" icono="factura" disabled={!r.tiene_pdf} title={r.tiene_pdf ? 'Ver PDF de la factura' : 'Sin PDF adjunto'}
                    aria-label={r.tiene_pdf ? `Ver PDF de la factura ${r.numero_factura}` : `Factura ${r.numero_factura}: sin PDF adjunto`} onClick={() => verPdf(r)} />
                </td>
              </tr>
              {abierto && <tr className="fila-detalle"><td colSpan={9}><Detalle fila={r} /></td></tr>}
            </Fragment>
          );
        })}
      </Tabla>
      <div className="paginacion">
        <span>{total ? `Mostrando ${desde}–${desde + filas.length - 1} de ${total}` : ''}</span>
        <div className="pags">
          <Boton className="icono-solo" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}><Icono n="izq" /></Boton>
          <Boton className="icono-solo pag-activa" aria-current="page">{pagina}</Boton>
          <Boton className="icono-solo" aria-label="Página siguiente" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}><Icono n="der" /></Boton>
        </div>
      </div>
    </div>
  );
}
