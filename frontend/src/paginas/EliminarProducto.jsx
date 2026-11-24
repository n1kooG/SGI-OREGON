import { useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Boton, Modal } from '../componentes/ui.jsx';

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Texto legible del historial que impide borrar: solo las partes con datos («2 compras, 3 ventas y 24 un. en stock»).
const resumen = ({ compras = 0, ventas = 0, stock = 0 } = {}) => {
  const partes = [compras > 0 && plural(compras, 'compra', 'compras'), ventas > 0 && plural(ventas, 'venta', 'ventas'), stock > 0 && `${stock} un. en stock`].filter(Boolean);
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : partes[0] ?? 'historial';
};

// Confirmación de borrado. Si el servidor responde 409 PRODUCTO_CON_HISTORIAL el mismo flujo pasa a «No se puede eliminar»,
// que ofrece dar de baja (estado INACTIVO). `onHecho(aviso)` recibe el texto del aviso; el padre cierra y refresca.
export default function EliminarProducto({ producto, onClose, onHecho }) {
  const [historial, setHistorial] = useState(null);
  const [alerta, setAlerta] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function ejecutar(fn) {
    setEnviando(true); setAlerta('');
    try { await fn(); } catch (e) {
      if (e.codigo === 'PRODUCTO_CON_HISTORIAL') setHistorial(e.detalle ?? {});
      else setAlerta(mensajeError(e));
    } finally { setEnviando(false); }
  }
  const eliminar = () => ejecutar(async () => { await api(`/productos/${encodeURIComponent(producto.sku)}`, { metodo: 'DELETE' }); onHecho('Producto eliminado'); });
  const darDeBaja = () => ejecutar(async () => { await api(`/productos/${encodeURIComponent(producto.sku)}`, { metodo: 'PUT', cuerpo: { estado: 'INACTIVO' } }); onHecho('Producto dado de baja'); });

  if (historial) {
    return (
      <Modal chico titulo="No se puede eliminar" subtitulo={`${producto.sku} tiene historial y debe conservarse.`} onClose={onClose}
        pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante="peligro" onClick={darDeBaja} disabled={enviando}>Dar de baja</Boton></>}>
        <Alerta>{alerta}</Alerta>
        <p>Tiene {resumen(historial)}. Puedes darlo de baja: deja de venderse y de aparecer en el catálogo activo, el historial se conserva y podrás reactivarlo.</p>
      </Modal>
    );
  }
  return (
    <Modal chico titulo="Eliminar producto" subtitulo={`Se eliminará ${producto.sku} · ${producto.nombre}.`} onClose={onClose}
      pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante="peligro" onClick={eliminar} disabled={enviando}>Eliminar producto</Boton></>}>
      <Alerta>{alerta}</Alerta>
      <p>Esta acción no se puede deshacer. Solo se pueden eliminar productos sin compras, ventas ni stock; en otro caso podrás darlos de baja.</p>
    </Modal>
  );
}
