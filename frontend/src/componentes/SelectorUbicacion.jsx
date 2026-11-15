import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta } from './ui.jsx';
import '../paginas/bodega-estructura.css';

const RE = /^Pasillo (\d+), Rack ([A-Z]), Piso (\d+)$/;

// Elige la ubicación de un SKU dentro de la estructura de la bodega. Llama a onChange con la etiqueta
// «Pasillo 1, Rack B, Piso 2» cuando los tres niveles están elegidos y con '' mientras falte alguno.
export default function SelectorUbicacion({ valor, onChange, etiqueta = 'Ubicación en bodega' }) {
  const [estructura, setEstructura] = useState(null);
  const [error, setError] = useState('');
  const m = RE.exec(valor ?? '');
  const [p, setP] = useState(m ? Number(m[1]) : null);
  const [r, setR] = useState(m ? m[2] : null);
  const [piso, setPiso] = useState(m ? Number(m[3]) : null);

  useEffect(() => {
    let viva = true;
    api('/bodega').then(({ data }) => viva && setEstructura(data.pasillos)).catch((e) => viva && setError(mensajeError(e)));
    return () => { viva = false; };
  }, []);

  const elegir = (np, nr, npiso) => {
    setP(np); setR(nr); setPiso(npiso);
    onChange(np && nr && npiso ? `Pasillo ${np}, Rack ${nr}, Piso ${npiso}` : '');
  };
  if (error) return <Alerta>{error}</Alerta>;
  if (!estructura) return <p className="sel-ubi-ayuda">Cargando la estructura de la bodega…</p>;
  if (!estructura.some((x) => x.racks.length)) return <p className="sel-ubi-ayuda">La bodega aún no tiene racks. Pide a la jefatura que los configure en «Bodega».</p>;

  const pasillo = estructura.find((x) => x.numero === p);
  const rack = pasillo?.racks.find((x) => x.letra === r);
  // Sin elegir todavía, los niveles de abajo se muestran apagados con los del primer pasillo, como en el diseño.
  const muestraP = pasillo ?? estructura.find((x) => x.racks.length);
  const muestraR = rack ?? muestraP.racks[0];
  const elegida = p && r && piso ? `Pasillo ${p}, Rack ${r}, Piso ${piso}` : null;
  const guia = !p ? 'Elige un pasillo para empezar' : !r ? 'Elige un rack' : 'Elige un piso';
  const chip = (activo, onClick, texto, nombre, apagado) => (
    <button type="button" key={texto} className={`sel-ubi-chip ${activo ? 'activo' : ''}`} aria-pressed={activo} aria-label={nombre} disabled={apagado} onClick={onClick}>{texto}</button>
  );
  return (
    <div className="sel-ubi" role="group" aria-label={etiqueta}>
      <span className="sel-ubi-titulo">{etiqueta}</span>
      <div className="sel-ubi-nivel"><span>Pasillo</span><div>{estructura.map((x) => chip(p === x.numero, () => elegir(x.numero, null, null), x.numero, `Pasillo ${x.numero}`, !x.racks.length))}</div></div>
      <div className="sel-ubi-nivel"><span>Rack</span><div>{muestraP.racks.map((x) => chip(r === x.letra, () => elegir(p, x.letra, null), x.letra, `Rack ${x.letra}`, !pasillo))}</div></div>
      <div className="sel-ubi-nivel"><span>Piso</span><div>{muestraR.ubicaciones.map((u) => chip(piso === u.piso, () => elegir(p, r, u.piso), u.piso, `Piso ${u.piso}`, !rack))}</div></div>
      <p className={`sel-ubi-vista ${elegida ? '' : 'vacia'}`} aria-live="polite">{elegida ?? guia}</p>
      <p className="sel-ubi-ayuda">Solo se ofrecen lugares que existen en la bodega. Se registra quién y cuándo la cambió.</p>
    </div>
  );
}
