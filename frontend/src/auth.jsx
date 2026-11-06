import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, token } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Interfaz inicial por rol (la autorización real siempre se valida en el backend).
export const HOME = { ADMINISTRADOR: '/dashboard', BODEGA: '/bodega', CHOFER: '/ruta' };

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(!!token.get());

  useEffect(() => {
    if (!token.get()) return;
    api('/auth/me').then(({ data }) => setUsuario(data)).catch(() => token.clear()).finally(() => setCargando(false));
  }, []);

  const login = useCallback(async (email, password, rol) => {
    const { data } = await api('/auth/login', { metodo: 'POST', cuerpo: { email, password, rol } });
    token.set(data.token);
    setUsuario(data.usuario);
    return data.usuario;
  }, []);

  const logout = useCallback(() => { token.clear(); setUsuario(null); }, []);
  const puede = useCallback((permiso) => !!usuario?.permisos?.includes(permiso), [usuario]);

  return <AuthCtx.Provider value={{ usuario, cargando, login, logout, puede }}>{children}</AuthCtx.Provider>;
}
