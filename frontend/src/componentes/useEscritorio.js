import { useEffect, useState } from 'react';

const CONSULTA = '(min-width: 1024px)';

// Bodega tiene dos diseños (escritorio y móvil): el marcado cambia, no solo el CSS.
export function useEscritorio() {
  const [esc, setEsc] = useState(() => window.matchMedia(CONSULTA).matches);
  useEffect(() => {
    const m = window.matchMedia(CONSULTA);
    const f = () => setEsc(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return esc;
}
