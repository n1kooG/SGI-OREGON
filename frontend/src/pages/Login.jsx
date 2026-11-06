import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, HOME } from '../auth.jsx';

export default function Login() {
  const { usuario, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to={HOME[usuario.rol] ?? '/'} replace />;

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const u = await login(email, password);
      nav(HOME[u.rol] ?? '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={enviar}>
        <h1>SGI Tienda Oregón</h1>
        <p className="suave">Sistema de gestión de inventario y despacho</p>

        <label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="suave pequeño">Demo: admin@ / bodega@ / chofer@tiendaoregon.cl · Demo-Oregon-2026</p>
      </form>
    </div>
  );
}
