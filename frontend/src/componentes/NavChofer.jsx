import { Link, NavLink } from 'react-router-dom';
import { useSesion } from '../sesion.jsx';
import { Logo } from './ui.jsx';
import { Ico } from '../paginas/chofer/iconos.jsx';

// Navegación inferior del chofer en móvil: Inicio, Ruta e Historial.
export default function NavChofer() {
  return (
    <nav className="nav-inferior ch-nav" aria-label="Navegación del chofer">
      <NavLink to="/chofer" end><Ico n="casa" t={24} />Inicio</NavLink>
      <NavLink to="/chofer/ruta"><Ico n="mapa" t={24} />Ruta</NavLink>
      <NavLink to="/chofer/historial"><Ico n="reloj" t={24} />Historial</NavLink>
    </nav>
  );
}

// Barra lateral fija del chofer en pantallas anchas. El bloque de marca lleva al Inicio; «Cuenta» abre Mi cuenta.
export function LateralChofer({ abrirCuenta }) {
  const { usuario, logout } = useSesion();
  return (
    <aside className="ch-lateral" aria-label="Navegación principal">
      <Link to="/chofer" className="ch-marca"><Logo /><span><strong>Tienda Oregón</strong><small>SGI · Módulo Chofer</small></span></Link>
      <nav className="ch-menu">
        <NavLink to="/chofer" end><Ico n="casa" t={20} />Inicio</NavLink>
        <NavLink to="/chofer/ruta"><Ico n="ruta" t={20} />Ruta</NavLink>
        <NavLink to="/chofer/historial"><Ico n="reloj" t={20} />Historial</NavLink>
      </nav>
      <div className="ch-pie-lateral">
        <strong>{usuario.nombre}</strong>
        <span>Chofer · distribución terreno</span>
        <button type="button" className="ch-cuenta" onClick={abrirCuenta}><Ico n="cuenta" t={18} />Cuenta</button>
        <button type="button" className="ch-salir" onClick={logout}><Ico n="salir" t={16} />Salir del sistema</button>
      </div>
    </aside>
  );
}
