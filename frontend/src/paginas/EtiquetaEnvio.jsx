import { useRef, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Boton, Icono, useAviso } from '../componentes/ui.jsx';
import { IcoDescargar, IcoPdf, IcoQuitar, IcoReemplazar, IcoSubir, descargar } from './etiquetaComun.jsx';

const MAX_BYTES = 2 * 1024 * 1024;
const cuando = (f) => { const d = new Date(f); return `${d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })} · ${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })}`; };

// Bloque «Etiqueta de envío» del detalle: subir, reemplazar, descargar y quitar la etiqueta importada del pedido.
export default function EtiquetaEnvio({ pedido, onCambio }) {
  const aviso = useAviso();
  const entrada = useRef(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [arrastrando, setArrastrando] = useState(false);

  async function subir(archivo) {
    if (!archivo) return;
    if (!/\.pdf$/i.test(archivo.name) && archivo.type !== 'application/pdf') return setError('El archivo debe ser un PDF.');
    if (archivo.size > MAX_BYTES) return setError('El archivo supera los 2 MB.');
    setError(''); setOcupado(true);
    try {
      const f = new FormData();
      f.set('archivo', archivo);
      const { data } = await api(`/pedidos/${pedido.id_orden}/etiqueta`, { metodo: 'PUT', cuerpo: f });
      aviso(data.estado === 'REEMPLAZADA' ? 'Etiqueta reemplazada.' : 'Etiqueta cargada.');
      onCambio({ tiene_etiqueta: true, etiqueta_nombre_archivo: data.etiqueta_nombre_archivo, etiqueta_importada_en: data.etiqueta_importada_en });
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(false); }
  }
  async function quitar() {
    setError(''); setOcupado(true);
    try {
      await api(`/pedidos/${pedido.id_orden}/etiqueta`, { metodo: 'DELETE' });
      aviso('Etiqueta quitada.');
      setConfirmando(false);
      onCambio({ tiene_etiqueta: false, etiqueta_nombre_archivo: null, etiqueta_importada_en: null });
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(false); }
  }
  const elegido = (e) => { subir(e.target.files[0]); e.target.value = ''; };
  const entradaPdf = <input ref={entrada} type="file" accept="application/pdf,.pdf" hidden onChange={elegido} />;

  return (
    <section aria-label="Etiqueta de envío">
      <h3 className="etiqueta">Etiqueta de envío</h3>
      {pedido.tiene_etiqueta ? (
        confirmando ? (
          <div className="etq-confirmar" role="alertdialog" aria-labelledby="etq-conf-t" aria-describedby="etq-conf-d">
            <Icono n="alerta" />
            <div>
              <strong id="etq-conf-t">¿Quitar la etiqueta de este pedido?</strong>
              <p id="etq-conf-d">{pedido.etiqueta_nombre_archivo} dejará de estar disponible para Bodega. Podrás subir otra después.</p>
              <div className="etq-botones">
                <Boton variante="peligro-solido" disabled={ocupado} onClick={quitar}><IcoQuitar />{ocupado ? 'Quitando…' : 'Quitar etiqueta'}</Boton>
                <Boton disabled={ocupado} onClick={() => setConfirmando(false)} autoFocus>Cancelar</Boton>
              </div>
            </div>
          </div>
        ) : (
          <div className="etq-tarjeta">
            <div className="etq-fila">
              <span className="etq-icono"><IcoPdf /></span>
              <div className="etq-texto"><span className="dato">{pedido.etiqueta_nombre_archivo}</span><span>Cargada el {cuando(pedido.etiqueta_importada_en)}</span></div>
              <span className="badge ok">Cargada</span>
            </div>
            <div className="etq-botones">
              <Boton variante="primario" onClick={() => descargar(pedido, aviso)}><IcoDescargar />Descargar</Boton>
              <Boton disabled={ocupado} onClick={() => entrada.current.click()}><IcoReemplazar />{ocupado ? 'Subiendo…' : 'Reemplazar'}</Boton>
              <Boton variante="peligro" onClick={() => setConfirmando(true)}><IcoQuitar />Quitar</Boton>
            </div>
            {entradaPdf}
          </div>
        )
      ) : (
        <>
          <button type="button" className={`etq-subir ${arrastrando ? 'sobre' : ''}`} disabled={ocupado} onClick={() => entrada.current.click()}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); subir(e.dataTransfer.files[0]); }}>
            <span className="etq-icono"><IcoSubir /></span>
            <span className="etq-texto"><strong>{ocupado ? 'Subiendo etiqueta…' : 'Subir etiqueta (PDF)'}</strong><span>Arrastra el archivo o haz clic. Máx. 2 MB.</span></span>
          </button>
          {entradaPdf}
          <p className="etq-ayuda">Mientras no haya etiqueta, Bodega verá el botón de descarga deshabilitado.</p>
        </>
      )}
      <div aria-live="assertive"><Alerta>{error}</Alerta></div>
    </section>
  );
}
