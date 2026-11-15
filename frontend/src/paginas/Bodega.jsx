import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Icono, Modal, useAviso } from '../componentes/ui.jsx';
import '../estilos/sprint1.css';
import './bodega-estructura.css';

const LETRAS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export default function Bodega() {
  const aviso = useAviso();
  const [pasillos, setPasillos] = useState(null);
  const [sinUbicacion, setSinUbicacion] = useState(null);
  const [error, setError] = useState('');
  const [dlg, setDlg] = useState(null); // { tipo: 'rack', pasillo? } | { tipo: 'borrar', pasillo, rack? } | { tipo: 'ocupado', mensaje }
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

  // Toda operación: éxito → aviso y recarga; 409 UBICACION_OCUPADA → modal que explica qué mover primero.
  async function ejecutar(ruta, metodo, cuerpo, exito) {
    setOcupado(true);
    try { await api(ruta, { metodo, cuerpo }); aviso(exito); cerrar(); await cargar(); }
    catch (e) { if (e.codigo === 'UBICACION_OCUPADA') setDlg({ tipo: 'ocupado', mensaje: e.message, productos: e.detalle?.productos ?? [] }); else { cerrar(); setError(mensajeError(e)); } }
    finally { setOcupado(false); }
  }

  const racks = pasillos?.reduce((n, p) => n + p.racks.length, 0) ?? 0;
  const ubicaciones = pasillos?.reduce((n, p) => n + p.racks.reduce((m, r) => m + r.pisos, 0), 0) ?? 0;
  const usadas = new Set(pasillos?.flatMap((p) => p.racks.map((r) => r.letra)));

  return (
    <div className="s1 bodega-adm">
      <div className="cabecera">
        <div>
          <h1>Bodega</h1>
          <p>Estructura de pasillos, racks y pisos. Cada producto se guarda en una sola ubicación, por ejemplo «Pasillo 1, Rack B, Piso 2».</p>
        </div>
        <Boton variante="primario" icono="plus" disabled={ocupado} onClick={() => ejecutar('/bodega/pasillos', 'POST', {}, 'Pasillo agregado.')}>Agregar pasillo</Boton>
      </div>
      <Alerta>{error}</Alerta>
      {!pasillos ? <p className="vacio">Cargando…</p> : (
        <>
          <div className="resumen">
            <div><strong>{pasillos.length}</strong><span>Pasillos</span></div>
            <div><strong>{racks}</strong><span>Racks</span></div>
            <div><strong>{ubicaciones}</strong><span>Ubicaciones</span></div>
            <div><strong>{sinUbicacion ?? '–'}</strong><span>Productos sin ubicación</span>{sinUbicacion > 0 && <> · <Link to="/catalogo">Ver lista</Link></>}</div>
          </div>
          {pasillos.length === 0 && <p className="vacio">Aún no hay pasillos. Agrega el primero.</p>}
          {pasillos.map((p) => (
            <section className="pasillo" key={p.numero}>
              <div className="pasillo-cab">
                <h2>Pasillo {p.numero}</h2>
                <Boton variante="enlace peligro" onClick={() => setDlg({ tipo: 'borrar', pasillo: p.numero })}>Eliminar pasillo</Boton>
              </div>
              <div className="racks">
                {p.racks.map((r) => (
                  <div className="rack" key={r.letra}>
                    <div className="rack-cab"><strong>Rack {r.letra}</strong><Badge>{plural(r.pisos, 'piso', 'pisos')}</Badge></div>
                    {[...r.ubicaciones].reverse().map((u) => (
                      <div className="piso" key={u.piso}><span>{u.ubicacion}</span><Badge tono={u.productos ? 'info' : ''}>{plural(u.productos, 'producto', 'productos')}</Badge></div>
                    ))}
                    <div className="rack-pie">
                      <span className="stepper">Pisos
                        <Boton className="icono-solo" aria-label={`Quitar un piso al rack ${r.letra}`} disabled={ocupado || r.pisos <= 1} onClick={() => ejecutar(`/bodega/pasillos/${p.numero}/racks/${r.letra}`, 'PUT', { pisos: r.pisos - 1 }, `Rack ${r.letra}: ${r.pisos - 1} pisos.`)}><Icono n="menos" /></Boton>
                        <strong>{r.pisos}</strong>
                        <Boton className="icono-solo" aria-label={`Agregar un piso al rack ${r.letra}`} disabled={ocupado || r.pisos >= 10} onClick={() => ejecutar(`/bodega/pasillos/${p.numero}/racks/${r.letra}`, 'PUT', { pisos: r.pisos + 1 }, `Rack ${r.letra}: ${r.pisos + 1} pisos.`)}><Icono n="plus" /></Boton>
                      </span>
                      <Boton variante="enlace peligro" onClick={() => setDlg({ tipo: 'borrar', pasillo: p.numero, rack: r.letra })}>Eliminar rack</Boton>
                    </div>
                  </div>
                ))}
                <button type="button" className="rack-nuevo" onClick={() => setDlg({ tipo: 'rack', pasillo: p.numero })}><Icono n="plus" />Agregar rack al pasillo {p.numero}</button>
              </div>
            </section>
          ))}
        </>
      )}

      {dlg?.tipo === 'rack' && <AgregarRack pasillos={pasillos} usadas={usadas} inicial={dlg.pasillo} ocupado={ocupado} onClose={cerrar}
        onGuardar={(n, letra, pisos) => ejecutar(`/bodega/pasillos/${n}/racks`, 'POST', { letra, pisos }, `Rack ${letra} agregado al pasillo ${n}.`)} />}
      {dlg?.tipo === 'borrar' && (
        <Modal chico titulo={dlg.rack ? `Eliminar el rack ${dlg.rack}` : `Eliminar el pasillo ${dlg.pasillo}`} onClose={cerrar}
          subtitulo={dlg.rack ? `Se quita el rack ${dlg.rack} del pasillo ${dlg.pasillo} con todos sus pisos.` : `Se quita el pasillo ${dlg.pasillo} con todos sus racks.`}
          pie={<><Boton onClick={cerrar}>Cancelar</Boton><Boton variante="peligro" disabled={ocupado} data-inicial
            onClick={() => ejecutar(dlg.rack ? `/bodega/pasillos/${dlg.pasillo}/racks/${dlg.rack}` : `/bodega/pasillos/${dlg.pasillo}`, 'DELETE', undefined, dlg.rack ? `Rack ${dlg.rack} eliminado.` : `Pasillo ${dlg.pasillo} eliminado.`)}>Eliminar</Boton></>}>
          <p>Solo se puede eliminar si no hay productos ubicados ahí.</p>
        </Modal>
      )}
      {dlg?.tipo === 'ocupado' && (
        <Modal chico titulo="No se puede quitar" subtitulo="Hay productos guardados en esa ubicación." onClose={cerrar} pie={<Boton variante="primario" data-inicial onClick={cerrar}>Entendido</Boton>}>
          <Alerta>{dlg.mensaje}</Alerta>
          {dlg.productos.length > 0 && (
            <ul className="lista-skus">
              {dlg.productos.map((x) => <li key={x.sku}><strong>{x.sku}</strong> · {x.nombre}<br /><span className="tenue">{x.ubicacion}</span></li>)}
            </ul>
          )}
          <p>Cambia la ubicación de esos productos desde «Catálogo Maestro» y vuelve a intentarlo.</p>
        </Modal>
      )}
    </div>
  );
}

