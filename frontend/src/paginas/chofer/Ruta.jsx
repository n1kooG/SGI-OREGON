import { Link, useParams, useLocation } from 'react-router-dom';
import { Alerta } from '../../componentes/ui.jsx';
import { Ico } from './iconos.jsx';
import { direccion, hora, mapaUrl, telUrl, unidades, useCausales, useRuta } from './datos.js';
import { Estado, Orden, TONO } from './comunes.jsx';
import Detalle from './Detalle.jsx';
import Entrega from './Entrega.jsx';
import Rechazo from './Rechazo.jsx';

// Una sola ruta para lista, detalle, entrega y rechazo: así, en pantallas anchas, abrir y cerrar un diálogo no recarga la lista.
export default function Ruta() {
  const { id } = useParams();
  const { pathname } = useLocation();
  if (!id) return <RutaMovil />;
  if (pathname.endsWith('/entrega')) return <Entrega />;
  if (pathname.endsWith('/rechazo')) return <Rechazo />;
  return <Detalle />;
}

function RutaMovil() {
  const { paradas, error, actualizada, cargando, cargar } = useRuta();
  const causal = useCausales(paradas);
  const cerradas = paradas?.filter((d) => d.estado_entrega !== 'PENDIENTE') ?? [];
  const pendientes = paradas?.filter((d) => d.estado_entrega === 'PENDIENTE') ?? [];
  const primera = pendientes[0];

  return (
    <div className="ch-cont ch-ruta">
      <div className="ch-encabezado">
        <div className="ch-titulo">
          <h1>Ruta de hoy</h1>
          {paradas && <p>{cerradas.length} de {paradas.length} cerradas{actualizada && ` · Act. ${hora(actualizada)}`}</p>}
        </div>
        <button type="button" className="ch-cuadro" aria-label="Actualizar ruta" onClick={cargar} disabled={cargando}><Ico n="actualizar" t={24} /></button>
      </div>
      <Alerta>{error}</Alerta>
      {!paradas && <p className="ch-vacio-txt">Cargando…</p>}
      {paradas && !paradas.length && !error && <p className="ch-vacio-txt">No tienes entregas asignadas.</p>}
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
          <div className="ch-fila"><Orden>Parada {cerradas.length + i + 1} · Orden #{d.codigo_externo}</Orden>{d === primera ? <span className="ch-badge acento"><i />Siguiente</span> : <Estado tono="aviso">Pendiente</Estado>}</div>
          <Link className="ch-cliente" to={`/chofer/ruta/${d.id_despacho}`}><h3>{d.nombre_cliente}</h3><Ico n="der" /></Link>
          <div className="ch-dir peq"><Ico n="pin" t={20} /><div><strong>{direccion(d)}</strong><span>{[d.comuna, unidades(d.bultos)].filter(Boolean).join(' · ')}</span></div></div>
          <div className="ch-dos">
            {telUrl(d) ? <a className="ch-btn sm" href={telUrl(d)}><Ico n="tel" />Llamar</a> : <span className="ch-btn sm" aria-disabled="true"><Ico n="tel" />Sin teléfono</span>}
            <a className="ch-btn sm" href={mapaUrl(d)} target="_blank" rel="noopener noreferrer"><Ico n="navegar" />Abrir mapa</a>
          </div>
        </article>
      ))}
    </div>
  );
}
