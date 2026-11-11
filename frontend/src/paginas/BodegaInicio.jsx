import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, mensajeError } from '../api.js';
import { Alerta, Boton, Icono } from '../componentes/ui.jsx';
import { useSesion } from '../sesion.jsx';

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

export default function BodegaInicio() {
  const { usuario } = useSesion();
  const ir = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      const [p, i, c] = await Promise.all([api('/pedidos/resumen'), api('/inventario/resumen'), api('/compras/descargas/pendientes')]);
      setD({ ...p.data, ...i.data, descargas: c.data.length });
    } catch (e) { setError(mensajeError(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porPreparar = d ? d.pendiente_preparacion + d.armado : 0;
  const alDia = d && [porPreparar, d.descargas, d.en_camion_esperando_chofer, d.rechazados_por_reingresar, d.sin_ubicacion, d.stock_critico].every((n) => n === 0);
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
