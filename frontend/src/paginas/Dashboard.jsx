import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '@fontsource/jetbrains-mono/latin-700.css';
import { api, mensajeError } from '../api.js';
import '../oficina.css';
import './dashboard.css';
import { Alerta, Badge, Boton, Icono, Tabla, clp, useAviso } from '../componentes/ui.jsx';
import { BarrasApiladas, LineasMargen, Muestra, RankingRotacion, millones } from './DashboardGraficos.jsx';

const num = (v) => Number(v ?? 0).toLocaleString('es-CL');
const dec = (v) => Number(v).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const REFRESCO_MS = 30000; // mismo TTL de la caché del backend
const PERIODOS = [['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']];
const POR = { semana: 'día', mes: 'semana', anio: 'mes' };
const TOTAL_DE = { semana: 'Total de la semana', mes: 'Total del mes', anio: 'Total del año' };
const NIVEL = { QUIEBRE_INMINENTE: ['mal', 'Quiebre inminente'], BAJO_MINIMO: ['aviso', 'Bajo mínimo'], ABASTECIDO: ['ok', 'Abastecido'] };
const CANALES = [['mayorista', 'Mayorista'], ['marketplace', 'Marketplace'], ['web', 'Web']];

const Chevron = ({ abierto }) => <svg className={`chevron ${abierto ? 'abierto' : ''}`} width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const IconoDoc = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
const IconoBarras = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M7 20V12M12 20V5M17 20v-6" /></svg>;

