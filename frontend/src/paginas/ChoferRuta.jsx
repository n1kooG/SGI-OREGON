import { useCallback, useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Icono, useAviso } from '../componentes/ui.jsx';

const MAX_FOTO = 5 * 1024 * 1024;
const mapa = (d) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.direccion_despacho, d.comuna].filter(Boolean).join(', '))}`;

// Ubicación opcional: si el permiso se niega o tarda, el cierre sigue sin coordenadas (el backend las acepta ausentes).
const ubicar = () => new Promise((ok) => {
  if (!navigator.geolocation) return ok(null);
  navigator.geolocation.getCurrentPosition((p) => ok(p.coords), () => ok(null), { timeout: 8000, maximumAge: 60000 });
});

function Cierre({ parada, n, estado, onVolver, onHecho }) {
  const aviso = useAviso();
  const rechazo = estado === 'RECHAZADO';
  const [motivo, setMotivo] = useState('');
  const [foto, setFoto] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function elegirFoto(e) {
    const f = e.target.files[0];
    if (f && f.size > MAX_FOTO) { setError('La foto supera 5 MB. Toma otra con menor resolución.'); e.target.value = ''; return; }
    setError(''); setFoto(f ?? null);
  }

  async function confirmar(e) {
    e.preventDefault();
    if (rechazo && !motivo.trim()) { setError('El rechazo exige una causal.'); return; }
    setError(''); setOcupado(true);
    const pos = await ubicar();
    const f = new FormData();
    f.append('estado', estado);
    if (motivo.trim()) f.append('motivo', motivo.trim());
    if (pos) { f.append('latitud', pos.latitude); f.append('longitud', pos.longitude); }
    if (foto) f.append('foto', foto);
    try {
      const { data } = await api(`/despachos/${parada.id_despacho}`, { metodo: 'PATCH', cuerpo: f });
      aviso(`${rechazo ? 'Rechazo' : 'Entrega'} registrado${pos ? '' : ' sin ubicación (permiso denegado o no disponible)'}${foto && !data.evidencia ? '; la foto no se guardó (almacenamiento desactivado)' : ''}.`);
      onHecho();
    } catch (err) {
      setError(err.status === 409 || err.status === 404 ? `${err.message}. Se actualizará tu ruta.` : mensajeError(err));
      if (err.status === 409 || err.status === 404) setTimeout(onHecho, 1500);
      setOcupado(false);
    }
  }

  return (
    <form className="movil-pagina cierre" onSubmit={confirmar}>
      <h1>{rechazo ? 'Rechazar entrega' : 'Confirmar entrega'}</h1>
      <p className="tenue">Parada {n} · Orden #{parada.codigo_externo} · {parada.nombre_cliente}</p>
      {rechazo && <Campo como="textarea" etiqueta="Causal del rechazo *" rows={5} maxLength={300} placeholder="Describa el motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      <div className="campo foto-cierre">
        <span className="rotulo">Foto de evidencia (opcional)</span>
        <label className="btn bloque-sm" style={{ height: 48 }}>
          {foto ? foto.name : 'Adjuntar foto'}
          <input type="file" accept="image/jpeg,image/png" capture="environment" className="solo-lectores" onChange={elegirFoto} />
        </label>
      </div>
      <p className="tenue">{rechazo ? 'La causal es obligatoria. ' : ''}La foto, la hora y la ubicación del dispositivo quedan en la bitácora. Si no das permiso de ubicación, el cierre se registra igual sin ella.</p>
      <Alerta>{error}</Alerta>
      <div className="cierre-pie">
        <Boton type="submit" variante={`bloque ${rechazo ? 'peligro' : 'primario'}`} disabled={ocupado}>{ocupado ? 'Registrando…' : rechazo ? 'Confirmar rechazo' : 'Confirmar entrega'}</Boton>
        <Boton className="enlace" onClick={onVolver} disabled={ocupado}>Cancelar</Boton>
      </div>
    </form>
  );
}

export default function ChoferRuta() {
  const [ruta, setRuta] = useState(null);
  const [error, setError] = useState('');
  const [cierre, setCierre] = useState(null); // { parada, estado }
  const cargar = useCallback(async () => {
    try { setRuta((await api('/despachos/mi-ruta')).data); setError(''); } catch (e) { setError(mensajeError(e)); setRuta((r) => r ?? []); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  if (cierre) return <Cierre {...cierre} onVolver={() => setCierre(null)} onHecho={() => { setCierre(null); cargar(); }} />;

  const pendientes = (ruta ?? []).filter((d) => d.estado_entrega === 'PENDIENTE').length;
  return (
    <div className="movil-pagina ruta-chofer">
      <div className="cab-pagina"><div className="fila-sb"><h1>Ruta de reparto diaria</h1><Badge tono="ink">{pendientes} {pendientes === 1 ? 'parada pendiente' : 'paradas pendientes'}</Badge></div></div>
      <Alerta>{error}</Alerta>
      {ruta && !ruta.length && !error && <p className="vacio">No tienes entregas asignadas.</p>}
      {ruta?.map((d, i) => {
        const abierta = d.estado_entrega === 'PENDIENTE';
        return (
          <article className="tarjeta-pedido parada" key={d.id_despacho}>
            <div className="fila-sb">
              <span className="chip-sku">Parada {i + 1} · Orden #{d.codigo_externo}</span>
              <Badge tono={abierta ? 'aviso' : d.estado_entrega === 'ENTREGADO' ? 'ok' : 'mal'}>{abierta ? 'Pendiente' : d.estado_entrega === 'ENTREGADO' ? 'Entregado' : 'Rechazado'}</Badge>
            </div>
            <strong>{d.nombre_cliente}</strong>
            <p className="dato-fila"><Icono n="pin" />{[d.direccion_despacho, d.comuna].filter(Boolean).join(', ') || 'Sin dirección registrada'}</p>
            <p className="dato-fila"><Icono n="tel" />{d.telefono_contacto ? <a href={`tel:${d.telefono_contacto.replace(/[^\d+]/g, '')}`}>{d.telefono_contacto}</a> : 'Sin teléfono'}{'  ·  '}Bultos: {d.bultos}</p>
            {abierta && (
              <>
                <a className="btn bloque-sm" href={mapa(d)} target="_blank" rel="noopener noreferrer">Abrir mapa</a>
                <div className="botones-cierre">
                  <Boton variante="primario" onClick={() => setCierre({ parada: d, n: i + 1, estado: 'ENTREGADO' })}>Entregado</Boton>
                  <Boton variante="peligro" onClick={() => setCierre({ parada: d, n: i + 1, estado: 'RECHAZADO' })}>Rechazado</Boton>
                </div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
