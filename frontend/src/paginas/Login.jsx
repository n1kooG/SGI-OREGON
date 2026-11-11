import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alerta, Boton, Campo, Logo } from '../componentes/ui.jsx';
import { mensajeError } from '../api.js';
import '../estilos/sprint1.css';
import { HOME, useSesion } from '../sesion.jsx';

const KEY = 'sgi_correo';
const correoGuardado = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
const guardar = (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } };

// Estantería decorativa del fondo (medidas del diseño: 1440 × 828).
const CAJAS = [[40, 100, 110, 70], [190, 86, 130, 84], [470, 106, 96, 64], [760, 78, 120, 92], [1010, 96, 104, 74], [1190, 82, 128, 88], [20, 330, 120, 90], [270, 350, 100, 70], [560, 324, 128, 96], [880, 354, 96, 66], [1100, 340, 120, 80], [1290, 344, 100, 76], [150, 584, 128, 86], [400, 596, 100, 74], [640, 580, 116, 90], [940, 600, 128, 70], [1210, 586, 96, 84]];
const Fondo = () => (
  <svg aria-hidden="true" viewBox="0 0 1440 828" preserveAspectRatio="xMidYMid slice">
    {Array.from({ length: 13 }, (_, i) => <rect key={i} x={i * 120} y="0" width="2" height="828" />)}
    {[170, 420, 670].map((y) => <rect key={y} x="0" y={y} width="1440" height="6" />)}
    {CAJAS.map(([x, y, w, h]) => <rect key={x + '-' + y} x={x + 1} y={y + 1} width={w - 2} height={h - 2} rx="3" fill="none" stroke="currentColor" strokeWidth="2" />)}
  </svg>
);

export default function Login() {
  const { login, aviso } = useSesion();
  const nav = useNavigate();
  const [email, setEmail] = useState(correoGuardado);
  const [password, setPassword] = useState('');
  const [recordar, setRecordar] = useState(() => !!correoGuardado());
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Debes ingresar correo y contraseña');
    setError(''); setEnviando(true);
    try {
      const u = await login(email.trim(), password);
      guardar(recordar ? email.trim() : ''); // solo el correo, nunca la contraseña
      nav(HOME[u.rol] ?? '/login', { replace: true });
    } catch (err) {
      setError(mensajeError(err));
    } finally { setEnviando(false); }
  }

  return (
    <div className="login">
      <header className="login-cab"><Logo /><span>Sistema de Gestión de <em>Inventario</em></span></header>
      <div className="login-fondo">
        <Fondo />
        <form className="login-tarjeta" onSubmit={enviar} noValidate>
          <h1>Iniciar sesión</h1>
          <p className="sub">Accede a tu cuenta de Comercial Oregón</p>
          <Campo etiqueta="Correo electrónico" type="email" autoComplete="username" placeholder="Ingrese su correo" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Campo etiqueta="Contraseña" type="password" autoComplete="current-password" placeholder="Ingrese su contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="zona-msg"><Alerta>{error || aviso}</Alerta></div>
          <label className="casilla"><input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />Recordar usuario</label>
          <Boton variante="primario bloque" type="submit" disabled={enviando}>{enviando ? 'Ingresando…' : 'Iniciar sesión'}</Boton>
        </form>
      </div>
    </div>
  );
}
