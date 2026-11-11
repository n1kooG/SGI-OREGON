import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import '../oficina.css';
import { Alerta, Badge, Icono, Tabla, clp } from '../componentes/ui.jsx';

const num = (v) => Number(v ?? 0).toLocaleString('es-CL');

export default function Dashboard() {
  const [k, setK] = useState(null);
  const [top, setTop] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/dashboard/kpis'), api('/dashboard/top-productos')])
      .then(([a, b]) => { setK(a.data); setTop(b.data); })
      .catch((e) => { setError(mensajeError(e)); setTop([]); });
  }, []);

  const quiebres = k?.quiebres ?? 0;
  return (
    <div className="vista dashboard">
      <div className="cabecera">
        <div>
          <h1>Dashboard General y Métricas</h1>
          <p>Supervisión integral de existencias, valorización contable y ventas del día.</p>
        </div>
        {quiebres > 0 && <div className="aviso-quiebres" role="status"><Icono n="campana" />{quiebres} {quiebres === 1 ? 'quiebre detectado' : 'quiebres detectados'}</div>}
      </div>
      <Alerta>{error}</Alerta>
      {k && (
        <div className="kpis">
          <div className="kpi"><span className="kpi-et">Valorización inventario</span><strong className="kpi-valor dato">{clp(k.valorizacion_inventario)}</strong><span className="kpi-pie ok">{num(k.skus_activos)} SKUs activos</span></div>
          <div className="kpi"><span className="kpi-et">Stock crítico</span><strong className="kpi-num mal">{num(k.stock_critico)}<small>{k.stock_critico === 1 ? 'artículo' : 'artículos'}</small></strong><span className="kpi-pie mal">Requiere reorden</span></div>
          <div className="kpi"><span className="kpi-et">Ventas del día</span><strong className="kpi-num">{num(k.ventas_dia)}<small>{k.ventas_dia === 1 ? 'orden' : 'órdenes'}</small></strong><span className="kpi-pie">Multicanal (Mkt + Web)</span></div>
          <div className="kpi"><span className="kpi-et">Margen promedio</span><strong className="kpi-valor dato">{k.margen_promedio == null ? '—' : `${Number(k.margen_promedio).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`}</strong><span className="kpi-pie ok">Utilidad bruta estimada</span></div>
        </div>
      )}
      <h2 className="subtitulo">Productos más vendidos y estado de reposición</h2>
      <Tabla
        columnas={['SKU', 'Producto', 'Marca', { t: 'Ventas (mes)', d: 1 }, { t: 'Stock actual', d: 1 }, 'Estado']}
        vacio={!top ? 'Cargando…' : !top.length && !error ? 'Aún no hay ventas registradas este mes.' : null}
      >
        {top?.map((p) => {
          const quiebre = p.estado === 'QUIEBRE_INMINENTE';
          return (
            <tr key={p.sku}>
              <td className="dato">{p.sku}</td>
              <td>{p.producto}</td>
              <td>{p.marca}</td>
              <td className="dato derecha">{num(p.ventas_mes)} un.</td>
              <td className={`dato derecha ${quiebre ? 'texto-mal' : ''}`}>{num(p.stock_actual)} un.</td>
              <td><Badge tono={quiebre ? 'mal' : 'ok'}>{quiebre ? 'Quiebre inminente' : 'Abastecido'}</Badge></td>
            </tr>
          );
        })}
      </Tabla>
    </div>
  );
}
