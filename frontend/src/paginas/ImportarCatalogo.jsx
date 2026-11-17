import { useEffect, useRef, useState } from 'react';
import { ApiError, api, descargarArchivo, mensajeError } from '../api.js';
import { Alerta, Boton, Icono, Modal, clp } from '../componentes/ui.jsx';
import { IcoPdf, IcoSubir } from './etiquetaComun.jsx';
import './importar-catalogo.css';

const MAX_BYTES = 5 * 1024 * 1024;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const CANALES = [['WEB', 'WEB'], ['MARKETPLACE', 'MARKETPLACE'], ['MAYORISTA', 'MAYORISTA']];
const canalBajo = (p) => CANALES.find(([c]) => p.precios[c] <= p.costo)?.[1] ?? 'WEB';
const motivoOmitida = (o) => `Fila ${o.fila} · ${o.motivo === 'repetido' ? `${o.sku} repetido` : o.motivo === 'datos incompletos' ? `${o.sku || 'sin código'} — datos incompletos` : o.motivo}`;

function Fila({ titulo, texto, badge, tono }) {
  return (
    <li className="etq-archivo">
      <div className="etq-fila">
        <span className="etq-icono"><IcoPdf /></span>
        <div className="etq-texto"><span className="dato">{titulo}</span><span>{texto}</span></div>
        <span className={`badge ${tono}`}>{badge}</span>
      </div>
    </li>
  );
}

