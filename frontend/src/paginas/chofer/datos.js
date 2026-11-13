import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, mensajeError } from '../../api.js';

const cerrada = (d) => d.estado_entrega !== 'PENDIENTE';

// Cerradas primero (en el orden en que se cerraron) y luego las pendientes: así el N° de parada coincide con «3 de 8».
export const ordenar = (ruta) => [
  ...ruta.filter(cerrada).sort((a, b) => new Date(a.fecha_cierre) - new Date(b.fecha_cierre)),
  ...ruta.filter((d) => !cerrada(d)),
];

// Pantalla ancha (escritorio e iPad horizontal): barra lateral y maestro-detalle; por debajo, el diseño móvil.
const ANCHA = '(min-width: 1024px)';
export const useAncho = () => useSyncExternalStore(
  (cb) => { const m = window.matchMedia(ANCHA); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
  () => window.matchMedia(ANCHA).matches,
);

export const unidades = (n) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`;
export const hora = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
export const fechaLarga = (d, anio = false) => d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', ...(anio && { year: 'numeric' }) }).replace(',', '');
export const diaMes = (f) => `${f.slice(8, 10)}-${f.slice(5, 7)}`; // 'AAAA-MM-DD' → 'dd-mm'
export const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).replaceAll('/', '-');
export const direccion = (d) => d.direccion_despacho || 'Sin dirección registrada';
export const mapaUrl = (d) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.direccion_despacho, d.comuna].filter(Boolean).join(', '))}`;
export const telUrl = (d) => (d.telefono_contacto ? `tel:${d.telefono_contacto.replace(/[^\d+]/g, '')}` : null);

// La hoja de ruta y el historial no traen la causal: se pide el detalle de cada rechazo una sola vez y se recuerda.
const causales = new Map();
export function useCausales(paradas) {
  const [, forzar] = useState(0);
  useEffect(() => {
    let vivo = true;
    for (const d of paradas ?? []) {
      if (d.estado_entrega !== 'RECHAZADO' || causales.has(d.id_despacho)) continue;
      causales.set(d.id_despacho, null);
      api(`/despachos/${d.id_despacho}`).then(({ data }) => { causales.set(d.id_despacho, data.motivo_rechazo); vivo && forzar((n) => n + 1); })
        .catch(() => causales.delete(d.id_despacho));
    }
    return () => { vivo = false; };
  }, [paradas]);
  return (d) => causales.get(d.id_despacho) ?? null;
}

// Hoja de ruta + conteos; se vuelve a pedir al regresar a la pestaña (el chofer cambia de app para navegar).
// `paradas` es la jornada de hoy; las de fecha futura (reprogramadas) van aparte en `futuras`, sin acciones.
export function useRuta(omitir = false) {
  const [e, setE] = useState({ paradas: null, futuras: [], resumen: null, error: '', actualizada: null, cargando: !omitir });
  const cargar = useCallback(async () => {
    setE((p) => ({ ...p, cargando: true }));
    try {
      const [r, s] = await Promise.all([api('/despachos/mi-ruta'), api('/despachos/mi-ruta/resumen')]);
      const todas = ordenar(r.data);
      setE({ paradas: todas.filter((d) => !d.futura), futuras: todas.filter((d) => d.futura), resumen: s.data, error: '', actualizada: new Date(), cargando: false });
    } catch (err) {
      setE((p) => ({ ...p, error: mensajeError(err), cargando: false, paradas: p.paradas ?? [] }));
    }
  }, []);
  useEffect(() => {
    if (omitir) return undefined;
    cargar();
    const alVolver = () => document.visibilityState === 'visible' && cargar();
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [cargar, omitir]);
  return { ...e, cargar };
}

// Una parada con su posición en la ruta (la posición solo existe mientras sigue en la hoja de hoy).
export function useParada(id, rutaExterna) {
  const propia = useRuta(!!rutaExterna);
  const ruta = rutaExterna ?? propia;
  const [parada, setParada] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setParada(null); setError('');
    api(`/despachos/${id}`).then(({ data }) => setParada(data)).catch((e) => setError(mensajeError(e)));
  }, [id]);
  const i = ruta.paradas?.findIndex((d) => String(d.id_despacho) === String(id)) ?? -1;
  return { parada, error, n: i >= 0 ? i + 1 : null, total: ruta.paradas?.length ?? null };
}

// Ubicación opcional: arranca al abrir la pantalla con tope corto y deja a la vista en qué estado va.
const ESPERA_UBICACION = 5000;
export function useUbicacion() {
  const [estado, setEstado] = useState('buscando'); // buscando | lista | sin
  const promesa = useRef(null);
  if (!promesa.current) {
    promesa.current = new Promise((ok) => {
      if (!navigator.geolocation) return ok(null);
      navigator.geolocation.getCurrentPosition((p) => ok(p.coords), () => ok(null), { timeout: ESPERA_UBICACION, maximumAge: 60000 });
    });
  }
  useEffect(() => { promesa.current.then((c) => setEstado(c ? 'lista' : 'sin')); }, []);
  return { estado, esperar: () => promesa.current };
}

const MAX_FOTO = 5 * 1024 * 1024;
export const validarFoto = (f) => (f && f.size > MAX_FOTO ? 'La foto supera 5 MB. Toma otra con menor resolución.' : '');

// Cierre definitivo de una parada. Si el servidor dice que ya estaba cerrada o no es del chofer (409/404), se vuelve a la ruta.
export function useCierre({ parada, ubicacion, alTerminar }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  async function enviar(estado, { motivo, receptor, firma, foto }) {
    setError(''); setOcupado(true);
    const pos = await ubicacion.esperar();
    const f = new FormData();
    f.append('estado', estado);
    if (motivo) f.append('motivo', motivo);
    if (receptor) f.append('nombre_receptor', receptor);
    if (pos) { f.append('latitud', pos.latitude); f.append('longitud', pos.longitude); }
    if (firma) f.append('firma', firma, 'firma.png');
    if (foto) f.append('foto', foto);
    try {
      const { data } = await api(`/despachos/${parada.id_despacho}`, { metodo: 'PATCH', cuerpo: f });
      const notas = [!pos && 'sin ubicación (permiso denegado o no disponible)', foto && !data.evidencia && 'la foto no se guardó (almacenamiento desactivado)', firma && !data.firma && 'la firma no se guardó (almacenamiento desactivado)'].filter(Boolean);
      alTerminar(`${estado === 'RECHAZADO' ? 'Rechazo' : 'Entrega'} registrado${notas.length ? `; ${notas.join('; ')}` : ''}.`);
    } catch (err) {
      const caducada = (err.status === 409 && err.codigo !== 'FUERA_DE_FECHA') || err.status === 404;
      setError(caducada ? `${err.message}. Se actualizará tu ruta.` : mensajeError(err));
      if (caducada) setTimeout(() => alTerminar(null), 1500);
      setOcupado(false);
    }
  }
  return { ocupado, error, setError, enviar };
}
