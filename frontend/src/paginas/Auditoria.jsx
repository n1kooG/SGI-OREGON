import { useEffect, useState } from 'react';
import { api, ApiError, mensajeError, token } from '../api.js';
import { Alerta, Boton, Campo, Tabla, useAviso } from '../componentes/ui.jsx';

const fmt = (f) => new Date(f).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
const ROLES = { ADMINISTRADOR: 'Administrador', BODEGA: 'Bodega', CHOFER: 'Chofer' };

export default function Auditoria() {
  const aviso = useAviso();
  const [filtros, setFiltros] = useState({ usuario: '', accion: '', desde: '', hasta: '' });
  const [opciones, setOpciones] = useState({ usuarios: [], acciones: [] });
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState('');
  const set = (k) => (e) => setFiltros((f) => ({ ...f, [k]: e.target.value }));
  const q = (extra = {}) => new URLSearchParams(Object.entries({ ...filtros, ...extra }).filter(([, v]) => v));

  useEffect(() => { api('/auditoria/filtros').then(({ data }) => setOpciones(data)).catch((e) => setError(mensajeError(e))); }, []);

  useEffect(() => {
    let vigente = true;
    setError('');
    api(`/auditoria?${q({ limite: 200 })}`)
      .then(({ data }) => vigente && setFilas(data))
      .catch((e) => { if (vigente) { setError(mensajeError(e)); setFilas([]); } });
    return () => { vigente = false; };
  }, [filtros]); // eslint-disable-line react-hooks/exhaustive-deps

  // fetch + blob: la descarga necesita el token, que un enlace directo no envía.
  async function exportar(formato) {
    setExportando(formato); setError('');
    try {
      const res = await fetch(`/api/auditoria/exportar?${q({ formato })}`, { headers: { Authorization: `Bearer ${token.get()}` } });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new ApiError(res.status, d?.error ?? (res.status === 403 ? 'No tienes permiso para esta operación' : 'No se pudo exportar'), d?.codigo);
      }
      const nombre = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `bitacora.${formato}`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: nombre });
      a.click();
      URL.revokeObjectURL(a.href);
      aviso(`Bitácora exportada: ${nombre}`);
    } catch (e) { setError(mensajeError(e)); } finally { setExportando(''); }
  }

  return (
    <>
      <div className="cabecera">
        <div>
          <h1>Reportes y Bitácora de Auditoría</h1>
          <p>Cumplimiento de la tríada CIA: trazabilidad inmutable de todas las acciones del sistema.</p>
        </div>
        <div className="acciones-cab">
          <Boton disabled={!!exportando} onClick={() => exportar('xlsx')}>{exportando === 'xlsx' ? 'Exportando…' : 'Exportar Excel'}</Boton>
          <Boton disabled={!!exportando} onClick={() => exportar('pdf')}>{exportando === 'pdf' ? 'Exportando…' : 'Exportar PDF'}</Boton>
        </div>
      </div>
      <div className="filtros-aud">
        <Campo como="select" etiqueta="Usuario" value={filtros.usuario} onChange={set('usuario')}>
          <option value="">Todos</option>
          {opciones.usuarios.map((u) => <option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>)}
        </Campo>
        <Campo como="select" etiqueta="Acción" value={filtros.accion} onChange={set('accion')}>
          <option value="">Todas</option>
          {opciones.acciones.map((a) => <option key={a}>{a}</option>)}
        </Campo>
        <Campo type="date" etiqueta="Desde" value={filtros.desde} max={filtros.hasta || undefined} onChange={set('desde')} />
        <Campo type="date" etiqueta="Hasta" value={filtros.hasta} min={filtros.desde || undefined} onChange={set('hasta')} />
      </div>
      <Alerta>{error}</Alerta>
      <Tabla
        columnas={['Fecha / Hora', 'Usuario', 'Rol', 'Acción ejecutada', 'Módulo', 'IP origen']}
        vacio={!filas ? 'Cargando…' : !filas.length && !error ? 'No hay registros con esos filtros.' : null}
      >
        {filas?.map((r) => (
          <tr key={r.id_log}>
            <td className="dato">{fmt(r.fecha_hora)}</td>
            <td>{r.usuario ?? 'Sistema'}</td>
            <td>{ROLES[r.rol] ?? r.rol ?? '—'}</td>
            <td>{r.accion}</td>
            <td className="dato">{r.modulo}</td>
            <td className="dato">{r.ip_origen ?? '—'}</td>
          </tr>
        ))}
      </Tabla>
      <p className="nota-aud">Los registros no se pueden modificar ni borrar.</p>
    </>
  );
}
