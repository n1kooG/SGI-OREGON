import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alerta } from '../../componentes/ui.jsx';
import { api, mensajeError } from '../../api.js';
import { Ico } from './iconos.jsx';
import { fechaLarga, hora, useCausales } from './datos.js';
import { Estado, Orden, TONO, Titulo } from './comunes.jsx';

const PERIODOS = [['hoy', 'Hoy', 0], ['7', '7 días', 6], ['mes', 'Mes', 29]]; // días hacia atrás incluyendo hoy
const POR_PAGINA = 100;
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const desde = (dias) => { const d = inicioDia(new Date()); d.setDate(d.getDate() - dias); return d; };
const claveDia = (iso) => inicioDia(new Date(iso)).getTime();

function etiquetaDia(iso) {
  const d = new Date(iso);
  const dif = Math.round((inicioDia(new Date()) - inicioDia(d)) / 864e5);
  return `${dif === 0 ? 'Hoy · ' : ''}${fechaLarga(d, d.getFullYear() !== new Date().getFullYear())}`;
}

export default function Historial() {
  const [periodo, setPeriodo] = useState('hoy');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const causal = useCausales(items);

  // Se piden páginas (de la más reciente hacia atrás) hasta cubrir el período; el filtro por fecha se hace aquí.
  useEffect(() => {
    let vivo = true;
    const corte = desde(PERIODOS.find((p) => p[0] === periodo)[2]);
    setItems(null); setError('');
    (async () => {
      const acumulado = [];
      for (let pagina = 1; ; pagina++) {
        const { data } = await api(`/despachos/historial?pagina=${pagina}&limite=${POR_PAGINA}`);
        acumulado.push(...data.items);
        const ultimo = data.items.at(-1);
        if (!ultimo || new Date(ultimo.fecha_cierre) < corte || acumulado.length >= data.total) break;
      }
      if (vivo) setItems(acumulado.filter((d) => new Date(d.fecha_cierre) >= corte));
    })().catch((e) => vivo && (setError(mensajeError(e)), setItems([])));
    return () => { vivo = false; };
  }, [periodo]);

  const dias = [];
  for (const d of items ?? []) {
    const k = claveDia(d.fecha_cierre);
    if (dias.at(-1)?.k !== k) dias.push({ k, etiqueta: etiquetaDia(d.fecha_cierre), lista: [] });
    dias.at(-1).lista.push(d);
  }

  return (
    <div className="ch-cont ch-historial">
      <Titulo h="Historial" sub="Tus entregas y rechazos cerrados" />
      <div className="ch-segmentos" role="group" aria-label="Período">
        {PERIODOS.map(([k, texto]) => <button type="button" key={k} className={periodo === k ? 'sel' : ''} aria-pressed={periodo === k} onClick={() => setPeriodo(k)}>{texto}</button>)}
      </div>
      <Alerta>{error}</Alerta>
      {!items && <p className="ch-vacio-txt">Cargando…</p>}
      {items && !items.length && !error && (
        <section className="ch-vacio">
          <span className="ch-medalla"><Ico n="reloj" t={40} /></span>
          <h2>{periodo === 'hoy' ? 'Aún no has cerrado entregas hoy' : 'No hay entregas cerradas en este período'}</h2>
          <p>Cada parada que entregues o rechaces quedará registrada aquí.</p>
          <Link className="ch-btn" to="/chofer/ruta"><Ico n="mapa" />Ver ruta de hoy</Link>
        </section>
      )}
      {dias.map((dia) => (
        <section className="ch-dia" key={dia.k}>
          <div className="ch-fila"><h2 className="ch-seccion">{dia.etiqueta}</h2><span>{dia.lista.length} {dia.lista.length === 1 ? 'parada' : 'paradas'}</span></div>
          {dia.lista.map((d) => {
            const [tono, texto] = TONO[d.estado_entrega];
            const rechazo = d.estado_entrega === 'RECHAZADO';
            const motivo = rechazo ? causal(d) : null;
            const firma = !rechazo && (d.tiene_firma ? (d.nombre_receptor ? `Con firma de ${d.nombre_receptor}` : 'Con firma') : d.nombre_receptor && `Recibió ${d.nombre_receptor}`);
            return (
              <article className="ch-tarjeta" key={d.id_despacho}>
                <div className="ch-fila"><div className="ch-hora"><strong>{hora(d.fecha_cierre)}</strong><Orden>Orden #{d.codigo_externo}</Orden></div><Estado tono={tono}>{texto}</Estado></div>
                <h3>{d.nombre_cliente}</h3>
                {d.comuna && <p className="ch-sec">{d.comuna}</p>}
                {rechazo && motivo && <p className="ch-cierre mal"><Ico n="x" t={16} />Causal: {motivo}</p>}
                {firma && <p className="ch-cierre neutro"><Ico n="firma" t={16} />{firma}</p>}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
