import * as repo from '../repositories/bodega.js';
import { etiquetaUbicacion } from '../repositories/bodega.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';

const bad = (m) => new AppError(400, m, 'VALIDACION');
const conflicto = (m, codigo = 'CONFLICTO', detalle) => Object.assign(new AppError(409, m, codigo), detalle && { detalle });
const entero = (v, campo, min, max) => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${campo} debe ser un entero entre ${min} y ${max}`);
  return n;
};
const letraValida = (v) => {
  const l = String(v ?? '').trim().toUpperCase();
  if (!/^[A-Z]$/.test(l)) throw bad('La letra del rack debe ser una sola letra de la A a la Z');
  return l;
};
const registrar = (req, c, accion, despues, antes = null) =>
  auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'bodega', accion, antes, despues }, c);

// Pasillo → racks → ubicaciones («Pasillo 1, Rack B, Piso 2») con los productos que hay en cada una.
export async function estructura() {
  const { pasillos, racks, ocupacion } = await repo.estructura();
  return {
    pasillos: pasillos.map(({ numero }) => ({
      numero,
      racks: racks.filter((r) => r.numero_pasillo === numero).map(({ letra, pisos }) => ({
        letra, pisos,
        ubicaciones: Array.from({ length: pisos }, (_, i) => {
          const ubicacion = etiquetaUbicacion(numero, letra, i + 1);
          return { piso: i + 1, ubicacion, productos: ocupacion.get(ubicacion) ?? 0 };
        }),
      })),
    })),
  };
}

export async function crearPasillo(req, body = {}) {
  return conTransaccion(async (c) => {
    const numero = body.numero === undefined ? await repo.siguientePasillo(c) : entero(body.numero, 'numero', 1, 99);
    if (numero > 99) throw bad('No caben más pasillos (máximo 99)');
    if (await repo.pasilloExiste(numero, c)) throw conflicto(`Ya existe el pasillo ${numero}`, 'PASILLO_DUPLICADO');
    await repo.crearPasillo(numero, c);
    await registrar(req, c, 'CREAR_PASILLO', { numero });
    return { numero, racks: [] };
  });
}

export async function borrarPasillo(req, n) {
  const numero = entero(n, 'pasillo', 1, 99);
  return conTransaccion(async (c) => {
    if (!(await repo.pasilloExiste(numero, c))) throw new AppError(404, `No existe el pasillo ${numero}`, 'NO_ENCONTRADO');
    const racks = await repo.racksDePasillo(numero, c);
    const etiquetas = racks.flatMap((r) => Array.from({ length: r.pisos }, (_, i) => etiquetaUbicacion(numero, r.letra, i + 1)));
    const ocupados = etiquetas.length ? await repo.productosEn(etiquetas, c) : [];
    if (ocupados.length) throw conflicto(`El pasillo ${numero} tiene ${ocupados.length} producto(s) ubicados: muévelos antes de eliminarlo`, 'UBICACION_OCUPADA', { productos: ocupados });
    for (const r of racks) await repo.borrarRack(numero, r.letra, c);
    await repo.borrarPasillo(numero, c);
    await registrar(req, c, 'BORRAR_PASILLO', null, { numero, racks });
    return { numero };
  });
}

export async function crearRack(req, n, body = {}) {
  const numero = entero(n, 'pasillo', 1, 99);
  const pisos = entero(body.pisos, 'pisos', 1, 10);
  return conTransaccion(async (c) => {
    if (!(await repo.pasilloExiste(numero, c))) throw new AppError(404, `No existe el pasillo ${numero}`, 'NO_ENCONTRADO');
    // Sin letra, se toma la siguiente libre de toda la bodega: así cada rack queda con letra única.
    let letra;
    if (body.letra === undefined) {
      const usadas = new Set(await repo.letrasEnUso(c));
      letra = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((x) => !usadas.has(x));
      if (!letra) throw conflicto('Ya se usaron las 26 letras de rack', 'SIN_LETRAS');
    } else letra = letraValida(body.letra);
    if ((await repo.rackBloqueado(numero, letra, c)) !== undefined) throw conflicto(`Ya existe el rack ${letra} en el pasillo ${numero}`, 'RACK_DUPLICADO');
    await repo.crearRack(numero, letra, pisos, c);
    await registrar(req, c, 'CREAR_RACK', { pasillo: numero, letra, pisos });
    return { pasillo: numero, letra, pisos };
  });
}

export async function cambiarPisos(req, n, letraParam, body = {}) {
  const numero = entero(n, 'pasillo', 1, 99), letra = letraValida(letraParam);
  const pisos = entero(body.pisos, 'pisos', 1, 10);
  return conTransaccion(async (c) => {
    const antes = await repo.rackBloqueado(numero, letra, c);
    if (antes === undefined) throw new AppError(404, `No existe el rack ${letra} en el pasillo ${numero}`, 'NO_ENCONTRADO');
    if (pisos < antes) {
      const quitadas = Array.from({ length: antes - pisos }, (_, i) => etiquetaUbicacion(numero, letra, pisos + i + 1));
      const ocupados = await repo.productosEn(quitadas, c);
      if (ocupados.length) throw conflicto(`Hay ${ocupados.length} producto(s) ubicados en los pisos que se quitan: muévelos antes`, 'UBICACION_OCUPADA', { productos: ocupados });
    }
    if (pisos !== antes) {
      await repo.fijarPisos(numero, letra, pisos, c);
      await registrar(req, c, 'CAMBIAR_PISOS', { pasillo: numero, letra, pisos }, { pasillo: numero, letra, pisos: antes });
    }
    return { pasillo: numero, letra, pisos };
  });
}

export async function borrarRack(req, n, letraParam) {
  const numero = entero(n, 'pasillo', 1, 99), letra = letraValida(letraParam);
  return conTransaccion(async (c) => {
    const pisos = await repo.rackBloqueado(numero, letra, c);
    if (pisos === undefined) throw new AppError(404, `No existe el rack ${letra} en el pasillo ${numero}`, 'NO_ENCONTRADO');
    const etiquetas = Array.from({ length: pisos }, (_, i) => etiquetaUbicacion(numero, letra, i + 1));
    const ocupados = await repo.productosEn(etiquetas, c);
    if (ocupados.length) throw conflicto(`El rack ${letra} tiene ${ocupados.length} producto(s) ubicados: muévelos antes de eliminarlo`, 'UBICACION_OCUPADA', { productos: ocupados });
    await repo.borrarRack(numero, letra, c);
    await registrar(req, c, 'BORRAR_RACK', null, { pasillo: numero, letra, pisos });
    return { pasillo: numero, letra };
  });
}

// La ubicación de un SKU debe existir en la estructura. Dentro de la transacción del llamador; bloquea el rack (FOR SHARE).
export async function exigirUbicacionValida(client, ubicacion) {
  const m = /^Pasillo (\d+), Rack ([A-Z]), Piso (\d+)$/.exec(ubicacion);
  const pisos = m ? await repo.rackBloqueado(Number(m[1]), m[2], client, 'SHARE') : undefined;
  if (pisos === undefined || Number(m[3]) < 1 || Number(m[3]) > pisos || etiquetaUbicacion(Number(m[1]), m[2], Number(m[3])) !== ubicacion)
    throw bad(`La ubicación «${ubicacion}» no existe en la bodega: elige una de la estructura configurada`);
}
