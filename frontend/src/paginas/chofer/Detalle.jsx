import { Link, Navigate, useParams } from 'react-router-dom';
import { Alerta } from '../../componentes/ui.jsx';
import { Ico } from './iconos.jsx';
import { direccion, mapaUrl, telUrl, unidades, useParada } from './datos.js';
import { BarraAcciones, Estado, NotaAdmin, Reprogramada, TONO, Volver } from './comunes.jsx';

export default function Detalle() {
  const { id } = useParams();
  const { parada: d, error, n, total } = useParada(id);
  if (error) return <div className="ch-cont"><Alerta>{error}</Alerta><Link className="ch-btn" to="/chofer/ruta">Volver a la ruta</Link></div>;
  if (!d) return <div className="ch-cont"><p className="ch-vacio-txt">Cargando…</p></div>;
  if (d.estado_entrega !== 'PENDIENTE') return <Navigate to="/chofer/ruta" replace />;
  const [tono, texto] = TONO.PENDIENTE;
  const tel = telUrl(d);

  return (
    <>
      <Volver a="/chofer/ruta">{n ? `Parada ${n} de ${total}` : 'Volver a la ruta'}</Volver>
      <div className="ch-cont ch-detalle">
        <div className="ch-cliente-det"><span className="ch-etiquetas"><Estado tono={tono}>{texto}</Estado>{d.reprogramada && <Reprogramada fecha={d.fecha_programada} />}</span><h1>{d.nombre_cliente}</h1></div>
        <section className="ch-docs">
          <div><span className="ch-rotulo">N° de orden</span><strong>#{d.codigo_externo}</strong></div>
          <div><span className="ch-rotulo">Boleta</span><strong>{d.numero_documento_sii ? `N° ${d.numero_documento_sii}` : '—'}</strong></div>
        </section>
        <section className="ch-bloque">
          <div className="ch-dir grande"><Ico n="pin" t={26} /><div><strong>{direccion(d)}</strong>{d.comuna && <span>{d.comuna}</span>}</div></div>
          <a className="ch-btn" href={mapaUrl(d)} target="_blank" rel="noopener noreferrer"><Ico n="navegar" />Abrir mapa</a>
        </section>
        {d.nota_admin && <NotaAdmin>{d.nota_admin}</NotaAdmin>}
        <section className="ch-bloque fila-tel">
          <div><span className="ch-rotulo">Teléfono</span><strong className="ch-mono">{d.telefono_contacto || 'Sin teléfono'}</strong></div>
          {tel ? <a className="ch-btn sm" href={tel}><Ico n="tel" />Llamar</a> : <span className="ch-btn sm" aria-disabled="true"><Ico n="tel" />Llamar</span>}
        </section>
        <section className="ch-productos">
          <div className="ch-prod-cab"><h2>Productos</h2><span>{unidades(d.bultos)}</span></div>
          {d.items.map((p) => (
            <div className="ch-prod" key={p.sku}>
              <div><span className="ch-sku">{p.sku}</span><p>{p.nombre}</p></div>
              <strong>× {p.cantidad}</strong>
            </div>
          ))}
        </section>
      </div>
      <BarraAcciones>
        <div className="ch-dos">
          <Link className="ch-btn pri" to={`/chofer/ruta/${id}/entrega`}><Ico n="ok" />Entregado</Link>
          <Link className="ch-btn contorno-pel" to={`/chofer/ruta/${id}/rechazo`}><Ico n="x" />Rechazado</Link>
        </div>
      </BarraAcciones>
    </>
  );
}
