// Cliente HTTP mínimo. TODO(seguridad): el token vive en sessionStorage (se borra al cerrar la pestaña);
// evaluar cookie httpOnly + CSRF antes de producción.
const KEY = 'sgi_token';
export const token = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t) => { try { sessionStorage.setItem(KEY, t); } catch { /* sin almacenamiento */ } },
  clear: () => { try { sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } },
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const t = token.get();
  const res = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(t && { Authorization: `Bearer ${t}` }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Error de comunicación con el servidor');
  return { data, cache: res.headers.get('X-Cache') };
}
