import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useSesion, HOME } from './sesion.jsx';
import { MovilBodega, Oficina } from './componentes/Layouts.jsx';
import Login from './paginas/Login.jsx';
import Dashboard from './paginas/Dashboard.jsx';
import Auditoria from './paginas/Auditoria.jsx';
import Catalogo from './paginas/Catalogo.jsx';
import Usuarios from './paginas/Usuarios.jsx';
import Recepcion from './paginas/Recepcion.jsx';
import Importacion from './paginas/Importacion.jsx';
import BodegaInicio from './paginas/BodegaInicio.jsx';
import Descarga from './paginas/Descarga.jsx';
import Pedidos from './paginas/Pedidos.jsx';
import BodegaBuscador from './paginas/BodegaBuscador.jsx';
import BodegaPedidos from './paginas/BodegaPedidos.jsx';
import BodegaRechazados from './paginas/BodegaRechazados.jsx';
import { ConNav, SinNav } from './paginas/chofer/comunes.jsx';
import ChoferInicio from './paginas/chofer/Inicio.jsx';
import ChoferRuta from './paginas/chofer/Ruta.jsx';
import ChoferDetalle from './paginas/chofer/Detalle.jsx';
import ChoferEntrega from './paginas/chofer/Entrega.jsx';
import ChoferRechazo from './paginas/chofer/Rechazo.jsx';
import ChoferHistorial from './paginas/chofer/Historial.jsx';

// Ruta protegida por rol: es solo UX; el backend aplica el control real (denegación por defecto).
function Protegida({ rol }) {
  const { usuario, cargando } = useSesion();
  const loc = useLocation();
  if (cargando) return <p className="vacio">Cargando…</p>;
  if (!usuario) return <Navigate to="/login" state={{ desde: loc.pathname }} replace />;
  if (usuario.rol !== rol) return <Navigate to={HOME[usuario.rol] ?? '/login'} replace />;
  return <Outlet />;
}

export default function App() {
  const { usuario, cargando } = useSesion();
  return (
    <Routes>
      <Route path="/login" element={usuario ? <Navigate to={HOME[usuario.rol] ?? '/login'} replace /> : <Login />} />
      <Route element={<Protegida rol="ADMINISTRADOR" />}>
        <Route element={<Oficina />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/compras" element={<Recepcion />} />
          <Route path="/importacion" element={<Importacion />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/usuarios" element={<Usuarios />} />
        </Route>
      </Route>
      <Route element={<Protegida rol="BODEGA" />}>
        <Route element={<MovilBodega />}>
          <Route path="/bodega" element={<BodegaInicio />} />
          <Route path="/bodega/descarga" element={<Descarga />} />
          <Route path="/bodega/buscador" element={<BodegaBuscador />} />
          <Route path="/bodega/pedidos" element={<BodegaPedidos />} />
          <Route path="/bodega/pedidos/rechazados" element={<BodegaRechazados />} />
        </Route>
      </Route>
      <Route element={<Protegida rol="CHOFER" />}>
        <Route element={<ConNav />}>
          <Route path="/chofer" element={<ChoferInicio />} />
          <Route path="/chofer/ruta" element={<ChoferRuta />} />
          <Route path="/chofer/historial" element={<ChoferHistorial />} />
        </Route>
        <Route element={<SinNav />}>
          <Route path="/chofer/ruta/:id" element={<ChoferDetalle />} />
          <Route path="/chofer/ruta/:id/entrega" element={<ChoferEntrega />} />
          <Route path="/chofer/ruta/:id/rechazo" element={<ChoferRechazo />} />
        </Route>
        <Route path="/ruta" element={<Navigate to="/chofer/ruta" replace />} />
      </Route>
      <Route path="*" element={cargando ? null : <Navigate to={usuario ? HOME[usuario.rol] ?? '/login' : '/login'} replace />} />
    </Routes>
  );
}