function AgregarRack({ pasillos, usadas, inicial, ocupado, onClose, onGuardar }) {
  const [n, setN] = useState(inicial ?? pasillos[0]?.numero);
  const [letra, setLetra] = useState(LETRAS.find((l) => !usadas.has(l)) ?? '');
  const [pisos, setPisos] = useState(2);
  const valida = /^[A-Z]$/.test(letra) && !pasillos.find((p) => p.numero === Number(n))?.racks.some((r) => r.letra === letra);
  return (
    <Modal chico titulo="Agregar rack" subtitulo="Elige el pasillo, la letra y la cantidad de pisos." onClose={onClose}
      pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante="primario" disabled={!valida || ocupado} onClick={() => onGuardar(Number(n), letra, pisos)}>Agregar rack</Boton></>}>
      <Campo como="select" etiqueta="Pasillo" value={n} onChange={(e) => setN(e.target.value)}>
        {pasillos.map((p) => <option key={p.numero} value={p.numero}>Pasillo {p.numero}</option>)}
      </Campo>
      <Campo etiqueta="Letra" maxLength={1} value={letra} onChange={(e) => setLetra(e.target.value.toUpperCase())}
        ayuda={usadas.has(letra) ? 'Esa letra ya está en uso en la bodega.' : 'Una sola letra, de la A a la Z.'} error={letra && !valida ? 'Elige una letra libre en este pasillo.' : undefined} />
      <div className="campo"><label>Pisos</label>
        <span className="stepper">
          <Boton className="icono-solo" aria-label="Menos pisos" disabled={pisos <= 1} onClick={() => setPisos(pisos - 1)}><Icono n="menos" /></Boton>
          <strong>{pisos}</strong>
          <Boton className="icono-solo" aria-label="Más pisos" disabled={pisos >= 10} onClick={() => setPisos(pisos + 1)}><Icono n="plus" /></Boton>
        </span>
      </div>
      {valida && <ul className="lista-skus">{Array.from({ length: pisos }, (_, i) => <li key={i}>Pasillo {n}, Rack {letra}, Piso {i + 1}</li>)}</ul>}
    </Modal>
  );
}
