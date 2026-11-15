import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Icono } from './ui.jsx';
import '../paginas/bodega-estructura.css';

const RE = /^Pasillo (\d+), Rack ([A-Z]), Piso (\d+)$/;

// Elige la ubicación de un SKU dentro de la estructura de la bodega. Llama a onChange con la etiqueta
// «Pasillo 1, Rack B, Piso 2» cuando los tres niveles están elegidos y con '' mientras falte alguno.
export default function SelectorUbicacion({ valor, onChange, etiqueta = 'Ubicación' }) {
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
  const pasillo = estructura?.find((x) => x.numero === p);
  const rack = pasillo?.racks.find((x) => x.letra === r);
  const elegida = p && r && piso ? `Pasillo ${p}, Rack ${r}, Piso ${piso}` : null;
  const chip = (activo, onClick, texto, deshabilitado) => (
    <button type="button" key={texto} className={`sel-ubi-chip ${activo ? 'activo' : ''}`} aria-pressed={activo} disabled={deshabilitado} onClick={onClick}>{texto}</button>
  );

  if (error) return <Alerta>{error}</Alerta>;
  if (!estructura) return <p className="ayuda">Cargando la estructura de la bodega…</p>;
  if (!estructura.some((x) => x.racks.length)) return <p className="ayuda">La bodega aún no tiene racks. Pide a la jefatura que los configure en «Bodega».</p>;
  return (
    <div className="sel-ubi" role="group" aria-label={etiqueta}>
      <div className="sel-ubi-nivel"><span>Pasillo</span><div>{estructura.map((x) => chip(p === x.numero, () => elegir(x.numero, null, null), `Pasillo ${x.numero}`, !x.racks.length))}</div></div>
      <div className="sel-ubi-nivel"><span>Rack</span><div>{pasillo ? pasillo.racks.map((x) => chip(r === x.letra, () => elegir(p, x.letra, null), `Rack ${x.letra}`)) : <em>Elige un pasillo</em>}</div></div>
      <div className="sel-ubi-nivel"><span>Piso</span><div>{rack ? rack.ubicaciones.map((u) => chip(piso === u.piso, () => elegir(p, r, u.piso), `Piso ${u.piso}`)) : <em>Elige un rack</em>}</div></div>
      <p className={`sel-ubi-vista ${elegida ? '' : 'vacia'}`} aria-live="polite"><Icono n="pin" />{elegida ?? 'Sin elegir'}</p>
    </div>
  );
}