// «Actualizado hace X s»: se recalcula cada segundo sin volver a pedir datos.
function Actualizado({ momento, cargando, fallo }) {
  const [, setAhora] = useState(0);
  useEffect(() => { const t = setInterval(() => setAhora((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (cargando && !momento) return <div className="actualizado"><span className="punto cargando" aria-hidden="true" />Cargando reportes…</div>;
  const s = Math.max(0, Math.round((Date.now() - momento) / 1000));
  return <div className="actualizado" role="status"><span className={`punto ${fallo ? 'fallo' : ''}`} aria-hidden="true" />{fallo ? `No se pudo actualizar · último dato hace ${s} s` : `Actualizado hace ${s} s · se refresca cada 30 s`}</div>;
}

function MenuExportar({ periodo, rotulo, deshabilitado, onError }) {
  const [abierto, setAbierto] = useState(false);
  const [bajando, setBajando] = useState('');
  const ref = useRef(null);
  const aviso = useAviso();
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (!ref.current?.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);
  // La descarga necesita el token, que un enlace directo no envía: se pide como blob y se baja con un enlace temporal.
  async function bajar(formato) {
    setBajando(formato); setAbierto(false); onError('');
    try {
      const { data } = await api(`/reportes/gestion/exportar?formato=${formato}&periodo=${periodo}`, { blob: true });
      const nombre = `reporte_gestion_${periodo}_${new Date().toLocaleDateString('en-CA')}.${formato}`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(data), download: nombre });
      a.click(); URL.revokeObjectURL(a.href);
      aviso(`Reporte exportado: ${nombre}`);
    } catch (e) { onError(mensajeError(e)); } finally { setBajando(''); }
  }
  return (
    <div className="exportar" ref={ref}>
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={abierto} disabled={deshabilitado || !!bajando} onClick={() => setAbierto((v) => !v)}>
        {bajando ? 'Exportando…' : 'Exportar reporte'}<Chevron abierto={abierto} />
      </button>
      {abierto && (
        <div className="menu-exportar" role="menu">
          <p className="rotulo">Exportar período</p>
          <p className="menu-periodo">{rotulo}</p>
          <button type="button" role="menuitem" onClick={() => bajar('xlsx')}><span className="doc"><IconoDoc /></span><span><strong>Excel (.xlsx)</strong><small>Datos de todas las tablas</small></span></button>
          <button type="button" role="menuitem" onClick={() => bajar('pdf')}><span className="doc"><IconoDoc /></span><span><strong>PDF (A4)</strong><small>Reporte imprimible</small></span></button>
        </div>
      )}
    </div>
  );
}

// Banner «N quiebres detectados» con la tabla de compras sugeridas (HU09).
function BannerQuiebres({ alertas }) {
  const [abierto, setAbierto] = useState(true);
  const ir = useNavigate();
  const n = alertas.quiebres;
  if (!n) return null;
  return (
    <section className="banner-quiebres" aria-label="Alertas de stock">
      <div className="banner-cab">
        <span className="banner-icono"><Icono n="campana" /></span>
        <div className="banner-texto">
          <strong>{n} {n === 1 ? 'quiebre detectado' : 'quiebres detectados'}</strong>
          <span>{n} {n === 1 ? 'SKU está bajo su stock mínimo' : 'SKUs están bajo su stock mínimo'}. Revisa las compras sugeridas y registra la compra.</span>
        </div>
        <button type="button" className="banner-alternar" aria-expanded={abierto} aria-controls="compras-sugeridas" onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Ocultar compras sugeridas' : 'Mostrar compras sugeridas'}<Chevron abierto={abierto} />
        </button>
      </div>
      {abierto && (
        <div className="banner-panel" id="compras-sugeridas">
          <div className="panel-titulo">
            <div><h2>Compras sugeridas</h2><p>Cantidad sugerida = reposición hasta 2 × el mínimo (campo sugerido_reorden).</p></div>
            <Boton variante="primario" onClick={() => ir('/compras')}>Registrar compra</Boton>
          </div>
          <div className="tabla-mini t-compras">
            <table>
              <thead><tr><th>SKU</th><th>Producto</th><th className="derecha">Stock físico</th><th className="derecha">Mínimo</th><th className="derecha">Cantidad sugerida</th><th>Estado</th></tr></thead>
              <tbody>
                {alertas.items.map((a) => {
                  const [tono, texto] = NIVEL[a.nivel];
                  return (
                    <tr key={a.sku}>
                      <td className="dato">{a.sku}</td>
                      <td>{a.producto}</td>
                      <td className={`dato derecha ${a.nivel === 'QUIEBRE_INMINENTE' ? 'texto-mal' : 'texto-aviso'}`}>{num(a.stock_fisico)} un.</td>
                      <td className="dato derecha">{num(a.stock_minimo)} un.</td>
                      <td className="dato derecha negrita">+{num(a.sugerido_reorden)} un.</td>
                      <td><Badge tono={tono}>{texto}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="panel-pie">Al registrar la compra, el banner se actualiza con el nuevo stock.</p>
        </div>
      )}
    </section>
  );
}

// Aviso dentro de un gráfico cuando no hay datos del período (estado vacío del diseño).
const Vacio = ({ titulo, texto, children }) => <div className="g-vacio" role="status"><span className="g-vacio-icono"><IconoBarras /></span><strong>{titulo}</strong><p>{texto}</p>{children}</div>;

const fechaLarga = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });

function Esqueleto() {
  return (
    <div className="reportes" aria-busy="true">
      <div className="graficos-fila uno">
        <div className="tarjeta"><div className="tarjeta-cab"><h2>Ventas por canal</h2></div><div className="sk sk-linea" /><div className="sk-barras">{[55, 70, 62, 85, 40].map((h) => <span key={h} className="sk" style={{ height: `${h}%` }} />)}</div></div>
        <div className="tarjeta"><div className="tarjeta-cab"><h2>Margen por canal</h2></div><div className="sk sk-linea" /><div className="sk-lineas"><span className="sk" /><span className="sk" /><span className="sk" /></div></div>
      </div>
      <div className="graficos-fila dos">
        <div className="tarjeta"><div className="tarjeta-cab"><h2>Rotación de productos</h2></div>{[88, 70, 62, 52, 40, 30, 22].map((w) => <div className="sk-fila" key={w}><span className="sk sk-et" /><span className="sk" style={{ width: `${w}%` }} /></div>)}</div>
        <div className="tarjeta"><div className="tarjeta-cab"><h2>Inventario inmovilizado</h2></div><div className="sk sk-resumen" />{[0, 1, 2, 3, 4].map((i) => <div className="sk sk-celda" key={i} />)}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [k, setK] = useState(null);
  const [top, setTop] = useState(null);
  const [alertas, setAlertas] = useState(null);
  const [rep, setRep] = useState(null);
  const [periodo, setPeriodo] = useState('mes');
  const [error, setError] = useState('');
  const [errorExp, setErrorExp] = useState('');
  const [momento, setMomento] = useState(0);
  const [fallo, setFallo] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const periodoRef = useRef(periodo);
  periodoRef.current = periodo;

  const cargar = useCallback(async () => {
    const p = periodoRef.current;
    try {
      const [a, b, c, g] = await Promise.all([api('/dashboard/kpis'), api('/dashboard/top-productos'), api('/dashboard/alertas'), api(`/dashboard/graficos?periodo=${p}`)]);
      if (p !== periodoRef.current) return; // se cambió de período mientras llegaba la respuesta
      setK(a.data); setTop(b.data); setAlertas(c.data); setRep(g.data);
      setMomento(Date.now()); setFallo(false); setError('');
    } catch (e) { setError(mensajeError(e)); setFallo(true); setTop((t) => t ?? []); }
  }, []);

  // Carga inicial, al cambiar de período y refresco automático cada 30 s.
  useEffect(() => { setRep(null); cargar(); }, [periodo, cargar]);
  useEffect(() => { const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);

  const sinVentas = rep && rep.totales.ventas === 0;
  const parcial = rep?.serie.find((s) => s.parcial);
  const diasParcial = parcial ? Number(rep.hasta.slice(8)) - parseInt(parcial.detalle, 10) + 1 : 0; // días transcurridos de la última semana
  const rotulo = rep?.etiqueta.split(' · ')[0] ?? '';
  const inmo = rep?.inmovilizado ?? [];
  const conValor = inmo.some((i) => i.valor !== undefined);
  const filasInmo = verTodos ? inmo : inmo.slice(0, 5);
  const ver = (p) => <Boton onClick={() => setPeriodo(p)}>{p === 'mes' ? 'Ver mes completo' : 'Ver año completo'}</Boton>;

  return (
    <div className="vista dashboard">
      <div className="cabecera">
        <div>
          <h1>Dashboard General y Métricas</h1>
          <p>Supervisión integral de existencias, valorización contable y ventas del día.</p>
        </div>
        <Actualizado momento={momento} cargando={!rep} fallo={fallo} />
        <MenuExportar periodo={periodo} rotulo={rotulo} deshabilitado={!rep} onError={setErrorExp} />
      </div>
      <Alerta>{error || errorExp}</Alerta>
      {alertas && <BannerQuiebres alertas={alertas} />}
      {k ? (
        <div className="kpis">
          <div className="kpi"><span className="kpi-et">Valorización inventario</span><strong className="kpi-valor dato">{clp(k.valorizacion_inventario)}</strong><span className="kpi-pie ok">{num(k.skus_activos)} SKUs activos</span></div>
          <div className="kpi"><span className="kpi-et">Stock crítico</span><strong className="kpi-num mal">{num(k.stock_critico)}<small>{k.stock_critico === 1 ? 'artículo' : 'artículos'}</small></strong><span className="kpi-pie mal">Requiere reorden</span></div>
          <div className="kpi"><span className="kpi-et">Ventas del día</span><strong className="kpi-num">{num(k.ventas_dia)}<small>{k.ventas_dia === 1 ? 'orden' : 'órdenes'}</small></strong><span className="kpi-pie">Multicanal (Mkt + Web)</span></div>
          <div className="kpi"><span className="kpi-et">Margen promedio</span><strong className="kpi-valor dato">{k.margen_promedio == null ? '—' : `${dec(k.margen_promedio)} %`}</strong><span className="kpi-pie ok">Utilidad bruta estimada</span></div>
        </div>
      ) : !error && (
        <div className="kpis" aria-busy="true">{[0, 1, 2, 3].map((i) => <div className="kpi" key={i}><span className="sk sk-et" /><span className="sk sk-kpi" /><span className="sk sk-pie" /></div>)}</div>
      )}

      <div className="selector-periodo">
        <span className="rotulo">Período</span>
        <div className="segmentado" role="radiogroup" aria-label="Período del reporte">
          {PERIODOS.map(([v, t]) => <button type="button" key={v} role="radio" aria-checked={periodo === v} className={periodo === v ? 'activo' : ''} onClick={() => setPeriodo(v)}>{t}</button>)}
        </div>
        <span className="periodo-texto">{rep ? `${rep.etiqueta}${sinVentas ? ' · sin ventas registradas' : ''}` : ''}</span>
        <span className="periodo-ayuda">Semana → por día · Mes → por semana · Año → por mes</span>
      </div>

      {!rep ? <Esqueleto /> : (
        <div className="reportes">
          <div className="graficos-fila uno">
            <section className="tarjeta" aria-label="Ventas por canal">
              <div className="tarjeta-cab">
                <div><h2>Ventas por canal</h2><p>Ventas netas por {POR[periodo]} · CLP millones</p></div>
                <div className="total"><span>{TOTAL_DE[periodo]}</span><strong>${millones(rep.totales.ventas)} M</strong></div>
              </div>
              <ul className="leyenda">{CANALES.map(([c, n]) => <li key={c}><Muestra canal={c} />{n}</li>)}</ul>
              <div className="grafico-caja">
                <BarrasApiladas serie={rep.serie} vacio={sinVentas} />
                {sinVentas && <Vacio titulo="Sin ventas en este período" texto={`No hay pedidos entre el ${fechaLarga(rep.desde)} y el ${fechaLarga(rep.hasta)} de ${rep.hasta.slice(0, 4)}. Prueba con otro período o revisa que la carga de pedidos esté al día.`}>{periodo !== 'anio' && ver(periodo === 'semana' ? 'mes' : 'anio')}</Vacio>}
              </div>
              <p className="nota">{parcial ? `* ${periodo === 'anio' ? 'Mes en curso' : 'Semana'} parcial${periodo === 'mes' ? ` (${diasParcial} ${diasParcial === 1 ? 'día' : 'días'})` : ''}. ` : ''}Eje Y: CLP millones.</p>
            </section>
            <section className="tarjeta" aria-label="Margen por canal">
              <div className="tarjeta-cab"><div><h2>Margen por canal</h2><p>Margen bruto % por {POR[periodo]}</p></div></div>
              <ul className="leyenda">{CANALES.map(([c, n]) => <li key={c}><Muestra canal={c} linea />{n}</li>)}</ul>
              <div className="grafico-caja">
                <LineasMargen serie={rep.serie} periodo={periodo} vacio={sinVentas} />
                {sinVentas && <Vacio titulo="Sin margen que calcular" texto="El margen aparece cuando hay ventas en el período." />}
              </div>
              <p className="nota">{periodo === 'mes' && parcial ? '* Semana parcial. ' : ''}Eje Y: margen bruto %.</p>
            </section>
          </div>

          <div className="graficos-fila dos">
            <section className="tarjeta" aria-label="Rotación de productos">
              <div className="tarjeta-cab"><div><h2>Rotación de productos</h2><p>Unidades vendidas ÷ stock · ranking de alta rotación</p></div></div>
              <div className="grafico-caja">
                <RankingRotacion items={rep.rotacion} umbral={rep.umbral_rotacion} />
                {!rep.rotacion.length && <Vacio titulo="Sin rotación" texto="Sin ventas no hay rotación que calcular." />}
              </div>
            </section>
            <section className="tarjeta" aria-label="Inventario inmovilizado">
              <div className="tarjeta-cab"><div><h2>Inventario inmovilizado</h2><p>Productos sin movimiento hace más de 60 días</p></div></div>
              {inmo.length > 0 && (
                <div className="resumen-inmo">
                  <div><span className="rotulo">{conValor ? 'Valor inmovilizado total' : 'SKUs inmovilizados'}</span>{conValor && <strong className="dato">{clp(rep.inmovilizado_resumen.valor)}</strong>}</div>
                  <div className="derecha"><strong className="dato">{num(rep.inmovilizado_resumen.skus)} SKUs</strong>{rep.inmovilizado_resumen.pct_valorizacion != null && <span>{dec(rep.inmovilizado_resumen.pct_valorizacion)} % de la valorización</span>}</div>
                </div>
              )}
              <div className="grafico-caja">
                <div className="tabla-mini t-inmo">
                  <table>
                    <thead><tr><th>SKU</th><th>Producto</th><th className="derecha">Stock</th>{conValor && <th className="derecha">Valor</th>}<th>Días sin mov.</th></tr></thead>
                    <tbody>
                      {filasInmo.map((i) => (
                        <tr key={i.sku}>
                          <td className="dato">{i.sku}</td><td>{i.producto}</td><td className="dato derecha">{num(i.stock_fisico)}</td>
                          {conValor && <td className="dato derecha">{clp(i.valor)}</td>}
                          <td>{i.dias_sin_movimiento == null ? <Badge tono="aviso">Sin registro</Badge> : <Badge tono={i.dias_sin_movimiento >= 180 ? 'mal' : 'aviso'}>{num(i.dias_sin_movimiento)} días</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!inmo.length && <div className="espacio-vacio" />}
                </div>
                {!inmo.length && (sinVentas
                  ? <Vacio titulo="Aún no se puede medir" texto="Sin movimientos en el período no hay días sin movimiento que calcular. Se actualiza apenas haya ventas o compras." />
                  : <Vacio titulo="Sin inventario inmovilizado" texto="Ningún producto lleva más de 60 días sin movimiento." />)}
              </div>
              {inmo.length > 0 && (
                <div className="pie-inmo">
                  <span>{verTodos || inmo.length <= 5 ? `Mostrando los ${inmo.length} SKUs` : `Mostrando 5 de ${inmo.length} SKUs`} · orden por valor inmovilizado</span>
                  {inmo.length > 5 && <button type="button" className="enlace-accion" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Ver solo los 5 primeros' : `Ver los ${inmo.length} SKUs`}</button>}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      <h2 className="subtitulo">Productos más vendidos y estado de reposición</h2>
      <Tabla
        columnas={['SKU', 'Producto', 'Marca', { t: 'Ventas (mes)', d: 1 }, { t: 'Stock actual', d: 1 }, { t: 'Mínimo', d: 1 }, 'Estado']}
        vacio={!top ? 'Cargando…' : !top.length && !error ? 'Aún no hay ventas registradas este mes.' : null}
      >
        {top?.map((p) => {
          const [tono, texto] = NIVEL[p.estado];
          return (
            <tr key={p.sku}>
              <td className="dato">{p.sku}</td>
              <td>{p.producto}</td>
              <td>{p.marca}</td>
              <td className="dato derecha">{num(p.ventas_mes)} un.</td>
              <td className={`dato derecha ${p.estado === 'QUIEBRE_INMINENTE' ? 'texto-mal' : p.estado === 'BAJO_MINIMO' ? 'texto-aviso' : ''}`}>{num(p.stock_actual)} un.</td>
              <td className="dato derecha tenue">{num(p.stock_minimo)} un.</td>
              <td><Badge tono={tono}>{texto}</Badge></td>
            </tr>
          );
        })}
      </Tabla>
    </div>
  );
}
