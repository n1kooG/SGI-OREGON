import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alerta, useAviso } from '../../componentes/ui.jsx';
import { Ico } from './iconos.jsx';
import { diaMes, direccion, hora, mapaUrl, telUrl, unidades, useAncho, useCausales, useDetalle, useRuta } from './datos.js';
import { Estado, NotaAdmin, Orden, Reprogramada, TONO } from './comunes.jsx';
import Detalle from './Detalle.jsx';
import Entrega from './Entrega.jsx';
import Rechazo from './Rechazo.jsx';

const cerrada = (d) => d.estado_entrega !== 'PENDIENTE';
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const resumenRuta = (paradas) => `${plural(paradas.length, 'parada', 'paradas')} · ${plural(paradas.filter(cerrada).length, 'cerrada', 'cerradas')} · ${plural(paradas.filter((d) => !cerrada(d)).length, 'pendiente', 'pendientes')}`;
const GENERO_F = { ENTREGADO: 'Entregada', RECHAZADO: 'Rechazada' };

// Una sola ruta para lista, detalle, entrega y rechazo: así, en pantallas anchas, abrir y cerrar un diálogo no recarga la lista.
export default function Ruta() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const ancho = useAncho();
  if (ancho) return <RutaAncha />;
  if (!id) return <RutaMovil />;
  if (pathname.endsWith('/entrega')) return <Entrega />;
  if (pathname.endsWith('/rechazo')) return <Rechazo />;
  return <Detalle />;
}

function Encabezado({ paradas, cargando, cargar, ancho }) {
  return (
    <div className="ch-encabezado">
      <div className="ch-titulo">
        <h1>Ruta de hoy</h1>
        {paradas && <p>{resumenRuta(paradas)}</p>}
      </div>
      {ancho
        ? <button type="button" className="ch-btn sm" onClick={cargar} disabled={cargando}><Ico n="actualizar" />Actualizar</button>
        : <button type="button" className="ch-cuadro" aria-label="Actualizar ruta" onClick={cargar} disabled={cargando}><Ico n="actualizar" t={24} /></button>}
    </div>
  );
}

function RutaMovil() {
  const { paradas, futuras, error, cargando, cargar } = useRuta();
  const causal = useCausales(paradas);
  const cerradas = paradas?.filter(cerrada) ?? [];
  const pendientes = paradas?.filter((d) => !cerrada(d)) ?? [];
  const primera = pendientes[0];

  return (
    <div className="ch-cont ch-ruta">
      <Encabezado paradas={paradas} cargando={cargando} cargar={cargar} />
      <Alerta>{error}</Alerta>
      {!paradas && <p className="ch-vacio-txt">Cargando…</p>}
      {paradas && !paradas.length && !futuras.length && !error && <p className="ch-vacio-txt">No tienes entregas asignadas.</p>}
      {cerradas.length > 0 && <h2 className="ch-seccion">Cerradas · {cerradas.length}</h2>}
      {cerradas.map((d, i) => {
        const [tono, texto] = TONO[d.estado_entrega];
        const detalle = d.estado_entrega === 'RECHAZADO' ? causal(d) : null;
        return (
          <article className="ch-tarjeta" key={d.id_despacho}>
            <div className="ch-fila"><Orden>Parada {i + 1} · Orden #{d.codigo_externo}</Orden><Estado tono={tono}>{texto}</Estado></div>
            <h3>{d.nombre_cliente}</h3>
            <p className="ch-sec">{[direccion(d), d.comuna].filter(Boolean).join(' · ')}</p>
            <p className={`ch-cierre ${tono}`}><Ico n="reloj" t={16} />Cerrada a las {hora(d.fecha_cierre)}{detalle && ` · Causal: ${detalle}`}</p>
          </article>
        );
      })}
      {pendientes.length > 0 && <h2 className="ch-seccion">Pendientes · {pendientes.length}</h2>}
      {pendientes.map((d, i) => (
        <article className={`ch-tarjeta pendiente ${d === primera ? 'siguiente' : ''}`} key={d.id_despacho}>
          <div className="ch-fila">
            <Orden>Parada {cerradas.length + i + 1} · Orden #{d.codigo_externo}</Orden>
            {d.reprogramada ? <Reprogramada fecha={d.fecha_programada} /> : d === primera ? <span className="ch-badge acento"><i />Siguiente</span> : <Estado tono="aviso">Pendiente</Estado>}
          </div>
          <Link className="ch-cliente" to={`/chofer/ruta/${d.id_despacho}`}><h3>{d.nombre_cliente}</h3><Ico n="der" /></Link>
          <div className="ch-dir peq"><Ico n="pin" t={20} /><div><strong>{direccion(d)}</strong><span>{[d.comuna, unidades(d.bultos)].filter(Boolean).join(' · ')}</span></div></div>
          {d.nota_admin && <NotaAdmin>{d.nota_admin}</NotaAdmin>}
          <div className="ch-dos">
            {telUrl(d) ? <a className="ch-btn sm" href={telUrl(d)}><Ico n="tel" />Llamar</a> : <span className="ch-btn sm" aria-disabled="true"><Ico n="tel" />Sin teléfono</span>}
            <a className="ch-btn sm" href={mapaUrl(d)} target="_blank" rel="noopener noreferrer"><Ico n="navegar" />Abrir mapa</a>
          </div>
        </article>
      ))}
      {futuras.length > 0 && <h2 className="ch-seccion">Próximos días · {futuras.length}</h2>}
      {futuras.map((d) => (
        <article className="ch-tarjeta futura" key={d.id_despacho}>
          <div className="ch-fila"><h3>{d.nombre_cliente}</h3><Reprogramada fecha={d.fecha_programada} /></div>
          <p className="ch-sec">{[direccion(d), d.comuna].filter(Boolean).join(' · ')}</p>
          {d.nota_admin && <p className="ch-nota-linea"><Ico n="nota" t={16} />Nota: {d.nota_admin}</p>}
          <p className="ch-candado"><Ico n="candado" t={16} />Se habilita el {diaMes(d.fecha_programada)} · sin acciones hoy</p>
        </article>
      ))}
    </div>
  );
}

