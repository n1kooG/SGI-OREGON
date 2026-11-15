import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSesion } from '../sesion.jsx';
import { Boton, Icono, Logo } from './ui.jsx';
import MiCuenta from './MiCuenta.jsx';
import { useEscritorio } from './useEscritorio.js';
import '../paginas/bodega.css';

export const ROL = { ADMINISTRADOR: 'Administrador', BODEGA: 'Bodega', CHOFER: 'Chofer' };

// Panel de oficina: menú del diseño aprobado.
const ITEMS = [['/dashboard', 'Dashboard General', 'panel'], ['/catalogo', 'Catálogo Maestro', 'caja'], ['/bodega-estructura', 'Bodega', 'casa'], ['/compras', 'Compras y Facturas', 'factura'], ['/importacion', 'Carga Masiva', 'subir'], ['/pedidos', 'Pedidos y Despachos', 'camion'], ['/auditoria', 'Reportes y Auditoría', 'escudo'], ['/usuarios', 'Usuarios y Roles', 'usuarios']];

export function Oficina() {
  const { usuario, logout } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const [cuenta, setCuenta] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setAbierto(false), [pathname]);
  return (
    <div className="oficina">
      <header className="topbar-movil">
        <Boton className="icono-solo" aria-label="Abrir menú" onClick={() => setAbierto(true)}><Icono n="menu" /></Boton>
        <strong>Tienda Oregón</strong>
      </header>
      <aside className={`sidebar ${abierto ? 'abierto' : ''}`} aria-label="Navegación principal">
        <Link to="/dashboard" className="marca"><Logo /><span><strong>Tienda Oregón</strong><small>SGI · Módulo Jefatura</small></span></Link>
        <nav className="nav">
          {ITEMS.map(([to, txt, ic]) => <NavLink key={to} to={to}><Icono n={ic} />{txt}</NavLink>)}
        </nav>
        <div className="pie-usuario">
          <button type="button" className="abrir-cuenta" aria-label="Mi cuenta" onClick={() => setCuenta(true)}>
            <strong>{usuario.nombre}</strong>
            <span className="rol">{ROL[usuario.rol] ?? usuario.rol}</span>
          </button>
          <button type="button" onClick={logout}><Icono n="salir" />Salir del sistema</button>
        </div>
      </aside>
      <div className="velo-nav" onClick={() => setAbierto(false)} />
      <main className="contenido"><Outlet /></main>
      {cuenta && <MiCuenta onClose={() => setCuenta(false)} />}
    </div>
  );
}

export function Bienvenida({ texto }) {
  const { usuario } = useSesion();
  return (
    <section className="bienvenida">
      <span className="etiqueta">Bienvenido</span>
      <h1>{usuario.nombre}</h1>
      <span className="badge">{ROL[usuario.rol] ?? usuario.rol}</span>
      <hr />
      <p className="tenue">{texto}</p>
    </section>
  );
}

// Con `inicio` (Bodega) el logo es un enlace al inicio y la cuenta se abre con su propio botón; sin él (Chofer) el logo abre la cuenta.
function CabMovil({ panel, inicio }) {
  const { logout } = useSesion();
  const [cuenta, setCuenta] = useState(false);
  return (
    <header className="movil-cab">
      {inicio ? (
        <Link to={inicio} className="quien marca-movil"><Logo /><span><strong>Tienda Oregón</strong><small>{panel}</small></span></Link>
      ) : (
        <>
          <Logo />
          <button type="button" className="quien abrir-cuenta" aria-label="Mi cuenta" onClick={() => setCuenta(true)}><strong>Tienda Oregón</strong><small>{panel}</small></button>
        </>
      )}
      {inicio && <Boton icono="persona" onClick={() => setCuenta(true)}>Cuenta</Boton>}
      <Boton icono="salir" onClick={logout}>Salir</Boton>
      {cuenta && <MiCuenta onClose={() => setCuenta(false)} />}
    </header>
  );
}

// Chofer: móvil, sin navegación inferior (una sola pantalla).
export function Movil({ panel, children }) {
  return <div className="movil"><CabMovil panel={panel} /><main>{children}</main></div>;
}

// Bodega en pantallas anchas: misma barra lateral fija que la oficina; solo el contenido hace scroll.
function EscritorioBodega() {
  const { usuario, logout } = useSesion();
  const [cuenta, setCuenta] = useState(false);
  return (
    <div className="oficina bodega-esc">
      <aside className="sidebar" aria-label="Navegación de bodega">
        <Link to="/bodega" className="marca"><Logo /><span><strong>Tienda Oregón</strong><small>SGI · Panel bodega</small></span></Link>
        <nav className="nav">
          <NavLink to="/bodega" end><Icono n="casa" />Inicio</NavLink>
          <NavLink to="/bodega/buscador"><Icono n="search" />Buscador</NavLink>
          <NavLink to="/bodega/pedidos"><Icono n="lista" />Pedidos</NavLink>
          <NavLink to="/bodega/descarga"><Icono n="camion" />Descarga</NavLink>
        </nav>
        <div className="pie-usuario">
          <strong>{usuario.nombre}</strong>
          <span className="rol">{ROL[usuario.rol] ?? usuario.rol}</span>
          <button type="button" className="btn-cuenta" onClick={() => setCuenta(true)}><Icono n="persona" />Cuenta</button>
          <button type="button" onClick={logout}><Icono n="salir" />Salir del sistema</button>
        </div>
      </aside>
      <main className="contenido"><Outlet /></main>
      {cuenta && <MiCuenta onClose={() => setCuenta(false)} />}
    </div>
  );
}

// Bodega: cabecera + contenido + navegación inferior (Inicio, Buscador, Pedidos y Descarga).
export function MovilBodega() {
  const escritorio = useEscritorio();
  if (escritorio) return <EscritorioBodega />;
  return (
    <div className="movil con-nav bodega">
      <CabMovil panel="Panel bodega" inicio="/bodega" />
      <main><Outlet /></main>
      <nav className="nav-inferior" aria-label="Navegación de bodega">
        <NavLink to="/bodega" end><Icono n="casa" />Inicio</NavLink>
        <NavLink to="/bodega/buscador"><Icono n="search" />Buscador</NavLink>
        <NavLink to="/bodega/pedidos"><Icono n="lista" />Pedidos</NavLink>
        <NavLink to="/bodega/descarga"><Icono n="camion" />Descarga</NavLink>
      </nav>
    </div>
  );
}
