import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Icono, Tabla, useAviso } from '../componentes/ui.jsx';
import { fechaCorta } from './Pedidos.jsx';

// Días calendario desde la recepción: define el color del aviso de antigüedad.
const diasDesde = (f) => {
  const dia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((dia(new Date()) - dia(new Date(f))) / 864e5);
};
export function Antiguedad({ fecha }) {
  const d = diasDesde(fecha);
  return <Badge tono={d <= 0 ? 'ok' : d <= 3 ? 'aviso' : 'mal'}>{d <= 0 ? 'Hoy' : `Hace ${d} ${d === 1 ? 'día' : 'días'}`}</Badge>;
}
const Atras = ({ onClick }) => <button type="button" className="volver" onClick={onClick}><Icono n="izq" />Descargas pendientes</button>;
const unidades = (n) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`;

function Lista({ onElegir, onManual }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const cargar = useCallback(async () => {
    setError('');
    try { setFilas((await api('/compras/descargas/pendientes')).data); } catch (e) { setError(mensajeError(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  return (
    <div className="movil-pagina descarga">
      <div className="cab-pagina">
        <div className="fila-sb"><h1>Descargas pendientes</h1>{filas && <Badge tono="ink">{filas.length} {filas.length === 1 ? 'factura' : 'facturas'}</Badge>}</div>
        <p className="tenue">Cuente las unidades recibidas y confirme la descarga.</p>
      </div>
      {error && <><Alerta>{error}</Alerta><Boton onClick={cargar}>Reintentar</Boton></>}
      {!filas && !error && <p className="tenue">Cargando…</p>}
      {filas?.length === 0 && (
        <div className="sin-nada">
          <span className="sello-ok"><Icono n="camion" /></span>
          <h2>Sin descargas pendientes</h2>
          <p>Cuando llegue un camión, la factura aparecerá aquí para que cuente la mercadería.</p>
        </div>
      )}
      {filas?.map((f) => (
        <article className="tarjeta-pedido" key={f.id_recepcion}>
          <div className="fila-sb"><span className="chip-sku">FAC-{f.numero_factura}</span><Antiguedad fecha={f.fecha_recepcion} /></div>
          <strong>{f.nombre_proveedor}</strong>
          <span className="dato-fecha"><Icono n="cal" />Recibida: {fechaCorta(f.fecha_recepcion)}</span>
          <div className="unidades-cuadro"><b>{f.unidades}</b>{f.unidades === 1 ? 'unidad esperada' : 'unidades esperadas'}</div>
          <Boton variante="primario bloque" onClick={() => onElegir(f)}>Contar y confirmar</Boton>
        </article>
      ))}
      {(filas || error) && <Boton className="enlace" onClick={onManual}>¿Llegó un camión sin factura registrada? Descarga manual</Boton>}
    </div>
  );
}

function Conteo({ factura: f, onVolver, onListo }) {
  const aviso = useAviso();
  const [lineas, setLineas] = useState(() => f.detalle.map((d) => ({ sku: d.sku, esperada: d.cantidad, contada: d.cantidad, nombre: '', ubi: '', ubi0: '' })));
  const [rut, setRut] = useState('');
  const [pedirRut, setPedirRut] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Nombre y ubicación vigente de cada SKU; si la búsqueda falla la línea se muestra solo con su SKU.
  useEffect(() => {
    let viva = true;
    Promise.all(f.detalle.map(async ({ sku }) => {
      try { return (await api(`/inventario/buscar?q=${encodeURIComponent(sku)}`)).data.find((p) => p.sku === sku); } catch { return null; }
    })).then((ps) => viva && setLineas((ls) => ls.map((l, i) => ({ ...l, nombre: ps[i]?.nombre ?? '', ubi: ps[i]?.ubicacion_bodega ?? '', ubi0: ps[i]?.ubicacion_bodega ?? '' }))));
    return () => { viva = false; };
  }, [f]);

  const poner = (i, k, v) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const cuenta = (i, n) => poner(i, 'contada', Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0));
  const { faltan, sobran, contadas } = useMemo(() => lineas.reduce((a, l) => ({
    faltan: a.faltan + Math.max(0, l.esperada - l.contada), sobran: a.sobran + Math.max(0, l.contada - l.esperada), contadas: a.contadas + l.contada,
  }), { faltan: 0, sobran: 0, contadas: 0 }), [lineas]);
  const conforme = faltan === 0 && sobran === 0;

  async function confirmar() {
    setError(''); setOcupado(true);
    try {
      const cuerpo = { numero_factura: f.numero_factura, bultos: lineas.map((l) => ({ sku: l.sku, cantidad: l.contada, ...(l.ubi.trim() !== l.ubi0.trim() && { ubicacion: l.ubi }) })), ...(rut && { rut_proveedor: rut }) };
      const { data } = await api('/compras/descargas', { metodo: 'POST', cuerpo });
      aviso(data.estado_documento === 'CONFORME' ? `Factura ${f.numero_factura} confirmada: conforme.` : `Factura ${f.numero_factura} confirmada con discrepancia.`);
      onListo();
    } catch (err) {
      if (err.codigo === 'FACTURA_AMBIGUA') setPedirRut(true); // misma factura en más de un proveedor
      setError(mensajeError(err));
    } finally { setOcupado(false); }
  }

  return (
    <div className="movil-pagina descarga conteo">
      <Atras onClick={onVolver} />
      <section className="cab-factura">
        <div className="fila-sb"><span className="chip-sku">FAC-{f.numero_factura}</span><Antiguedad fecha={f.fecha_recepcion} /></div>
        <h1>{f.nombre_proveedor}</h1>
        <span className="dato-fecha"><Icono n="cal" />Recibida: {fechaCorta(f.fecha_recepcion)}</span>
      </section>
      <div className={`estado-conteo ${conforme ? 'ok' : 'aviso'}`} role="status">
        <Icono n={conforme ? 'check' : 'alerta'} />
        <div>
          <strong>{conforme ? 'Conforme' : 'Con discrepancia'}</strong>
          <span>{conforme ? `Las ${f.unidades} unidades coinciden con la factura.` : `${[faltan && (faltan === 1 ? 'Falta 1' : `Faltan ${faltan}`), sobran && (sobran === 1 ? 'Sobra 1' : `Sobran ${sobran}`)].filter(Boolean).join(' · ')} · ${contadas} contadas de ${f.unidades} esperadas`}</span>
        </div>
      </div>
      <p className="tenue titulo-lista">Productos de la factura ({lineas.length})</p>
      {lineas.map((l, i) => {
        const dif = l.contada - l.esperada;
        const tono = dif === 0 ? 'ok' : dif < 0 ? 'aviso' : 'info';
        return (
          <article className={`linea-conteo ${dif < 0 ? 'falta' : dif > 0 ? 'sobra' : ''}`} key={l.sku}>
            <div className="fila-sb"><span className="chip-sku">{l.sku}</span><Badge tono={tono}>{dif === 0 ? 'Conforme' : dif < 0 ? `${dif === -1 ? 'Falta' : 'Faltan'} ${-dif}` : `${dif === 1 ? 'Sobra' : 'Sobran'} ${dif}`}</Badge></div>
            {l.nombre && <strong>{l.nombre}</strong>}
            <div className="control-conteo">
              <div className="esperadas"><small>Esperadas</small><b>{l.esperada}</b></div>
              <div className="stepper">
                <button type="button" className="menos" aria-label={`Restar una unidad de ${l.sku}`} disabled={l.contada === 0} onClick={() => cuenta(i, l.contada - 1)}><Icono n="menos" /></button>
                <input type="number" inputMode="numeric" min="0" step="1" aria-label={`Contadas de ${l.sku}`} value={l.contada} onChange={(e) => cuenta(i, e.target.valueAsNumber)} />
                <button type="button" className="mas" aria-label={`Sumar una unidad de ${l.sku}`} onClick={() => cuenta(i, l.contada + 1)}><Icono n="plus" /></button>
              </div>
            </div>
            <label className="campo-ubi"><span>Ubicación (opcional)</span>
              <span className="con-icono"><Icono n="pin" /><input className="entrada" maxLength={40} value={l.ubi} onChange={(e) => poner(i, 'ubi', e.target.value)} placeholder="Ej. Pasillo A - Estante 2" /></span>
            </label>
          </article>
        );
      })}
      {pedirRut && <Campo etiqueta="RUT del proveedor" ayuda="Esta factura existe para más de un proveedor." value={rut} onChange={(e) => setRut(e.target.value)} required />}
      <div className="pie-fijo">
        <Alerta>{error}</Alerta>
        {!conforme && <p>La descarga se registrará con la diferencia indicada.</p>}
        <Boton variante="primario bloque" disabled={ocupado} onClick={confirmar}>{ocupado ? 'Confirmando…' : 'Confirmar descarga'}</Boton>
      </div>
    </div>
  );
}

// ubi0 = ubicación vigente al buscar el SKU: solo se envía si el operario la cambia.
const fila = () => ({ sku: '', cantidad: '', ubi: '', ubi0: '' });

// Respaldo: llega un camión cuya factura nadie registró, o se necesita contar por número de factura.
function Manual({ onVolver }) {
  const [numero, setNumero] = useState('');
  const [rut, setRut] = useState('');
  const [pedirRut, setPedirRut] = useState(false);
  const [bultos, setBultos] = useState([fila()]);
  const [error, setError] = useState('');
  const [res, setRes] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const setB = (i, k) => (e) => setBultos(bultos.map((b, j) => (j === i ? { ...b, [k]: e.target.value } : b)));

  // Precarga la ubicación actual del SKU; si no se encuentra, la línea sigue sin ubicación previa.
  async function precargar(i) {
    const sku = bultos[i].sku.replace(/\s+/g, '').toUpperCase();
    if (sku.length < 2) return;
    let ubi = '';
    try { ubi = (await api(`/inventario/buscar?q=${encodeURIComponent(sku)}`)).data.find((p) => p.sku === sku)?.ubicacion_bodega ?? ''; } catch { /* la búsqueda es solo ayuda */ }
    setBultos((bs) => bs.map((b, j) => (j === i && b.sku === bultos[i].sku ? { ...b, ubi, ubi0: ubi } : b)));
  }

  async function confirmar(e) {
    e.preventDefault();
    setError(''); setRes(null); setOcupado(true);
    try {
      const cuerpo = { numero_factura: numero, bultos: bultos.map((b) => ({ sku: b.sku, cantidad: Number(b.cantidad), ...(b.ubi.trim() !== b.ubi0.trim() && { ubicacion: b.ubi }) })), ...(rut && { rut_proveedor: rut }) };
      setRes((await api('/compras/descargas', { metodo: 'POST', cuerpo })).data);
      setNumero(''); setRut(''); setPedirRut(false); setBultos([fila()]);
    } catch (err) {
      if (err.codigo === 'FACTURA_AMBIGUA') setPedirRut(true); // misma factura en más de un proveedor
      setError(err.status === 404 ? `No hay una factura ${numero} registrada. Revisa el número.` : mensajeError(err));
    } finally { setOcupado(false); }
  }

  return (
    <div className="movil-pagina descarga">
      <Atras onClick={onVolver} />
      <div className="cab-pagina">
        <div className="fila-sb"><h1>Descarga manual</h1><Badge>Control de entrada</Badge></div>
        <p className="tenue">Conteo y verificación física de bultos contra guía de despacho o factura</p>
      </div>
      {res && (
        <div className={`alerta ${res.estado_documento === 'CONFORME' ? 'info' : ''}`} role="status">
          Factura {res.numero_factura}: <Badge tono={res.estado_documento === 'CONFORME' ? 'ok' : 'mal'}>{res.estado_documento === 'CONFORME' ? 'Conforme' : 'Con discrepancia'}</Badge>
          {res.discrepancias.length > 0 && (
            <Tabla columnas={['SKU', { t: 'Esperado', d: true }, { t: 'Contado', d: true }]}>
              {res.discrepancias.map((d) => <tr key={d.sku}><td className="dato">{d.sku}</td><td className="dato derecha">{d.esperado}</td><td className="dato derecha">{d.contado}</td></tr>)}
            </Tabla>
          )}
        </div>
      )}
      <form onSubmit={confirmar}>
        <Campo etiqueta="Factura o guía" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} required />
        {pedirRut && <Campo etiqueta="RUT del proveedor" ayuda="Esta factura existe para más de un proveedor." value={rut} onChange={(e) => setRut(e.target.value)} required />}
        <section className="verificacion">
        <span className="etiqueta">Verificación física de bultos</span>
        <p className="tenue">Cuenta los bultos por SKU y confírmalos contra el número de factura.</p>
        {bultos.map((b, i) => (
          <div className="bulto-fila" key={i}>
            <Campo etiqueta="SKU" value={b.sku} onChange={setB(i, 'sku')} onBlur={() => precargar(i)} required />
            <Campo etiqueta="Cantidad" type="number" inputMode="numeric" min="0" step="1" value={b.cantidad} onChange={setB(i, 'cantidad')} required />
            <Boton className="icono-solo" aria-label="Quitar bulto" icono="x" disabled={bultos.length === 1} onClick={() => setBultos(bultos.filter((_, j) => j !== i))} />
            <Campo className="bulto-ubi" etiqueta="Ubicación (opcional)" value={b.ubi} onChange={setB(i, 'ubi')} maxLength={40} placeholder="Ej. Pasillo A - Estante 2" />
          </div>
        ))}
        <Boton icono="plus" onClick={() => setBultos([...bultos, fila()])}>Agregar SKU</Boton>
        </section>
        <Alerta>{error}</Alerta>
        <Boton type="submit" variante="primario bloque" disabled={ocupado}>{ocupado ? 'Confirmando…' : 'Confirmar descarga'}</Boton>
      </form>
    </div>
  );
}

export default function Descarga() {
  const [vista, setVista] = useState({ tipo: 'lista' });
  const volver = () => setVista({ tipo: 'lista' });
  useEffect(() => { window.scrollTo(0, 0); }, [vista]);
  if (vista.tipo === 'conteo') return <Conteo factura={vista.factura} onVolver={volver} onListo={volver} />;
  if (vista.tipo === 'manual') return <Manual onVolver={volver} />;
  return <Lista onElegir={(factura) => setVista({ tipo: 'conteo', factura })} onManual={() => setVista({ tipo: 'manual' })} />;
}
