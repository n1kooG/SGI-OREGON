// Gráficos del dashboard dibujados en SVG: el diseño pide tramas, etiquetas dentro de las barras y una línea de umbral,
// que con una librería exigirían plugins propios; así no se agrega ninguna dependencia.
const nf = (v, d = 0) => Number(v).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
export const millones = (v) => nf(v / 1e6, 1);
const CANALES = [['mayorista', 'Mayorista'], ['marketplace', 'Marketplace'], ['web', 'Web']]; // de abajo hacia arriba en las barras

// Paso «redondo» (1, 2, 2.5, 5 × 10^n) con a lo sumo 4 divisiones.
function escala(max) {
  const bruto = Math.max(max, 1) / 4, p = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= bruto);
  return { paso, tope: Math.ceil(max / paso) * paso || paso };
}
const ejeClp = (v) => (v === 0 ? '0' : v >= 1e6 ? `$${nf(v / 1e6, v % 1e6 ? 1 : 0)} M` : `$${nf(v / 1e3)} mil`);

// Trama diagonal de Marketplace: se distingue sin depender del color (impresión en blanco y negro, daltonismo).
export const TramaMarketplace = () => (
  <pattern id="trama-mkt" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
    <rect width="5" height="5" fill="#fff" />
    <rect width="2.2" height="5" fill="var(--ink-2)" />
  </pattern>
);
const RELLENO = { mayorista: 'var(--accent)', marketplace: 'url(#trama-mkt)', web: 'var(--teal)' };

