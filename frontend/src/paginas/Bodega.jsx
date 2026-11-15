import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensajeError } from '../api.js';
import { Alerta, Boton, Campo, Modal, useAviso } from '../componentes/ui.jsx';
import '../estilos/sprint1.css';
import './bodega-estructura.css';

const LETRAS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const Pisos = ({ rack, bloqueado, onCambiar }) => (
  <div className="pisos-ctl" role="group" aria-label={`Pisos del rack ${rack.letra}`}>
    <button type="button" aria-label={`Quitar un piso al rack ${rack.letra}`} disabled={bloqueado || rack.pisos <= 1} onClick={() => onCambiar(rack.pisos - 1)}>−</button>
    <output>{rack.pisos}</output>
    <button type="button" aria-label={`Agregar un piso al rack ${rack.letra}`} disabled={bloqueado || rack.pisos >= 10} onClick={() => onCambiar(rack.pisos + 1)}>+</button>
  </div>
);

export default function Bodega() {
  const aviso = useAviso();
  const [pasillos, setPasillos] = useState(null);
  const [sinUbicacion, setSinUbicacion] = useState(null);
  const [error, setError] = useState('');
  const [dlg, setDlg] = useState(null); // { tipo: 'rack', pasillo } | { tipo: 'borrar', pasillo, rack? } | { tipo: 'ocupado', ... }
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setPasillos((await api('/bodega')).data.pasillos);
      setSinUbicacion((await api('/inventario/sin-ubicacion?limite=1&pagina=1')).total);
      setError('');
    } catch (e) { setError(mensajeError(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const cerrar = useCallback(() => setDlg(null), []);

  // `que` describe lo que se quiere quitar, para el aviso del 409: { que: 'piso' | 'rack' | 'pasillo', pasillo, rack?, piso? }.
  async function ejecutar(ruta, metodo, cuerpo, exito, que) {
    setOcupado(true);
    try { await api(ruta, { metodo, cuerpo }); aviso(exito); cerrar(); await cargar(); }
    catch (e) {
      if (e.codigo === 'UBICACION_OCUPADA') setDlg({ tipo: 'ocupado', ...que, productos: e.detalle?.productos ?? [] });
      else { cerrar(); setError(mensajeError(e)); }
    } finally { setOcupado(false); }
  }
  const cambiarPisos = (p, r, pisos) => ejecutar(`/bodega/pasillos/${p}/racks/${r.letra}`, 'PUT', { pisos }, `Rack ${r.letra}: ${plural(pisos, 'piso', 'pisos')}.`, { que: 'piso', pasillo: p, rack: r.letra, piso: r.pisos });

  const racks = pasillos?.reduce((n, p) => n + p.racks.length, 0) ?? 0;
  const ubicaciones = pasillos?.reduce((n, p) => n + p.racks.reduce((m, r) => m + r.pisos, 0), 0) ?? 0;
  const usadas = new Set(pasillos?.flatMap((p) => p.racks.map((r) => r.letra)));

  return (
    <div className="s1 bodega-adm">
      <div className="cab-bodega">
        <div>
          <h1>Bodega</h1>
          <p>Estructura de la bodega: pasillos, racks y pisos. Cada producto se ubica en uno de estos lugares.</p>
        </div>
        <Boton variante="primario" icono="plus" disabled={ocupado} onClick={() => ejecutar('/bodega/pasillos', 'POST', {}, 'Pasillo agregado.')}>Agregar pasillo</Boton>
      </div>
      <Alerta>{error}</Alerta>
      {!pasillos ? <p className="vacio">Cargando…</p> : (
        <>
          <div className="resumen">
            <div className="dato-res"><span>Pasillos</span><div><strong>{pasillos.length}</strong></div></div>
            <div className="dato-res"><span>Racks</span><div><strong>{racks}</strong></div></div>
            <div className="dato-res"><span>Ubicaciones</span><div><strong>{ubicaciones}</strong></div></div>
            <div className={`dato-res ${sinUbicacion > 0 ? 'alerta-sin' : ''}`}><span>Productos sin ubicación</span><div><strong>{sinUbicacion ?? '–'}</strong>{sinUbicacion > 0 && <Link to="/catalogo">Ver lista</Link>}</div></div>
          </div>
          {pasillos.length === 0 && <p className="vacio">Aún no hay pasillos. Agrega el primero.</p>}
          {pasillos.map((p) => (
            <section className="pasillo" key={p.numero}>
              <div className="pasillo-cab">
                <div>
                  <h2>Pasillo {p.numero}</h2>
                  <span className="bd">{plural(p.racks.length, 'rack', 'racks')} · {plural(p.racks.reduce((n, r) => n + r.pisos, 0), 'ubicación', 'ubicaciones')}</span>
                </div>
                <button type="button" className="enlace-peligro" onClick={() => setDlg({ tipo: 'borrar', pasillo: p.numero })}>Eliminar pasillo</button>
              </div>
              <div className="racks">
                {p.racks.map((r) => (
                  <div className="rack" key={r.letra}>
                    <div className="rack-cab">
                      <div><h3>Rack {r.letra}</h3><p>{plural(r.pisos, 'piso', 'pisos')}</p></div>
                      <Pisos rack={r} bloqueado={ocupado} onCambiar={(n) => cambiarPisos(p.numero, r, n)} />
                    </div>
                    <div className="pisos-rack">
                      {[...r.ubicaciones].reverse().map((u) => (
                        <div className="piso" key={u.piso}>
                          <div><b>Piso {u.piso}</b><small>{u.ubicacion}</small></div>
                          {u.productos ? <span className="bd info">{plural(u.productos, 'producto', 'productos')}</span> : <span className="bd">Vacío</span>}
                        </div>
                      ))}
                    </div>
                    <div className="base-rack" />
                    <div><button type="button" className="enlace-peligro" onClick={() => setDlg({ tipo: 'borrar', pasillo: p.numero, rack: r.letra })}>Eliminar rack</button></div>
                  </div>
                ))}
                <button type="button" className="rack-nuevo" onClick={() => setDlg({ tipo: 'rack', pasillo: p.numero })}>+ Agregar rack al pasillo {p.numero}</button>
              </div>
            </section>
          ))}
        </>
      )}

      {dlg?.tipo === 'rack' && <AgregarRack pasillos={pasillos} usadas={usadas} inicial={dlg.pasillo} ocupado={ocupado} onClose={cerrar}
        onGuardar={(n, letra, pisos) => ejecutar(`/bodega/pasillos/${n}/racks`, 'POST', { letra, pisos }, `Rack ${letra} agregado al pasillo ${n}.`)} />}
      {dlg?.tipo === 'borrar' && (
        <Modal className="modal-bodega" titulo={dlg.rack ? `Eliminar el rack ${dlg.rack}` : `Eliminar el pasillo ${dlg.pasillo}`} onClose={cerrar}
          subtitulo={dlg.rack ? `Rack ${dlg.rack} · Pasillo ${dlg.pasillo}` : `Pasillo ${dlg.pasillo}`}
          pie={<><Boton onClick={cerrar}>Cancelar</Boton><Boton variante="peligro" disabled={ocupado} data-inicial
            onClick={() => ejecutar(dlg.rack ? `/bodega/pasillos/${dlg.pasillo}/racks/${dlg.rack}` : `/bodega/pasillos/${dlg.pasillo}`, 'DELETE', undefined, dlg.rack ? `Rack ${dlg.rack} eliminado.` : `Pasillo ${dlg.pasillo} eliminado.`,
              { que: dlg.rack ? 'rack' : 'pasillo', pasillo: dlg.pasillo, rack: dlg.rack })}>Eliminar</Boton></>}>
          <p className="ayuda">{dlg.rack ? `Se quita el rack ${dlg.rack} con todos sus pisos.` : `Se quita el pasillo ${dlg.pasillo} con todos sus racks.`} Solo se puede si no hay productos ubicados ahí.</p>
        </Modal>
      )}
      {dlg?.tipo === 'ocupado' && <NoSePuedeQuitar {...dlg} onClose={cerrar} />}
    </div>
  );
}

// Aviso del 409: lista los productos que hay que mover antes de quitar el piso, el rack o el pasillo.
function NoSePuedeQuitar({ que, pasillo, rack, piso, productos, onClose }) {
  const lugares = [...new Set(productos.map((x) => x.ubicacion))];
  const donde = lugares.length === 1 ? `«${lugares[0]}»` : rack ? `el rack ${rack} del pasillo ${pasillo}` : `el pasillo ${pasillo}`;
  const n = productos.length;
  return (
    <Modal className="modal-bodega" titulo={`No se puede quitar el ${que} ${que === 'piso' ? piso : que === 'rack' ? rack : pasillo}`} subtitulo={rack ? `Rack ${rack} · Pasillo ${pasillo}` : `Pasillo ${pasillo}`}
      onClose={onClose} pie={<Boton variante="primario" data-inicial onClick={onClose}>Entendido</Boton>}>
      <div className="aviso-rechazo" role="alert">
        <strong>Hay {n === 1 ? '1 producto ubicado' : `${n} productos ubicados`} en {donde}.</strong>
        <span>Muévelos a otra ubicación antes de quitar el {que}. Si no, quedarían sin lugar en la bodega.</span>
      </div>
      {n > 0 && (
        <ul className="productos-ocupados">
          {productos.map((x) => <li key={x.sku}><b>{x.sku}</b><span>{x.nombre}</span></li>)}
        </ul>
      )}
    </Modal>
  );
}

function AgregarRack({ pasillos, usadas, inicial, ocupado, onClose, onGuardar }) {
  const [n, setN] = useState(inicial ?? pasillos[0]?.numero);
  const [letra, setLetra] = useState(LETRAS.find((l) => !usadas.has(l)) ?? '');
  const [pisos, setPisos] = useState(2);
  const repetida = pasillos.find((p) => p.numero === Number(n))?.racks.some((r) => r.letra === letra);
  const valida = /^[A-Z]$/.test(letra) && !repetida;
  return (
    <Modal className="modal-bodega" titulo="Agregar rack" subtitulo="Se crea dentro de un pasillo, con sus pisos." onClose={onClose}
      pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante="primario" disabled={!valida || ocupado} onClick={() => onGuardar(Number(n), letra, pisos)}>Agregar rack</Boton></>}>
      <Campo como="select" etiqueta="Pasillo" value={n} onChange={(e) => setN(e.target.value)}>
        {pasillos.map((p) => <option key={p.numero} value={p.numero}>Pasillo {p.numero}</option>)}
      </Campo>
      <div className="fila-letra-pisos">
        <Campo className="" etiqueta="Letra del rack" maxLength={1} value={letra} onChange={(e) => setLetra(e.target.value.toUpperCase())} data-letra
          error={letra && !valida ? (repetida ? 'Ese pasillo ya tiene un rack con esa letra.' : 'Usa una sola letra, de la A a la Z.') : undefined}
          ayuda="Siguiente letra libre de toda la bodega. Puedes elegir otra (A–Z)." />
        <div className="campo">
          <label id="lbl-pisos">Pisos del rack</label>
          <div className="stepper-pisos" role="group" aria-labelledby="lbl-pisos">
            <button type="button" aria-label="Menos pisos" disabled={pisos <= 1} onClick={() => setPisos(pisos - 1)}>−</button>
            <output>{pisos}</output>
            <button type="button" aria-label="Más pisos" disabled={pisos >= 10} onClick={() => setPisos(pisos + 1)}>+</button>
          </div>
          <span className="ayuda">Entre 1 y 10 pisos.</span>
        </div>
      </div>
      {valida && (
        <div className="vista-previa">
          <span>Se crearán estas ubicaciones</span>
          {Array.from({ length: pisos }, (_, i) => pisos - i).map((p) => <div key={p}>Pasillo {n}, Rack {letra}, Piso {p}</div>)}
        </div>
      )}
    </Modal>
  );
}
