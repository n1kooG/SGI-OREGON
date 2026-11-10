import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useSesion, HOME } from './sesion.jsx';
import { Bienvenida, Movil, MovilBodega, Oficina } from './componentes/Layouts.jsx';
import Login from './paginas/Login.jsx';
import Inicio from './paginas/Inicio.jsx';
import Catalogo from './paginas/Catalogo.jsx';
import Usuarios from './paginas/Usuarios.jsx';
import Recepcion from './paginas/Recepcion.jsx';
import Importacion from './paginas/Importacion.jsx';
import Descarga from './paginas/Descarga.jsx';
import Pedidos from './paginas/Pedidos.jsx';
import BodegaBuscador from './paginas/BodegaBuscador.jsx';
import BodegaPedidos from './paginas/BodegaPedidos.jsx';
import ChoferRuta from './paginas/ChoferRuta.jsx';

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
          <Route path="/dashboard" element={<Inicio />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/compras" element={<Recepcion />} />
          <Route path="/importacion" element={<Importacion />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/usuarios" element={<Usuarios />} />
        </Route>
      </Route>
      <Route element={<Protegida rol="BODEGA" />}>
        <Route element={<MovilBodega />}>
          <Route path="/bodega" element={<Bienvenida texto="Desde Descarga confirmas el camión contra la factura. Con el buscador consultas stock y ubicación, y en Pedidos preparas lo que sale a reparto." />} />
          <Route path="/bodega/descarga" element={<Descarga />} />
          <Route path="/bodega/buscador" element={<BodegaBuscador />} />
          <Route path="/bodega/pedidos" element={<BodegaPedidos />} />
        </Route>
      </Route>
      <Route element={<Protegida rol="CHOFER" />}>
        <Route path="/ruta" element={<Movil panel="Chofer: distribución terreno"><ChoferRuta /></Movil>} />
      </Route>
      <Route path="*" element={cargando ? null : <Navigate to={usuario ? HOME[usuario.rol] ?? '/login' : '/login'} replace />} />
    </Routes>
  );
}
