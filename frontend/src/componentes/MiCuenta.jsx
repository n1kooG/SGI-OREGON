import { useState } from 'react';
import { api, ApiError, mensajeError } from '../api.js';
import { useSesion } from '../sesion.jsx';
import { Alerta, Badge, Boton, Campo, Icono, Modal } from './ui.jsx';
import { ROL } from './Layouts.jsx';
import '../paginas/admin.css';

const CLAVE_EJEMPLO = 'demo-oregon-2026'; // pública: es la de los datos de ejemplo y el backend la rechaza
const VACIO = { actual: '', nueva: '', repetir: '' };

function Requisito({ cumple, pendiente, children }) {
  return (
    <li className={cumple ? 'cumple' : ''}>
      <span className="marca-req" aria-hidden="true">{cumple && <Icono n="check" />}</span>
      <span className="txt-req">{children}</span>
      <span className="estado-req">{cumple ? 'Cumple' : pendiente ? 'Pendiente' : 'No cumple'}</span>
    </li>
  );
}

export default function MiCuenta({ onClose }) {
  const { usuario, expirar } = useSesion();
  const [f, setF] = useState(VACIO);
  const [errActual, setErrActual] = useState('');
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrActual(''); setError(''); setHecho(false); };

  const { actual, nueva, repetir } = f;
  const largo = nueva.length >= 12;
  const distinta = !!nueva && !!actual && nueva !== actual;
  const noEjemplo = !!nueva && nueva.toLowerCase() !== CLAVE_EJEMPLO;
  const coincide = !!repetir && repetir === nueva;
  const puede = !!actual && largo && distinta && noEjemplo && coincide && !enviando;

  async function enviar(e) {
    e.preventDefault();
    if (!puede) return;
    setEnviando(true); setError(''); setErrActual('');
    try {
      await api('/auth/clave', { metodo: 'PUT', cuerpo: { actual, nueva } });
      setF(VACIO); setHecho(true);
      // El backend revoca las sesiones del usuario: si la actual también cayó, se vuelve al login con aviso.
      try { await api('/auth/me', { publica: true }); } catch (err) {
        if (err instanceof ApiError && err.status === 401) expirar('Tu clave fue actualizada. Ingresa nuevamente con la nueva clave.');
      }
    } catch (err) {
      if (err.codigo === 'CLAVE_ACTUAL_INCORRECTA') setErrActual('La clave actual es incorrecta');
      else setError(mensajeError(err));
    } finally { setEnviando(false); }
  }

  return (
    <Modal chico className="mi-cuenta" titulo="Mi cuenta" subtitulo="Tus datos y la seguridad de tu cuenta" onClose={onClose}>
      <dl className="ficha-cuenta">
        <div><dt>Nombre</dt><dd>{usuario.nombre}</dd></div>
        <div><dt>Correo</dt><dd>{usuario.email}</dd></div>
        <div><dt>Rol</dt><dd><Badge>{ROL[usuario.rol] ?? usuario.rol}</Badge></dd></div>
        <p>Solo lectura. Estos datos los administra Jefatura en Usuarios y Roles.</p>
      </dl>

      <form onSubmit={enviar} noValidate>
        <h3>Cambiar contraseña</h3>
        {hecho && (
          <div className="exito-clave" role="status">
            <span className="marca-req"><Icono n="check" /></span>
            <div><strong>Tu clave fue actualizada</strong><span>Cerramos tus demás sesiones abiertas.</span></div>
          </div>
        )}
        <Campo etiqueta="Clave actual" type="password" autoComplete="current-password" placeholder="Ingresa tu clave actual" value={actual} onChange={set('actual')} error={errActual} data-inicial />
        <Campo etiqueta="Nueva clave" type="password" autoComplete="new-password" placeholder="Mínimo 12 caracteres" value={nueva} onChange={set('nueva')} />
        <Campo etiqueta="Repetir nueva clave" type="password" autoComplete="new-password" placeholder="Repite la nueva clave" value={repetir} onChange={set('repetir')}
          error={repetir && !coincide ? 'Las claves no coinciden' : ''} />
        <div className="requisitos">
          <span id="req-tit">La nueva clave debe cumplir</span>
          <ul aria-labelledby="req-tit">
            <Requisito cumple={largo} pendiente={!nueva}>Mínimo 12 caracteres</Requisito>
            <Requisito cumple={distinta} pendiente={!nueva || !actual}>Distinta de la clave actual</Requisito>
            <Requisito cumple={noEjemplo} pendiente={!nueva}>No ser la clave de ejemplo</Requisito>
          </ul>
        </div>
        <p className="ayuda"><Icono n="info" />Al cambiar tu clave se cerrarán tus sesiones abiertas y deberás ingresar de nuevo con la nueva.</p>
        <Alerta>{error}</Alerta>
        <div className="pie-cuenta">
          <Boton onClick={onClose}>Cancelar</Boton>
          <Boton type="submit" variante="primario" disabled={!puede}>{enviando ? 'Cambiando…' : 'Cambiar contraseña'}</Boton>
        </div>
      </form>
    </Modal>
  );
}
