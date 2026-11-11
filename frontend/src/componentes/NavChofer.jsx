import { NavLink } from 'react-router-dom';
import { Ico } from '../paginas/chofer/iconos.jsx';

// Navegación inferior del chofer: Inicio, Ruta e Historial.
export default function NavChofer() {
  return (
    <nav className="nav-inferior ch-nav" aria-label="Navegación del chofer">
      <NavLink to="/chofer" end><Ico n="casa" t={24} />Inicio</NavLink>
      <NavLink to="/chofer/ruta"><Ico n="mapa" t={24} />Ruta</NavLink>
      <NavLink to="/chofer/historial"><Ico n="reloj" t={24} />Historial</NavLink>
    </nav>
  );
}