// Muestra de la leyenda: cuadro relleno (barras) o marca de línea con su forma (líneas).
export function Muestra({ canal, linea }) {
  if (!linea) return <svg width="12" height="12" aria-hidden="true"><defs><TramaMarketplace /></defs><rect width="12" height="12" rx="3" fill={RELLENO[canal]} stroke={canal === 'marketplace' ? 'var(--ink-2)' : 'none'} strokeWidth=".6" /></svg>;
  return (
    <svg width="22" height="14" aria-hidden="true">
      {canal === 'marketplace' ? <line x1="0" x2="22" y1="7" y2="7" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 3" /> : <line x1="0" x2="22" y1="7" y2="7" stroke={COLOR_LINEA[canal]} strokeWidth="2" />}
      <Marca canal={canal} x={11} y={7} />
    </svg>
  );
}

const COLOR_LINEA = { mayorista: 'var(--accent)', marketplace: 'var(--ink-2)', web: 'var(--teal)' };
const COLOR_TEXTO = { mayorista: 'var(--accent-ink)', marketplace: 'var(--ink-2)', web: 'var(--teal-ink)' };
// Una forma distinta por canal: triángulo, cuadrado y círculo.
function Marca({ canal, x, y }) {
  const p = { fill: COLOR_LINEA[canal], stroke: '#fff', strokeWidth: 1.5 };
  if (canal === 'mayorista') return <path d={`M${x} ${y - 5.5}L${x + 5.5} ${y + 4.5}H${x - 5.5}Z`} {...p} strokeLinejoin="round" />;
  if (canal === 'marketplace') return <rect x={x - 4.5} y={y - 4.5} width="9" height="9" rx="1.5" {...p} />;
  return <circle cx={x} cy={y} r="5" {...p} />;
}

// Barras apiladas por tramo (Mayorista, Marketplace, Web) con el valor de cada segmento y el total encima.
export function BarrasApiladas({ serie, vacio }) {
  const W = 636, H = 276, L = 52, PW = 584, T = 8, PH = 224, B = T + PH;
  const { paso, tope } = escala(vacio ? 20e6 : Math.max(...serie.map((s) => s.total), 0));
  const y = (v) => B - (PH * v) / tope;
  const slot = PW / serie.length, bw = Math.min(56, slot * 0.48);
  const ticks = []; for (let v = 0; v <= tope + 1; v += paso) ticks.push(v);
  return (
    <svg className="grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ventas netas por canal en cada tramo del período">
      <defs><TramaMarketplace /></defs>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={L + PW} y1={y(v)} y2={y(v)} stroke={v ? 'var(--line)' : 'var(--line-strong)'} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="g-eje">{ejeClp(v)}</text>
        </g>
      ))}
      {serie.map((s, i) => {
        const x = L + slot * i + (slot - bw) / 2;
        let base = B;
        return (
          <g key={s.clave}>
            {!vacio && CANALES.map(([k]) => {
              const h = (PH * s[k]) / tope;
              if (!h) return null;
              base -= h;
              const top = base;
              return (
                <g key={k}>
                  <rect x={x} y={top} width={bw} height={h} fill={RELLENO[k]} stroke="#fff" strokeWidth="1" />
                  {h >= 15 && (
                    <>
                      {k === 'marketplace' && <rect x={x + bw / 2 - 14} y={top + h / 2 - 8.5} width="28" height="17" rx="4" fill="var(--ink-2)" />}
                      <text x={x + bw / 2} y={top + h / 2 + 4} textAnchor="middle" className="g-val" fill={k === 'marketplace' ? '#fff' : 'var(--ink)'}>{millones(s[k])}</text>
                    </>
                  )}
                </g>
              );
            })}
            {!vacio && s.total > 0 && <text x={x + bw / 2} y={base - 6} textAnchor="middle" className="g-total">{millones(s.total)}</text>}
            <text x={x + bw / 2} y={B + 18} textAnchor="middle" className="g-et">{s.etiqueta}</text>
            {s.detalle && <text x={x + bw / 2} y={B + 33} textAnchor="middle" className="g-det">{s.detalle}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Líneas de margen bruto % por canal, con etiqueta al final de cada serie (texto en teal-ink / accent-ink para contraste).
export function LineasMargen({ serie, periodo, vacio }) {
  const W = 388, H = 276, L = 40, PW = 230, T = 8, PH = 224, B = T + PH;
  const vals = vacio ? [] : serie.flatMap((s) => CANALES.map(([k]) => s[`margen_${k}`])).filter((v) => v != null);
  const min = vals.length ? Math.floor((Math.min(...vals) - 5) / 10) * 10 : 10, max = vals.length ? Math.max(Math.ceil((Math.max(...vals) + 5) / 10) * 10, min + 20) : 50;
  const y = (v) => B - (PH * (v - min)) / (max - min);
  const x = (i) => L + 23 + ((PW - 46) * i) / Math.max(serie.length - 1, 1);
  const ticks = []; for (let v = min; v <= max; v += 10) ticks.push(v);
  const etq = (s, i) => (periodo === 'mes' ? `S${i + 1}${s.parcial ? '*' : ''}` : s.etiqueta[0]);
  // Etiquetas finales ordenadas por altura y separadas al menos 17 px para que no se pisen.
  const finales = CANALES.map(([k, n]) => { const i = serie.map((s) => s[`margen_${k}`]).findLastIndex((v) => v != null); return i < 0 ? null : { k, n, i, v: serie[i][`margen_${k}`], y: y(serie[i][`margen_${k}`]) }; }).filter(Boolean).sort((a, b) => a.y - b.y);
  finales.forEach((f, j) => { if (j && f.y - finales[j - 1].y < 17) f.y = finales[j - 1].y + 17; });
  return (
    <svg className="grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Margen bruto porcentual por canal en cada tramo del período">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={L + PW} y1={y(v)} y2={y(v)} stroke={v === min ? 'var(--line-strong)' : 'var(--line)'} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="g-eje">{v} %</text>
        </g>
      ))}
      {serie.map((s, i) => <text key={s.clave} x={x(i)} y={B + 18} textAnchor="middle" className="g-et">{etq(s, i)}</text>)}
      {CANALES.map(([k]) => {
        const pts = serie.map((s, i) => [i, s[`margen_${k}`]]).filter(([, v]) => v != null);
        const tramos = []; // la línea se corta donde no hubo ventas
        pts.forEach(([i, v]) => { const u = tramos.at(-1); if (u && u.at(-1)[0] === i - 1) u.push([i, v]); else tramos.push([[i, v]]); });
        return (
          <g key={k}>
            {tramos.map((t, j) => t.length > 1 && <polyline key={j} points={t.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={COLOR_LINEA[k]} strokeWidth="2" strokeDasharray={k === 'marketplace' ? '5 3' : undefined} strokeLinejoin="round" />)}
            {pts.map(([i, v]) => <Marca key={i} canal={k} x={x(i)} y={y(v)} />)}
          </g>
        );
      })}
      {finales.map((f) => (
        <g key={f.k}>
          <rect x={x(f.i) + 12} y={f.y - 8.5} width={f.n.length * 6.9 + 54} height="17" rx="3" fill="#fff" />
          <text x={x(f.i) + 15} y={f.y + 4} className="g-fin" fill={COLOR_TEXTO[f.k]}>{f.n} {nf(f.v, 1)} %</text>
        </g>
      ))}
    </svg>
  );
}

// Ranking horizontal de rotación (unidades vendidas ÷ stock) con la línea del umbral de alta rotación.
export function RankingRotacion({ items, umbral }) {
  const W = 460, H = 384, X0 = 184, ancho = 216, FILA = 46;
  const max = Math.max(6, ...items.map((r) => r.rotacion)), paso = [2, 5, 10, 20, 50, 100, 200, 500].find((p) => max / p <= 6) ?? 1000; // a lo más 6 divisiones
  const tope = Math.ceil(max / paso) * paso, px = ancho / tope;
  const ticks = []; for (let v = 0; v <= tope; v += paso) ticks.push(v);
  const corto = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  return (
    <svg className="grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ranking de productos por rotación">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={X0 + v * px} x2={X0 + v * px} y1="20" y2="348" stroke={v ? 'var(--line)' : 'var(--line-strong)'} />
          <text x={X0 + v * px} y="365" textAnchor="middle" className="g-eje">{v}×</text>
        </g>
      ))}
      {items.map((r, i) => {
        const y = 20 + FILA * i;
        return (
          <g key={r.sku}>
            <title>{`${r.producto}: ${r.unidades} un. vendidas ÷ ${r.stock} en stock`}</title>
            <text x="0" y={y + 21} className="g-sku">{r.sku}</text>
            <text x="0" y={y + 37} className="g-nom">{corto(r.producto, 26)}</text>
            <rect x={X0 + 1} y={y + 14} width={Math.max(r.rotacion * px, 2)} height="22" rx="3" fill="var(--accent)" />
            <text x="428" y={y + 30} className="g-rot">{nf(r.rotacion, 1)}×</text>
          </g>
        );
      })}
      <line x1={X0 + umbral * px} x2={X0 + umbral * px} y1="16" y2="342" stroke="var(--accent-ink)" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={X0 + umbral * px} y="10" textAnchor="middle" className="g-umbral">Alta rotación ≥ {umbral}×</text>
    </svg>
  );
}
