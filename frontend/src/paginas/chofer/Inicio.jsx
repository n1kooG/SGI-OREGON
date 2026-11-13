import { Link } from 'react-router-dom';
import { Alerta } from '../../componentes/ui.jsx';
import { useSesion } from '../../sesion.jsx';
import { Ico } from './iconos.jsx';
import { direccion, fechaLarga, hora, mapaUrl, telUrl, unidades, useRuta } from './datos.js';
import { Futuras, NotaAdmin, Orden, Reprogramada } from './comunes.jsx';

export default function Inicio() {
  const { usuario } = useSesion();
  const { paradas, futuras, resumen, error, actualizada, cargando, cargar } = useRuta();
  const nombre = usuario.nombre.split(' ')[0];
  const saludo = <div className="ch-saludo"><h1>Buen día, {nombre}</h1><p>{fechaLarga(new Date())}</p></div>;

  if (!paradas) return <div className="ch-cont">{saludo}<p className="ch-vacio-txt">Cargando…</p></div>;
  const { entregadas, rechazadas, pendientes } = resumen ?? { entregadas: 0, rechazadas: 0, pendientes: 0 };
  const total = entregadas + rechazadas + pendientes;
  const cerradas = entregadas + rechazadas;
  const siguiente = paradas.findIndex((d) => d.estado_entrega === 'PENDIENTE');
  const proxima = paradas[siguiente];
  const restantes = paradas.slice(siguiente + 1).filter((d) => d.estado_entrega === 'PENDIENTE');
  const completa = total > 0 && pendientes === 0;

  if (!total) {
    return (
      <div className="ch-cont">
        {saludo}
        <Alerta>{error}</Alerta>
        <section className="ch-vacio">
          <span className="ch-medalla"><Ico n="bandeja" t={40} /></span>
          <h2>Hoy no tienes entregas asignadas</h2>
          <p>Cuando Jefatura te asigne una hoja de ruta, aparecerá aquí.</p>
          <button type="button" className="ch-btn" onClick={cargar} disabled={cargando}><Ico n="actualizar" />Actualizar</button>
        </section>
        <Futuras lista={futuras} />
        {actualizada && <p className="ch-revision">Última revisión: {hora(actualizada)}</p>}
      </div>
    );
  }

  return (
    <div className="ch-cont ch-inicio">
      {saludo}
      <Alerta>{error}</Alerta>
      <div className="ch-resumen">
        <section className={`ch-avance ${completa ? 'completa' : ''}`}>
          <span className="ch-rotulo solo-ancho">Avance de la jornada</span>
          <div className="ch-cifra"><strong>{cerradas}</strong><span>de {total} {total === 1 ? 'parada' : 'paradas'}</span></div>
          <div className="ch-barra" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={cerradas} aria-label="Avance de la jornada"><i style={{ width: `${(cerradas / total) * 100}%` }} /></div>
        </section>
        <div className="ch-contadores">
          <div className="ok"><strong>{entregadas}</strong><span>Entregadas</span></div>
          <div className="mal"><strong>{rechazadas}</strong><span>Rechazadas</span></div>
          <div className="neutro"><strong>{pendientes}</strong><span>Pendientes</span></div>
        </div>
      </div>
      {completa ? (
        <div className="ch-cierre-jornada">
          <section className="ch-completada">
            <span className="ch-check"><Ico n="ok-circulo" t={30} /></span>
            <div>
              <h2>Jornada completada</h2>
              <p>Cerraste {total === 1 ? 'la parada' : `las ${total} paradas`} de hoy.{rechazadas > 0 && ` ${rechazadas === 1 ? 'El pedido rechazado vuelve' : `Los ${rechazadas} pedidos rechazados vuelven`} a Bodega.`}</p>
            </div>
          </section>
          <div className="ch-pie-pagina">
            <Link className="ch-btn pri" to="/chofer/historial"><Ico n="reloj" />Ver historial</Link>
            <Link className="ch-btn" to="/chofer/ruta"><Ico n="ruta" />Ver ruta</Link>
          </div>
        </div>
      ) : (
        <div className="ch-cuerpo-inicio">
          <section className="ch-proxima">
            <div className="ch-fila"><span className="ch-etiquetas"><span className="ch-badge acento"><i />Próxima parada</span>{proxima.reprogramada && <Reprogramada fecha={proxima.fecha_programada} />}</span><span className="ch-parada-n">Parada {siguiente + 1} de {paradas.length}</span></div>
            <h2>{proxima.nombre_cliente}</h2>
            <div className="ch-orden-fila"><Orden>Orden #{proxima.codigo_externo}</Orden><strong>{unidades(proxima.bultos)}</strong></div>
            <div className="ch-dir"><Ico n="pin" /><div><strong>{direccion(proxima)}</strong>{proxima.comuna && <span>{proxima.comuna}</span>}</div></div>
            {proxima.nota_admin && <NotaAdmin>{proxima.nota_admin}</NotaAdmin>}
            <div className="ch-dos">
              <a className="ch-btn pri" href={mapaUrl(proxima)} target="_blank" rel="noopener noreferrer"><Ico n="navegar" />Abrir mapa</a>
              {telUrl(proxima) ? <a className="ch-btn" href={telUrl(proxima)}><Ico n="tel" />Llamar</a> : <span className="ch-btn" aria-disabled="true"><Ico n="tel" />Sin teléfono</span>}
              <Link className="ch-btn solo-ancho" to={`/chofer/ruta/${proxima.id_despacho}`}><Ico n="der" />Ver detalle</Link>
            </div>
          </section>
          <aside className="ch-siguientes solo-ancho" aria-label="Siguientes paradas">
            <div className="ch-fila"><h2>Siguientes paradas</h2><span className="ch-contador">{restantes.length}</span></div>
            <ol>
              {restantes.slice(0, 4).map((d) => (
                <li key={d.id_despacho}>
                  <Link to={`/chofer/ruta/${d.id_despacho}`}>
                    <span className="ch-num">{paradas.indexOf(d) + 1}</span>
                    <span><strong>{d.nombre_cliente}</strong><small>{d.comuna}{d.comuna && ' '}<em>#{d.codigo_externo}</em></small></span>
                  </Link>
                </li>
              ))}
            </ol>
            <Link className="ch-btn" to="/chofer/ruta"><Ico n="mapa" />Ver ruta completa</Link>
          </aside>
          <Link className="ch-btn solo-movil" to="/chofer/ruta"><Ico n="mapa" />Ver ruta completa</Link>
        </div>
      )}
    </div>
  );
}
