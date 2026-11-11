import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Ico } from './iconos.jsx';

// Lienzo de firma con eventos de puntero (dedo o mouse). Guarda los trazos en píxeles CSS y los vuelve a pintar
// si cambia el tamaño o la densidad de píxeles, así girar el teléfono no borra la firma.
const Firma = forwardRef(function Firma({ error, alCambiar }, ref) {
  const lienzo = useRef(null);
  const trazos = useRef([]);
  const dibujando = useRef(false);
  const [vacio, setVacio] = useState(true);

  const pintar = useCallback(() => {
    const c = lienzo.current;
    const ctx = c.getContext('2d');
    const r = window.devicePixelRatio || 1;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10201f';
    for (const t of trazos.current) {
      ctx.beginPath();
      t.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (t.length === 1) ctx.lineTo(t[0][0] + 0.01, t[0][1]); // un toque suelto deja un punto
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const c = lienzo.current;
    const ajustar = () => { const r = window.devicePixelRatio || 1; c.width = Math.round(c.clientWidth * r); c.height = Math.round(c.clientHeight * r); pintar(); };
    ajustar();
    const o = new ResizeObserver(ajustar);
    o.observe(c);
    return () => o.disconnect();
  }, [pintar]);

  const punto = (e) => { const r = lienzo.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const inicio = (e) => {
    lienzo.current.setPointerCapture(e.pointerId);
    dibujando.current = true;
    trazos.current.push([punto(e)]);
    pintar(); setVacio(false); alCambiar?.(false);
  };
  const mover = (e) => { if (!dibujando.current) return; trazos.current.at(-1).push(punto(e)); pintar(); };
  const fin = () => { dibujando.current = false; };

  useImperativeHandle(ref, () => ({
    vacia: () => trazos.current.length === 0,
    limpiar() { trazos.current = []; pintar(); setVacio(true); },
    // La firma se exporta sobre fondo blanco para que se vea igual en cualquier visor.
    exportar: () => new Promise((ok) => {
      const c = lienzo.current;
      const t = document.createElement('canvas');
      t.width = c.width; t.height = c.height;
      const ctx = t.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, t.width, t.height); ctx.drawImage(c, 0, 0);
      t.toBlob(ok, 'image/png');
    }),
  }), [pintar]);

  return (
    <div className={`ch-lienzo ${error ? 'error' : ''}`}>
      {vacio && <div className="ch-ayuda-firma"><Ico n="firma" t={32} /><p>Pide al receptor que firme aquí</p></div>}
      <i className="ch-linea-firma" />
      <canvas ref={lienzo} role="img" aria-label="Lienzo de firma" onPointerDown={inicio} onPointerMove={mover} onPointerUp={fin} onPointerCancel={fin} />
    </div>
  );
});
export default Firma;
