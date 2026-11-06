import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Auditoria() {
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { api('/auditoria?limite=100').then(({ data }) => setFilas(data)).catch((e) => setError(e.message)); }, []);
  return (
    <>
      <h2>Auditoría</h2>
      {/* TODO(CU-07): filtros por usuario/acción/fecha y exportación. */}
      {error && <p className="error">{error}</p>}
      <div className="scroll"><table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Módulo</th><th>IP</th></tr></thead>
        <tbody>{filas.map((l) => (
          <tr key={l.id_log} className={l.accion.includes('DENEGADO') || l.accion.includes('FALLIDO') || l.accion.includes('BLOQUEADA') ? 'rojo' : ''}>
            <td>{new Date(l.fecha_hora).toLocaleString('es-CL')}</td><td>{l.usuario ?? '—'}</td><td>{l.rol ?? '—'}</td>
            <td>{l.accion}</td><td>{l.modulo}</td><td>{l.ip_origen}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
