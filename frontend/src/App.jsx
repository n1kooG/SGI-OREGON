import { Navigate, Outlet, Route, Routes, NavLink, useLocation } from 'react-router-dom';
import { useAuth, HOME } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Productos from './pages/Productos.jsx';
import Auditoria from './pages/Auditoria.jsx';
import Bodega from './pages/Bodega.jsx';
import Ruta from './pages/Ruta.jsx';

// Ruta protegida: exige sesión y el permiso indicado. Es solo UX; el backend aplica el control real (default deny).
function Protegida({ permiso }) {
  const { usuario, cargando, puede } = useAuth();
  const loc = useLocation();
  if (cargando) return <p className="centro">Cargando…</p>;
  if (!usuario) return <Navigate to="/login" state={{ desde: loc.pathname }} replace />;
  if (permiso && !puede(permiso)) return <Navigate to={HOME[usuario.rol] ?? '/login'} replace />;
  return <Outlet />;
}

function Shell() {
  const { usuario, logout, puede } = useAuth();
  const enlaces = [
    puede('inventario:leer') && ['/dashboard', 'Dashboard'],
    puede('catalogo:leer') && ['/productos', 'Catálogo'],
    puede('auditoria:leer') && ['/auditoria', 'Auditoría'],
    puede('inventario:consultar') && ['/bodega', 'Bodega'],
    puede('ruta:leer') && ['/ruta', 'Mi ruta'],
  ].filter(Boolean);
  return (
    <>
      <header className="top">
        <strong className="marca">SGI · Tienda Oregón</strong>
        <nav>{enlaces.map(([to, txt]) => <NavLink key={to} to={to}>{txt}</NavLink>)}</nav>
        <span className="quien">{usuario.nombre} <em>{usuario.rol}</em></span>
        <button className="sec" onClick={logout}>Salir</button>
      </header>
      <main><Outlet /></main>
    </>
  );
}

export default function App() {
  const { usuario } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protegida />}>
        <Route element={<Shell />}>
          <Route element={<Protegida permiso="inventario:leer" />}><Route path="/dashboard" element={<Dashboard />} /></Route>
          <Route element={<Protegida permiso="catalogo:leer" />}><Route path="/productos" element={<Productos />} /></Route>
          <Route element={<Protegida permiso="auditoria:leer" />}><Route path="/auditoria" element={<Auditoria />} /></Route>
          <Route element={<Protegida permiso="inventario:consultar" />}><Route path="/bodega" element={<Bodega />} /></Route>
          <Route element={<Protegida permiso="ruta:leer" />}><Route path="/ruta" element={<Ruta />} /></Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={usuario ? HOME[usuario.rol] ?? '/login' : '/login'} replace />} />
    </Routes>
  );
}
