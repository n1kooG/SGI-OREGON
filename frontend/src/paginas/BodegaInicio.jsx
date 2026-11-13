import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Icono } from '../componentes/ui.jsx';
import { useSesion } from '../sesion.jsx';
import { useEscritorio } from '../componentes/useEscritorio.js';
import { Antiguedad } from './Descarga.jsx';
import { fechaCorta } from './Pedidos.jsx';

const fechaHoy = () => {
  const t = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (t[0].toUpperCase() + t.slice(1)).replace(',', '');
};

function Tarjeta({ cifra, titulo, detalle, a, tono }) {
  return (
    <Link to={a} className={`tarjeta-trabajo ${tono ?? ''}`}>
      <span className="cifra-trabajo">{cifra}</span>
      <span className="texto-trabajo"><strong>{titulo}</strong><span>{detalle}</span></span>
      <span className="flecha-trabajo"><Icono n="der" /></span>
    </Link>
  );
}

// Escritorio: cada tarjeta lleva su botón de acción; a la derecha, las próximas descargas y los rechazados.
function TarjetaEsc({ cifra, titulo, detalle, a, boton, tono, alDia }) {
  return (
    <article className={`bi-tarjeta ${tono ?? ''}`}>
      <h3>{titulo}</h3>
      <span className="bi-cifra">{cifra}</span>
      <p>{alDia ? 'Nada pendiente' : detalle}</p>
      <Link to={a} className={`btn ${tono === 'peligro' && !alDia ? 'primario' : ''}`}>{boton}</Link>
    </article>
  );
}

