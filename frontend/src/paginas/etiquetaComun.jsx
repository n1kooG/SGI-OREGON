import { descargarArchivo, mensajeError } from '../api.js';
import './etiquetas.css';

const Svg = ({ children, ...p }) => <svg className="ico-etq" viewBox="0 0 24 24" aria-hidden="true" {...p}>{children}</svg>;
export const IcoPdf = () => <Svg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></Svg>;
export const IcoDescargar = () => <Svg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></Svg>;
export const IcoSubir = () => <Svg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></Svg>;
export const IcoQuitar = () => <Svg><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" /></Svg>;
export const IcoReemplazar = () => <Svg><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></Svg>;

// Un fallo de descarga (p. ej. la etiqueta se quitó mientras tanto) se avisa sin romper la pantalla.
export function descargar(pedido, aviso) {
  return descargarArchivo(`/pedidos/${pedido.id_orden}/etiqueta`, `etiqueta_${pedido.codigo_externo}.pdf`)
    .catch((e) => aviso(mensajeError(e), 'error'));
}