// Escritorio e iPad horizontal: lista agrupada a la izquierda y la parada elegida a la derecha.
function RutaAncha() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const irA = useNavigate();
  const aviso = useAviso();
  const ruta = useRuta();
  const { paradas, futuras, error, cargando, cargar } = ruta;
  const causal = useCausales(paradas);
  const [abiertas, setAbiertas] = useState(false); // en iPad las cerradas se pliegan; en escritorio siempre se ven
  const dialogo = pathname.endsWith('/entrega') ? 'entrega' : pathname.endsWith('/rechazo') ? 'rechazo' : null;
  const alTerminar = (msg) => { if (msg) aviso(msg); cargar(); irA('/chofer/ruta', { replace: true }); };

  const cerradas = paradas?.filter(cerrada) ?? [];
  const pendientes = paradas?.filter((d) => !cerrada(d)) ?? [];
  const sel = pendientes.find((d) => String(d.id_despacho) === id) ?? pendientes[0];
  const entregadas = cerradas.filter((d) => d.estado_entrega === 'ENTREGADO').length;
  const rechazadas = cerradas.length - entregadas;

  return (
    <div className="ch-cont ch-ruta-ancha">
      <Encabezado paradas={paradas} cargando={cargando} cargar={cargar} ancho />
      <Alerta>{error}</Alerta>
      {!paradas && <p className="ch-vacio-txt">Cargando…</p>}
      {paradas && (
        <div className="ch-maestro">
          <section className="ch-lista" aria-label="Paradas de hoy">
            {cerradas.length > 0 && (
              <>
                <button type="button" className="ch-grupo" aria-expanded={abiertas} onClick={() => setAbiertas(!abiertas)}>
                  <span>Cerradas · {cerradas.length}</span>
                  <span className="ch-chips">{entregadas > 0 && <b className="ok">{plural(entregadas, 'entregada', 'entregadas')}</b>}{rechazadas > 0 && <b className="mal">{plural(rechazadas, 'rechazada', 'rechazadas')}</b>}</span>
                  <Ico n="abajo" t={16} />
                </button>
                <ul className={`ch-cerradas ${abiertas ? 'abierto' : ''}`}>
                  {cerradas.map((d) => {
                    const [tono] = TONO[d.estado_entrega];
                    const detalle = d.estado_entrega === 'ENTREGADO' ? d.nombre_receptor && `Recibe: ${d.nombre_receptor}` : causal(d);
                    return (
                      <li key={d.id_despacho} className="ch-fila-cerrada">
                        <span className={`ch-ic ${tono}`}><Ico n={tono === 'ok' ? 'ok' : 'x'} t={14} /></span>
                        <span><strong>{d.nombre_cliente}</strong><small><b>{hora(d.fecha_cierre)}</b> {detalle}</small></span>
                        <Estado tono={tono}>{GENERO_F[d.estado_entrega]}</Estado>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {pendientes.length > 0 && <h2 className="ch-grupo">Pendientes · {pendientes.length}</h2>}
            <ul>
              {pendientes.map((d, i) => (
                <li key={d.id_despacho}>
                  <Link to={`/chofer/ruta/${d.id_despacho}`} className={`ch-fila-pendiente ${d === sel ? 'sel' : ''}`} aria-current={d === sel ? 'true' : undefined}>
                    <span className="ch-num">{cerradas.length + i + 1}</span>
                    <span><strong>{d.nombre_cliente}</strong><small><span className="ch-calle">{direccion(d)}{d.comuna && ' · '}</span>{d.comuna}</small></span>
                    <em>#{d.codigo_externo}</em>
                  </Link>
                </li>
              ))}
            </ul>
            {futuras.length > 0 && <h2 className="ch-grupo">Próximos días · {futuras.length}</h2>}
            {futuras.map((d) => (
              <article className="ch-fila-futura" key={d.id_despacho}>
                <div className="ch-fila"><strong>{d.nombre_cliente}</strong><Reprogramada fecha={d.fecha_programada} /></div>
                <p>{[direccion(d), d.comuna].filter(Boolean).join(' · ')}</p>
                {d.nota_admin && <p className="ch-nota-linea"><Ico n="nota" t={14} />Nota: {d.nota_admin}</p>}
              </article>
            ))}
          </section>
          <section className="ch-panel" aria-label="Parada seleccionada">
            {sel ? <PanelParada sel={sel} n={paradas.indexOf(sel) + 1} total={paradas.length} /> : <p className="ch-vacio-txt">{paradas.length ? 'Cerraste todas las paradas de hoy.' : 'No tienes entregas asignadas hoy.'}</p>}
          </section>
        </div>
      )}
      {dialogo === 'entrega' && <Entrega ruta={ruta} alTerminar={alTerminar} />}
      {dialogo === 'rechazo' && <Rechazo ruta={ruta} alTerminar={alTerminar} />}
    </div>
  );
}

function PanelParada({ sel, n, total }) {
  const { parada: d, error } = useDetalle(sel.id_despacho);
  const tel = telUrl(sel);
  return (
    <>
      <div className="ch-panel-cab">
        <span className="ch-parada-n">Parada {n} de {total}</span>
        <Estado tono="info">Pendiente</Estado>
        {sel.reprogramada && <Reprogramada fecha={sel.fecha_programada} />}
      </div>
      <h2>{sel.nombre_cliente}</h2>
      <Alerta>{error}</Alerta>
      <div className="ch-caja">
        <span className="ch-rotulo">Dirección</span>
        <div className="ch-dir-linea"><Ico n="pin" t={18} /><strong>{direccion(sel)}</strong>{sel.comuna && <span>· {sel.comuna}</span>}</div>
      </div>
      <div className="ch-caja fila-tel">
        <div><span className="ch-rotulo">Teléfono</span><strong className="ch-mono">{sel.telefono_contacto || 'Sin teléfono'}</strong></div>
        {tel ? <a className="ch-btn sm" href={tel}><Ico n="tel" />Llamar</a> : <span className="ch-btn sm" aria-disabled="true"><Ico n="tel" />Llamar</span>}
      </div>
      <div className="ch-dos">
        <div className="ch-caja"><span className="ch-rotulo">N° de orden</span><strong className="ch-mono">#{sel.codigo_externo}</strong></div>
        <div className="ch-caja"><span className="ch-rotulo">Documento</span><strong className="ch-mono">{d?.numero_documento_sii ? `Boleta N° ${d.numero_documento_sii}` : '—'}</strong></div>
      </div>
      <div className="ch-productos-ancho">
        <span className="ch-rotulo">Productos · {unidades(sel.bultos)}</span>
        {!d && !error && <p className="ch-vacio-txt">Cargando…</p>}
        {d?.items.map((p) => (
          <div key={p.sku}><span>{p.nombre}</span><em>{p.sku}</em><strong>× {p.cantidad}</strong></div>
        ))}
      </div>
      {sel.nota_admin && <NotaAdmin>{sel.nota_admin}</NotaAdmin>}
      <div className="ch-dos ch-acciones-panel">
        <Link className="ch-btn pri" to={`/chofer/ruta/${sel.id_despacho}/entrega`}><Ico n="ok" />Entregado</Link>
        <Link className="ch-btn contorno-pel" to={`/chofer/ruta/${sel.id_despacho}/rechazo`}><Ico n="x" />Rechazado</Link>
        <a className="ch-btn" href={mapaUrl(sel)} target="_blank" rel="noopener noreferrer"><Ico n="navegar" />Abrir mapa</a>
      </div>
    </>
  );
}