function InicioEscritorio({ d, alDia, cargar, usuario }) {
  const porPreparar = d.pendiente_preparacion + d.armado;
  const facturas = d.facturas.slice(0, 3);
  const rechazados = d.rechazados.slice(0, 3);
  return (
    <div className="bi-esc">
      <header className="bd-cab">
        <div><h1>Hola, {usuario.nombre}</h1><span className="tenue">{fechaHoy()}</span></div>
        <Boton icono="refrescar" onClick={cargar}>Actualizar</Boton>
      </header>
      <div className="bi-cols">
        <section className="bi-principal">
          <h2>Trabajo de hoy</h2>
          {alDia && <div className="bi-aldia" role="status"><Icono n="check" /><div><strong>Todo al día</strong><span>No hay descargas, pedidos ni rechazados pendientes. Buen trabajo.</span></div></div>}
          <div className="bi-grilla">
            <TarjetaEsc alDia={alDia} cifra={porPreparar} titulo="Pedidos por preparar" detalle="Órdenes sin recolectar o en armado" a="/bodega/pedidos" boton="Ir a Pedidos" />
            <TarjetaEsc alDia={alDia} cifra={d.descargas} titulo="Descargas pendientes" detalle="Facturas por contar" a="/bodega/descarga" boton="Ir a Descarga" />
            <TarjetaEsc alDia={alDia} cifra={d.en_camion_esperando_chofer} titulo="En camión, esperando chofer" detalle="Etiquetados y cargados" a="/bodega/pedidos" boton="Ver en Pedidos" />
            <TarjetaEsc alDia={alDia} cifra={d.rechazados_por_reingresar} titulo="Rechazados por reingresar" detalle="Requieren atención hoy" a="/bodega/pedidos/rechazados" boton="Ver rechazados" tono={d.rechazados_por_reingresar > 0 ? 'peligro' : ''} />
            <TarjetaEsc alDia={alDia} cifra={d.sin_ubicacion} titulo="Productos sin ubicación" detalle="Asigne pasillo y estante" a="/bodega/buscador" boton="Asignar ubicación" />
            <TarjetaEsc alDia={alDia} cifra={d.stock_critico} titulo="Stock crítico" detalle="Bajo el mínimo de reposición" a="/bodega/buscador" boton="Ver en Buscador" tono={d.stock_critico > 0 ? 'critico' : ''} />
          </div>
        </section>
        <aside className="bi-lateral">
          <section className="bi-panel">
            <div className="fila-sb"><h2>Próximas descargas</h2>{facturas.length > 0 && <Badge tono="ink">{d.facturas.length}</Badge>}</div>
            {!facturas.length && <p className="tenue">Sin facturas por descargar.</p>}
            {facturas.map((f) => (
              <div className="bi-item" key={f.id_recepcion}>
                <div className="fila-sb"><span className="chip-sku">FAC-{f.numero_factura}</span><Antiguedad fecha={f.fecha_recepcion} /></div>
                <strong>{f.nombre_proveedor}</strong>
                <span className="tenue">Recibida {fechaCorta(f.fecha_recepcion)} · {f.detalle.length} {f.detalle.length === 1 ? 'producto' : 'productos'}</span>
              </div>
            ))}
            {facturas.length > 0 && <Link to="/bodega/descarga" className="bi-ver">Ver descargas</Link>}
          </section>
          <section className="bi-panel">
            <div className="fila-sb"><h2>Rechazados</h2>{rechazados.length > 0 && <Badge tono="mal">{d.rechazados.length} {d.rechazados.length === 1 ? 'orden' : 'órdenes'}</Badge>}</div>
            {!rechazados.length && <p className="tenue">Sin rechazados por reingresar.</p>}
            {rechazados.map((p) => (
              <div className="bi-item" key={p.id_orden}>
                <span className="chip-sku">{p.codigo_externo}</span>
                <strong>{p.nombre_cliente}</strong>
                <span className="tenue">{[p.comuna, `${p.unidades} ${p.unidades === 1 ? 'unidad' : 'unidades'}`].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
            {rechazados.length > 0 && <Link to="/bodega/pedidos/rechazados" className="bi-ver">Ver rechazados</Link>}
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function BodegaInicio() {
  const escritorio = useEscritorio();
  const { usuario } = useSesion();
  const ir = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      const [p, i, c, r] = await Promise.all([api('/pedidos/resumen'), api('/inventario/resumen'), api('/compras/descargas/pendientes'), api('/pedidos?por_reingresar=1')]);
      setD({ ...p.data, ...i.data, descargas: c.data.length, facturas: c.data, rechazados: r.data });
    } catch (e) { setError(mensajeError(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porPreparar = d ? d.pendiente_preparacion + d.armado : 0;
  const alDia = d && [porPreparar, d.descargas, d.en_camion_esperando_chofer, d.rechazados_por_reingresar, d.sin_ubicacion, d.stock_critico].every((n) => n === 0);
  if (escritorio) {
    if (!d) return error ? <><Alerta>{error}</Alerta><Boton onClick={cargar}>Reintentar</Boton></> : <p className="tenue">Cargando…</p>;
    return <InicioEscritorio d={d} alDia={alDia} cargar={cargar} usuario={usuario} />;
  }
  return (
    <div className="movil-pagina bodega-inicio">
      <div className="saludo"><h1>Hola, {usuario.nombre}</h1><span className="tenue">{fechaHoy()}</span></div>
      <h2>Trabajo de hoy</h2>
      {error && <><Alerta>{error}</Alerta><Boton onClick={cargar}>Reintentar</Boton></>}
      {!d && !error && <p className="tenue">Cargando…</p>}
      {alDia && (
        <div className="al-dia">
          <span className="sello-ok"><Icono n="check" /></span>
          <h2>Todo al día</h2>
          <p>No hay pedidos por preparar, descargas por contar ni rechazados por reingresar.</p>
          <Boton onClick={() => ir('/bodega/buscador')}>Ir al buscador</Boton>
        </div>
      )}
      {d && !alDia && (
        <>
          <Tarjeta cifra={porPreparar} titulo="Pedidos por preparar" detalle="Órdenes sin recolectar o en armado" a="/bodega/pedidos" />
          <Tarjeta cifra={d.descargas} titulo="Descargas pendientes" detalle="facturas por contar" a="/bodega/descarga" />
          <Tarjeta cifra={d.en_camion_esperando_chofer} titulo="En camión, esperando chofer" detalle="Etiquetados y cargados" a="/bodega/pedidos" />
          <Tarjeta cifra={d.rechazados_por_reingresar} titulo="Rechazados por reingresar" detalle="Requieren atención hoy" a="/bodega/pedidos/rechazados" tono={d.rechazados_por_reingresar > 0 ? 'peligro' : ''} />
          <Tarjeta cifra={d.sin_ubicacion} titulo="Productos sin ubicación" detalle="Asigne pasillo y estante" a="/bodega/buscador" />
          <Tarjeta cifra={d.stock_critico} titulo="Stock crítico" detalle="Bajo el mínimo de reposición" a="/bodega/buscador" tono={d.stock_critico > 0 ? 'critico' : ''} />
        </>
      )}
    </div>
  );
}
