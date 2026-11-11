import { Link, Outlet } from 'react-router-dom';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '../chofer.css';
import { Movil } from '../../componentes/Layouts.jsx';
import NavChofer from '../../componentes/NavChofer.jsx';
import { Ico } from './iconos.jsx';

const PANEL = 'Chofer: distribución terreno';

// Pantallas de lista: cabecera móvil + contenido + navegación inferior.
export const ConNav = () => <Movil panel={PANEL}><div className="ch con-nav"><Outlet /></div><NavChofer /></Movil>;
// Pantallas de una parada (detalle, entrega, rechazo): sin navegación inferior, con su barra de acciones.
export const SinNav = () => <Movil panel={PANEL}><div className="ch"><Outlet /></div></Movil>;

export const Volver = ({ a, children }) => <div className="ch-volver"><Link to={a}><Ico n="atras" t={24} />{children}</Link></div>;

export const Estado = ({ tono, children }) => <span className={`ch-badge ${tono}`}><i />{children}</span>;
export const Orden = ({ children }) => <span className="ch-orden">{children}</span>;

export const Titulo = ({ h, sub }) => <div className="ch-titulo"><h1>{h}</h1>{sub && <p>{sub}</p>}</div>;

export const Aviso = ({ children }) => children ? <div className="ch-alerta" role="alert"><Ico n="aviso" t={22} /><span>{children}</span></div> : null;

export const BarraAcciones = ({ children }) => <div className="ch-acciones">{children}</div>;

export const TONO = { ENTREGADO: ['ok', 'Entregado'], RECHAZADO: ['mal', 'Rechazado'], PENDIENTE: ['aviso', 'Pendiente'] };
