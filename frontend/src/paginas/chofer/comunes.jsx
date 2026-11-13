import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '../chofer.css';
import { useSesion } from '../../sesion.jsx';
import { Logo } from '../../componentes/ui.jsx';
import MiCuenta from '../../componentes/MiCuenta.jsx';
import NavChofer, { LateralChofer } from '../../componentes/NavChofer.jsx';
import { Ico } from './iconos.jsx';

// Cabecera móvil: el logo con el título lleva al Inicio; «Cuenta» y «Salir» son botones aparte.
function CabChofer({ abrirCuenta }) {
  const { logout } = useSesion();
  return (
    <header className="ch-cab">
      <Link to="/chofer" className="ch-cab-marca"><Logo /><span><strong>Tienda Oregón</strong><small>Chofer</small></span></Link>
      <button type="button" className="ch-cab-btn" onClick={abrirCuenta}><Ico n="cuenta" t={18} />Cuenta</button>
      <button type="button" className="ch-cab-btn" onClick={logout}><Ico n="salir" t={18} />Salir</button>
    </header>
  );
}

// Marco único del chofer: barra lateral fija en pantallas anchas; en móvil, cabecera y navegación inferior
// (esta solo en las pantallas de lista; detalle, entrega y rechazo llevan su propia barra de acciones).
const CON_NAV = ['/chofer', '/chofer/ruta', '/chofer/historial'];
export function LayoutChofer() {
  const [cuenta, setCuenta] = useState(false);
  const { pathname } = useLocation();
  const conNav = CON_NAV.includes(pathname.replace(/\/$/, ''));
  return (
    <div className="movil ch-app">
      <LateralChofer abrirCuenta={() => setCuenta(true)} />
      <CabChofer abrirCuenta={() => setCuenta(true)} />
      <main className="ch-principal"><div className={`ch ${conNav ? 'con-nav' : ''}`}><Outlet /></div></main>
      {conNav && <NavChofer />}
      {cuenta && <MiCuenta onClose={() => setCuenta(false)} />}
    </div>
  );
}

export const Volver = ({ a, children }) => <div className="ch-volver"><Link to={a}><Ico n="atras" t={24} />{children}</Link></div>;

export const Estado = ({ tono, children }) => <span className={`ch-badge ${tono}`}><i />{children}</span>;
export const Orden = ({ children }) => <span className="ch-orden">{children}</span>;

export const Titulo = ({ h, sub }) => <div className="ch-titulo"><h1>{h}</h1>{sub && <p>{sub}</p>}</div>;

export const Aviso = ({ children }) => children ? <div className="ch-alerta" role="alert"><Ico n="aviso" t={22} /><span>{children}</span></div> : null;

export const BarraAcciones = ({ children }) => <div className="ch-acciones">{children}</div>;

export const TONO = { ENTREGADO: ['ok', 'Entregado'], RECHAZADO: ['mal', 'Rechazado'], PENDIENTE: ['aviso', 'Pendiente'] };