// fases: elegir → simulacion (resumen, o error de precios si hay bajo_costo) → resultado
export default function ImportarCatalogo({ onClose, onCambio }) {
  const entrada = useRef(null);
  const [fase, setFase] = useState('elegir');
  const [archivo, setArchivo] = useState(null);
  const [sim, setSim] = useState(null);
  const [res, setRes] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');

  // El foco no se pierde al cambiar de fase: va al botón principal de la nueva pantalla.
  useEffect(() => { document.querySelector('.modal-cat [data-inicial]:not(:disabled)')?.focus(); }, [fase]);

  async function simular(f) {
    setError('');
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setError('El archivo debe ser una planilla .xlsx.');
    if (!f.size) return setError('El archivo está vacío.');
    if (f.size > MAX_BYTES) return setError('El archivo supera los 5 MB.');
    const datos = new FormData();
    datos.set('archivo', f);
    setOcupado('Revisando el archivo…');
    try {
      const { data } = await api('/productos/importacion/simular', { metodo: 'POST', cuerpo: datos });
      setArchivo(f); setSim(data); setFase('simulacion');
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(''); }
  }

  async function aplicar() {
    setError(''); setOcupado('Importando…');
    const datos = new FormData();
    datos.set('archivo', archivo);
    try {
      const { data } = await api('/productos/importacion', { metodo: 'POST', cuerpo: datos });
      setRes(data); setFase('resultado'); onCambio();
    } catch (e) {
      // El servidor repite la validación: si los precios cambiaron la pantalla pasa a «error de precios».
      if (e instanceof ApiError && e.status === 422 && e.detalle) setSim({ ...sim, valido: false, bajo_costo: e.detalle });
      else setError(mensajeError(e));
    } finally { setOcupado(''); }
  }

  const otro = () => { setArchivo(null); setSim(null); setRes(null); setError(''); setFase('elegir'); };
  const plantilla = () => descargarArchivo('/productos/importacion/plantilla', 'plantilla_catalogo.xlsx').catch((e) => setError(mensajeError(e)));
  const elegido = (e) => { simular(e.target.files[0]); e.target.value = ''; };
  const soltado = (e) => { e.preventDefault(); setArrastrando(false); simular(e.dataTransfer.files[0]); };
  const nBajo = sim?.bajo_costo?.length ?? 0;

  let subtitulo = 'Sube la lista de precios del cliente para crear o actualizar productos.';
  let pie = <><Boton onClick={plantilla}>Descargar plantilla</Boton><Boton onClick={onClose}>Cancelar</Boton></>;
  if (fase === 'simulacion') {
    subtitulo = nBajo ? 'La simulación encontró precios que la base de datos rechazaría.' : 'Revisa la simulación. No se guarda nada hasta que confirmes.';
    pie = <><Boton onClick={otro}><IcoSubir />Elegir otro archivo</Boton>
      {nBajo ? <Boton variante="primario" disabled>Importar</Boton>
        : <Boton variante="primario" data-inicial disabled={!sim.validos || !!ocupado} onClick={aplicar}>{ocupado || `Importar ${plural(sim.validos, 'producto', 'productos')}`}</Boton>}</>;
  } else if (fase === 'resultado') {
    subtitulo = 'Resultado de la importación del catálogo.';
    pie = <><Boton onClick={otro}><IcoSubir />Importar otro archivo</Boton><Boton variante="primario" data-inicial onClick={onClose}>Listo</Boton></>;
  }

  return (
    <Modal className="modal-etq modal-cat" titulo="Importar catálogo" subtitulo={subtitulo} onClose={onClose} pie={pie}>
      {fase === 'elegir' && (
        <div className={`etq-zona ${arrastrando ? 'sobre' : ''}`} onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)} onDrop={soltado}>
          <span className="etq-icono grande"><IcoPdf /></span>
          <h3>Arrastra la lista de precios (.xlsx) o selecciónala</h3>
          <p>Columnas: MARCA, CODIGO, PRODUCTOS, COSTO NETO y PVP. Primera hoja del archivo. Máx. 5 MB.</p>
          <Boton variante="primario" data-inicial disabled={!!ocupado} onClick={() => entrada.current.click()}><IcoSubir />{ocupado || 'Seleccionar archivo'}</Boton>
          <input ref={entrada} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={elegido} />
        </div>
      )}

      {fase === 'simulacion' && !nBajo && (
        <>
          <div className="etq-resumen" role="status" aria-live="polite">
            <span className="etq-check"><Icono n="check" /></span>
            <strong>{plural(sim.validos, 'producto listo', 'productos listos')} · {archivo.name}</strong>
          </div>
          <ul className="etq-lista cat-lista">
            <Fila titulo={plural(sim.nuevos, 'producto nuevo', 'productos nuevos')} texto="Se crean con stock 0 y precios WEB, MARKETPLACE y MAYORISTA." badge="Nuevos" tono="ok" />
            <Fila titulo={plural(sim.existentes, 'producto existente', 'productos existentes')} texto="Se actualizan nombre, marca, costo y precios. El stock y la ubicación no cambian." badge="Se actualizan" tono="info" />
          </ul>
          {sim.omitidas.length > 0 && (
            <div className="cat-omitidas">
              <strong>Filas omitidas ({sim.omitidas.length}) · no se importan</strong>
              <ul>{sim.omitidas.slice(0, 20).map((o) => <li key={o.fila}>{motivoOmitida(o)}</li>)}</ul>
              {sim.omitidas.length > 20 && <span>y {sim.omitidas.length - 20} más.</span>}
            </div>
          )}
          {!sim.validos && <Alerta>El archivo no tiene productos válidos para importar.</Alerta>}
          <p className="etq-nota">La importación queda registrada en la bitácora con tu usuario.</p>
        </>
      )}

      {fase === 'simulacion' && nBajo > 0 && (
        <>
          <div className="cat-error" role="alert"><span className="cat-error-ico" aria-hidden="true">!</span><strong>Corrige {plural(nBajo, 'precio', 'precios')} antes de importar</strong></div>
          <p className="etq-nota cat-sin-margen">No se importó nada: la carga se detiene completa hasta que cada precio sea mayor que su costo. Corrige el archivo y vuelve a cargarlo.</p>
          <ul className="etq-lista">
            {sim.bajo_costo.slice(0, 50).map((p) => (
              <Fila key={p.sku} titulo={`${p.sku} · ${p.nombre}`} texto={`Costo neto ${clp(p.costo)} · precio ${canalBajo(p)} ${clp(p.precios[canalBajo(p)])}`} badge="Precio ≤ costo" tono="mal" />
            ))}
          </ul>
          {nBajo > 50 && <p className="etq-nota">y {nBajo - 50} más.</p>}
        </>
      )}

      {fase === 'resultado' && (
        <>
          <div className="etq-resumen" role="status" aria-live="polite">
            <span className="etq-check"><Icono n="check" /></span>
            <strong>{plural(res.validos, 'producto importado', 'productos importados')}</strong>
          </div>
          <ul className="etq-lista cat-lista">
            <Fila titulo={`${plural(res.nuevos, 'producto nuevo creado', 'productos nuevos creados')}`} texto="Quedan con stock 0 hasta que registres una compra." badge="Creados" tono="ok" />
            <Fila titulo={plural(res.actualizados, 'producto actualizado', 'productos actualizados')} texto="Costo y precios al día. Stock y ubicación sin cambios." badge="Actualizados" tono="info" />
            <Fila titulo={plural(res.omitidas, 'fila omitida', 'filas omitidas')} texto="Datos incompletos o repetidos en el archivo." badge="Omitidas" tono="aviso" />
          </ul>
          <p className="etq-nota">Registrado en la bitácora. Puedes revisar los productos en la lista del catálogo.</p>
        </>
      )}
      <div aria-live="assertive"><Alerta>{error}</Alerta></div>
    </Modal>
  );
}
