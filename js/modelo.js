// Modelo del plano: documento, plantas y operaciones de edición.
//
// Documento (lo que se guarda en el archivo .plano.json):
//   { formato: 'plano-cole', version: 1, centro: {nombre, norte}, edificios: [
//       { id, nombre, plantas: [
//           { id, nombre, nivel,
//             nodos:     { id: {x, y} },                       // metros
//             muros:     { id: {a, b, grosor, tipo, estado, notas, aberturas: [
//                            {id, tipo, pos, ancho, lado, bisagra}]} },
//             pilares:   [ {x, y, an, al} ],
//             espacios:  { id: {nombre, x, y, uso, grupo, notas} },   // x,y = punto semilla
//             elementos: { id: {tipo: 'nota', x, y, texto, capa} },
//             anotaciones: [ {id, capa, tipo: 'trazo'|'texto'|'flecha', herr, color, ancho, puntos | x,y,texto} ],
//             colocacion: {x, y, giro},   // de coordenadas de la planta a las del sitio
//             altura,                      // metros de suelo a suelo (para el 3D)
//             calco:     { origen, capas: {arquitectura|pci|evacuacion|sectores: [trazados]} } } ] } ],
//     sitio: { ancla: {x, y, lat, lon}, rumbo },   // georreferencia: rumbo = hacia dónde mira el «arriba» del plano
//     capasAnotacion: [ {id, nombre, visible} ],
//     red: { equipos, cables },                     // la red del centro (ver red.js)
//     versiones: [ {id, nombre, fecha, plantas: {plantaId: contenido editable}, red} ] }
//
// En una abertura, «pos» es la distancia del centro al nodo a; «lado» ±1 es hacia
// qué lado abre la hoja (+1 = normal (-uy, ux) del muro a→b); «bisagra» 'a' o 'b'.

import { dist, proyectar, cruce, sub, add, mul, unit } from './geo.js';

export const FORMATO = 'plano-cole';
export const TIPOS_MURO = { fachada: 'Fachada', carga: 'Muro de carga', tabique: 'Tabique' };
export const ESTADOS_MURO = {
  importado: 'Importado del PAU',
  medido: 'Medido en obra',
  provisional: 'Provisional (por medir)',
};
export const TIPOS_ABERTURA = {
  puerta: 'Puerta', 'puerta-doble': 'Puerta doble', ventana: 'Ventana', paso: 'Paso sin puerta',
};
export const USOS = {
  aula: 'Aula', despacho: 'Despacho', aseo: 'Aseo / vestuario', almacen: 'Almacén',
  comedor: 'Comedor / cocina', deporte: 'Deporte', instalaciones: 'Instalaciones',
  paso: 'Pasillo / vestíbulo', otro: 'Otro',
};
export const ANCHOS = { puerta: 0.9, 'puerta-doble': 1.6, ventana: 1.2, paso: 1.0 };

export const nuevoId = (pref) => pref + Math.random().toString(36).slice(2, 9);

export function documentoVacio() {
  return {
    formato: FORMATO, version: 1, centro: { nombre: 'Mi centro', norte: 0 },
    creado: new Date().toISOString().slice(0, 10),
    edificios: [{ id: nuevoId('b'), nombre: 'Edificio', plantas: [plantaVacia('Planta baja', 0)] }],
    capasAnotacion: [{ id: 'a1', nombre: 'Anotaciones', visible: true }],
    versiones: [],
  };
}

export function plantaVacia(nombre, nivel, colocacion = { x: 0, y: 0, giro: 0 }) {
  return {
    id: nuevoId('p'), nombre, nivel, nodos: {}, muros: {}, pilares: [], espacios: {}, elementos: {},
    anotaciones: [], colocacion: { ...colocacion }, altura: 3.2, calco: null,
  };
}

/** Comprueba y completa un documento leído de archivo. Lanza un error legible si no vale. */
export function normalizar(doc) {
  if (!doc || typeof doc !== 'object' || doc.formato !== FORMATO) throw new Error('No es un archivo de plano (falta «formato: plano-cole»).');
  doc.edificios ||= [];
  doc.versiones ||= [];
  doc.centro ||= { nombre: '', norte: 0 };
  doc.capasAnotacion ||= [];
  exigir(Array.isArray(doc.edificios) && Array.isArray(doc.versiones) && Array.isArray(doc.capasAnotacion), 'estructura');
  if (!doc.capasAnotacion.length) doc.capasAnotacion.push({ id: 'a1', nombre: 'Anotaciones', visible: true });
  for (const c of doc.capasAnotacion) exigir(ID.test(c?.id) && typeof c.nombre === 'string', 'capa de anotaciones');
  const capa0 = doc.capasAnotacion[0].id;
  for (const ed of doc.edificios) {
    exigir(ID.test(ed?.id) && typeof ed.nombre === 'string', 'edificio');
    ed.plantas ||= [];
    ed.exterior ??= ed.id === 'exterior';
    for (const p of ed.plantas) {
      exigir(ID.test(p?.id) && typeof p.nombre === 'string' && esNum(p.nivel), 'planta');
      p.nodos ||= {}; p.muros ||= {}; p.pilares ||= []; p.espacios ||= {}; p.elementos ||= {};
      p.anotaciones ||= [];
      p.colocacion ||= { x: 0, y: 0, giro: 0 };
      p.altura ||= 3.2;
      exigir(esNum(p.colocacion.x) && esNum(p.colocacion.y) && esNum(p.colocacion.giro || 0) && esNum(p.altura), `${p.nombre}: colocación`);
      validarContenido(p, capa0, p.nombre);
      validarCalco(p.calco, p.nombre);
      for (const [id, m] of Object.entries(p.muros)) {
        if (!p.nodos[m.a] || !p.nodos[m.b] || m.a === m.b) delete p.muros[id];
      }
    }
  }
  if (doc.sitio) {
    const s = doc.sitio;
    exigir(s.ancla && [s.ancla.x, s.ancla.y, s.ancla.lat, s.ancla.lon, s.rumbo].every(esNum), 'georreferencia');
  }
  exigir(typeof (doc.centro.nombre ?? '') === 'string', 'centro');
  // las versiones guardan el contenido de cada planta en texto: también se comprueba
  for (const v of doc.versiones) {
    exigir(ID.test(v?.id) && typeof v.nombre === 'string' && v.plantas && typeof v.plantas === 'object', 'versión');
    for (const [plId, json] of Object.entries(v.plantas)) {
      exigir(ID.test(plId) && typeof json === 'string', `versión «${v.nombre}»`);
      let c;
      try { c = JSON.parse(json); } catch { exigir(false, `versión «${v.nombre}»`); }
      for (const k of ['nodos', 'muros', 'espacios', 'elementos']) c[k] ||= {};
      c.pilares ||= [];
      c.anotaciones ||= [];
      validarContenido(c, capa0, `versión «${v.nombre}»`);
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Validación: un archivo manipulado no debe poder meter código en la página.
// Los textos se escapan al pintarlos; aquí se comprueban identificadores, colores,
// trazados y números, que van dentro de atributos.
// ---------------------------------------------------------------------------

export const ID = /^[\w-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const TRAZADO = /^[MLHVCSQTAZmlhvcsqtaz0-9eE.,\s+-]*$/;
export const esNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const esTextoOpc = (v) => v === undefined || v === null || typeof v === 'string';
export const deLista = (v, lista, def) => (typeof v === 'string' && Object.hasOwn(lista, v) ? v : def);
const PLUMAS_VALIDAS = { boli: 1, rotulador: 1, lapiz: 1 };

export function exigir(cond, que) {
  if (!cond) throw new Error(`El archivo tiene datos no válidos (${que}). Por seguridad no se abre.`);
}

/** Comprueba (y completa) el contenido editable de una planta o de una versión. */
function validarContenido(p, capa0, donde) {
  exigir(typeof p.nodos === 'object' && typeof p.muros === 'object' && Array.isArray(p.pilares) &&
    typeof p.espacios === 'object' && typeof p.elementos === 'object' && Array.isArray(p.anotaciones), donde);
  for (const [id, n] of Object.entries(p.nodos)) exigir(ID.test(id) && esNum(n?.x) && esNum(n?.y), `${donde}: esquina`);
  for (const [id, m] of Object.entries(p.muros)) {
    exigir(ID.test(id) && ID.test(m?.a) && ID.test(m.b) && esNum(m.grosor) && esTextoOpc(m.notas), `${donde}: muro`);
    m.tipo = deLista(m.tipo, TIPOS_MURO, 'tabique');
    m.estado = deLista(m.estado, ESTADOS_MURO, 'importado');
    m.aberturas ||= [];
    exigir(Array.isArray(m.aberturas), `${donde}: aberturas`);
    for (const o of m.aberturas) {
      o.id ||= nuevoId('h');
      exigir(ID.test(o.id) && Object.hasOwn(TIPOS_ABERTURA, o.tipo) && esNum(o.pos) && esNum(o.ancho) &&
        (o.lado === undefined || o.lado === 1 || o.lado === -1) &&
        (o.bisagra === undefined || o.bisagra === 'a' || o.bisagra === 'b'), `${donde}: puerta o ventana`);
    }
  }
  for (const pl of p.pilares) exigir([pl?.x, pl?.y, pl?.an, pl?.al].every(esNum), `${donde}: pilar`);
  for (const [id, e] of Object.entries(p.espacios)) {
    exigir(ID.test(id) && esNum(e?.x) && esNum(e.y) && typeof e.nombre === 'string' && esTextoOpc(e.grupo) && esTextoOpc(e.notas), `${donde}: sala`);
    e.uso = deLista(e.uso, USOS, 'otro');
  }
  for (const [id, n] of Object.entries(p.elementos)) {
    n.capa ||= capa0;
    exigir(ID.test(id) && n.tipo === 'nota' && esNum(n.x) && esNum(n.y) && esTextoOpc(n.texto) && ID.test(n.capa), `${donde}: nota`);
  }
  for (const a of p.anotaciones) {
    a.capa ||= capa0;
    exigir(ID.test(a?.id) && ID.test(a.capa) && COLOR.test(a.color), `${donde}: anotación`);
    if (a.tipo === 'texto') exigir([a.x, a.y, a.tam].every(esNum) && typeof a.texto === 'string', `${donde}: texto`);
    else if (a.tipo === 'flecha') exigir(esNum(a.ancho) && Array.isArray(a.puntos) && a.puntos.length === 4 && a.puntos.every(esNum), `${donde}: flecha`);
    else exigir(a.tipo === 'trazo' && Object.hasOwn(PLUMAS_VALIDAS, a.herr) && esNum(a.ancho) && Array.isArray(a.puntos) &&
      a.puntos.length >= 3 && a.puntos.length % 3 === 0 && a.puntos.every(esNum), `${donde}: trazo`);
  }
}

function validarCalco(calco, donde) {
  if (!calco) return;
  exigir(typeof calco === 'object' && typeof (calco.capas || {}) === 'object', `${donde}: calco`);
  for (const [capa, lista] of Object.entries(calco.capas || {})) {
    exigir(['arquitectura', 'pci', 'evacuacion', 'sectores'].includes(capa) && Array.isArray(lista), `${donde}: calco`);
    for (const t of lista) {
      exigir(typeof t?.d === 'string' && TRAZADO.test(t.d) && (t.trazo == null || COLOR.test(t.trazo)) &&
        (t.relleno == null || COLOR.test(t.relleno)) && (t.ancho == null || esNum(t.ancho)), `${donde}: calco`);
    }
  }
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export const extremos = (p, m) => [p.nodos[m.a], p.nodos[m.b]];
export const largo = (p, m) => dist(p.nodos[m.a], p.nodos[m.b]);

export function murosDeNodo(p, nid) {
  const r = [];
  for (const [id, m] of Object.entries(p.muros)) if (m.a === nid || m.b === nid) r.push(id);
  return r;
}

/** Contenido editable de una planta (sin el calco), para historial y versiones. */
export function contenido(p) {
  return JSON.stringify({ nodos: p.nodos, muros: p.muros, pilares: p.pilares, espacios: p.espacios, elementos: p.elementos, anotaciones: p.anotaciones });
}

export function restaurar(p, json) {
  const c = JSON.parse(json);
  c.anotaciones ||= [];
  Object.assign(p, c);
}

// ---------------------------------------------------------------------------
// Colocación: coordenadas de una planta <-> coordenadas del sitio (el marco del edificio principal)
// ---------------------------------------------------------------------------

export function aSitio(p, pt) {
  const c = p.colocacion || { x: 0, y: 0, giro: 0 };
  const g = ((c.giro || 0) * Math.PI) / 180;
  return { x: c.x + pt.x * Math.cos(g) - pt.y * Math.sin(g), y: c.y + pt.x * Math.sin(g) + pt.y * Math.cos(g) };
}

export function deSitio(p, pt) {
  const c = p.colocacion || { x: 0, y: 0, giro: 0 };
  const g = ((c.giro || 0) * Math.PI) / 180;
  const dx = pt.x - c.x, dy = pt.y - c.y;
  return { x: dx * Math.cos(g) + dy * Math.sin(g), y: -dx * Math.sin(g) + dy * Math.cos(g) };
}

// ---------------------------------------------------------------------------
// Operaciones sobre nodos y muros
// ---------------------------------------------------------------------------

export function crearNodo(p, x, y) {
  const id = nuevoId('n');
  p.nodos[id] = { x, y };
  return id;
}

/** Busca un nodo a menos de «tol» metros de pt. */
export function nodoCerca(p, pt, tol, excluir = null) {
  let mejor = null, md = tol;
  for (const [id, n] of Object.entries(p.nodos)) {
    if (id === excluir) continue;
    const d = dist(n, pt);
    if (d <= md) { md = d; mejor = id; }
  }
  return mejor;
}

/** Busca el muro cuyo eje pasa a menos de «tol» de pt (sin contar sus extremos). */
export function muroCerca(p, pt, tol, excluir = []) {
  let mejor = null, md = Infinity;
  for (const [id, m] of Object.entries(p.muros)) {
    if (excluir.includes(id)) continue;
    const [A, B] = extremos(p, m);
    const r = proyectar(pt, A, B);
    if (r.t < 0 || r.t > r.L) continue;
    const d = Math.abs(r.d);
    if (d <= Math.max(tol, m.grosor / 2) && d < md) { md = d; mejor = { id, t: r.t, q: r.q, d: r.d }; }
  }
  return mejor;
}

/** Parte el muro a «t» metros del nodo a. Devuelve el id del nodo nuevo (o el extremo si cae encima). */
export function partirMuro(p, mid, t, nodoExistente = null) {
  const m = p.muros[mid];
  const [A, B] = extremos(p, m);
  const L = dist(A, B);
  if (t <= 0.005) return m.a;
  if (t >= L - 0.005) return m.b;
  const q = add(A, mul(unit(sub(B, A)), t));
  const nid = nodoExistente || crearNodo(p, q.x, q.y);
  if (nodoExistente) Object.assign(p.nodos[nid], { x: q.x, y: q.y });
  const id2 = nuevoId('m');
  const ab1 = [], ab2 = [];
  for (const o of m.aberturas) {
    if (o.pos <= t) ab1.push(o);
    else ab2.push({ ...o, pos: o.pos - t });
  }
  p.muros[id2] = { ...m, a: nid, b: m.b, aberturas: ab2 };
  m.b = nid;
  m.aberturas = ab1;
  ajustarAberturas(p, mid);
  ajustarAberturas(p, id2);
  return nid;
}

/** Nodo para el punto pt: reutiliza uno cercano, o parte el muro que pasa por ahí, o crea uno nuevo. */
export function nodoEn(p, pt, tol) {
  const n = nodoCerca(p, pt, tol);
  if (n) return n;
  const w = muroCerca(p, pt, tol);
  if (w) return partirMuro(p, w.id, w.t);
  return crearNodo(p, pt.x, pt.y);
}

/** Inserta un muro de a a b, partiendo los muros que cruza para que el grafo siga siendo plano.
 *  Las esquinas que ya hay sobre el recorrido se reutilizan: así, si el muro nuevo va por
 *  encima de uno que ya existe, ese tramo no se duplica. */
export function insertarMuro(p, a, b, props = {}) {
  const A = p.nodos[a], B = p.nodos[b];
  const L = dist(A, B);
  const cortes = [];
  for (const [id, m] of Object.entries(p.muros)) {
    if ([m.a, m.b].includes(a) || [m.a, m.b].includes(b)) continue;
    const [C, D] = extremos(p, m);
    const x = cruce(A, B, C, D);
    if (x && x.t > 1e-3 && x.t < 1 - 1e-3 && x.u > 1e-3 && x.u < 1 - 1e-3) cortes.push({ t: x.t, id, x });
  }
  for (const [nid, N] of Object.entries(p.nodos)) {
    if (nid === a || nid === b || L < 1e-6) continue;
    const r = proyectar(N, A, B);
    if (Math.abs(r.d) < 0.005 && r.t > 0.005 && r.t < L - 0.005) cortes.push({ t: r.t / L, nodo: nid });
  }
  cortes.sort((u, v) => u.t - v.t);
  const cadena = [a];
  for (const c of cortes) {
    if (c.nodo) { if (p.nodos[c.nodo] && cadena[cadena.length - 1] !== c.nodo) cadena.push(c.nodo); continue; }
    const m = p.muros[c.id];
    if (!m) continue;
    const [C, D] = extremos(p, m);
    const x = cruce(A, B, C, D);
    if (!x) continue;
    cadena.push(partirMuro(p, c.id, dist(C, x)));
  }
  cadena.push(b);
  const ids = [];
  for (let i = 0; i < cadena.length - 1; i++) {
    if (cadena[i] === cadena[i + 1]) continue;
    if (Object.values(p.muros).some((m) => (m.a === cadena[i] && m.b === cadena[i + 1]) || (m.b === cadena[i] && m.a === cadena[i + 1]))) continue;
    const id = nuevoId('m');
    p.muros[id] = { a: cadena[i], b: cadena[i + 1], grosor: 0.1, tipo: 'tabique', estado: 'provisional', aberturas: [], ...props };
    ids.push(id);
  }
  return ids;
}

export function borrarMuro(p, mid) {
  const m = p.muros[mid];
  if (!m) return;
  delete p.muros[mid];
  limpiarNodo(p, m.a);
  limpiarNodo(p, m.b);
}

/** Quita un nodo suelto, o lo disuelve si une dos muros alineados del mismo grosor. */
export function limpiarNodo(p, nid) {
  const ms = murosDeNodo(p, nid);
  if (ms.length === 0) { delete p.nodos[nid]; return; }
  if (ms.length !== 2) return;
  const [m1, m2] = ms.map((id) => p.muros[id]);
  // solo se funden si son el mismo muro: mismo grosor, tipo y estado (medido, importado…)
  if (Math.abs(m1.grosor - m2.grosor) > 0.005 || m1.tipo !== m2.tipo || m1.estado !== m2.estado) return;
  const o1 = m1.a === nid ? m1.b : m1.a;
  const o2 = m2.a === nid ? m2.b : m2.a;
  const N = p.nodos[nid], P1 = p.nodos[o1], P2 = p.nodos[o2];
  const r = proyectar(N, P1, P2);
  if (Math.abs(r.d) > 0.005 || r.t <= 0 || r.t >= r.L) return;
  // une m2 dentro de m1, orientado de o1 a o2
  const L1 = dist(P1, N);
  const ab = [];
  for (const o of m1.aberturas) ab.push({ ...o, pos: m1.a === o1 ? o.pos : L1 - o.pos, lado: m1.a === o1 ? o.lado : -(o.lado || 1), bisagra: m1.a === o1 ? o.bisagra : (o.bisagra === 'a' ? 'b' : 'a') });
  const L2 = dist(N, P2);
  for (const o of m2.aberturas) {
    const directo = m2.a === nid;
    ab.push({ ...o, pos: L1 + (directo ? o.pos : L2 - o.pos), lado: directo ? o.lado : -(o.lado || 1), bisagra: directo ? o.bisagra : (o.bisagra === 'a' ? 'b' : 'a') });
  }
  m1.a = o1; m1.b = o2; m1.aberturas = ab;
  delete p.muros[ms[1]];
  delete p.nodos[nid];
}

export function borrarNodo(p, nid) {
  for (const id of murosDeNodo(p, nid)) borrarMuro(p, id);
  delete p.nodos[nid];
}

/** Une el nodo «quita» en «deja» (al soltar un nodo encima de otro). */
export function fusionarNodos(p, deja, quita) {
  if (deja === quita) return;
  for (const [id, m] of Object.entries(p.muros)) {
    if (m.a === quita) m.a = deja;
    if (m.b === quita) m.b = deja;
    if (m.a === m.b) delete p.muros[id];
  }
  // muros duplicados entre los mismos nodos
  const vistos = new Set();
  for (const [id, m] of Object.entries(p.muros)) {
    const k = [m.a, m.b].sort().join('|');
    if (vistos.has(k)) delete p.muros[id]; else vistos.add(k);
  }
  delete p.nodos[quita];
}

/** Cambia la longitud del muro moviendo el extremo que no está anclado. */
export function fijarLargo(p, mid, L, ancla = 'a') {
  const m = p.muros[mid];
  const fijo = p.nodos[ancla === 'a' ? m.a : m.b];
  const movil = p.nodos[ancla === 'a' ? m.b : m.a];
  const u = unit(sub(movil, fijo));
  Object.assign(movil, add(fijo, mul(u, L)));
  ajustarAberturas(p, mid);
}

/** Mantiene las aberturas dentro del muro cuando cambia de largo. */
export function ajustarAberturas(p, mid) {
  const m = p.muros[mid];
  if (!m) return;
  const L = largo(p, m);
  for (const o of m.aberturas) {
    o.ancho = Math.min(o.ancho, L);
    o.pos = Math.min(Math.max(o.pos, o.ancho / 2), L - o.ancho / 2);
  }
}

export function invertirMuro(p, mid) {
  const m = p.muros[mid];
  const L = largo(p, m);
  [m.a, m.b] = [m.b, m.a];
  for (const o of m.aberturas) {
    o.pos = L - o.pos;
    if (o.lado) o.lado = -o.lado;
    if (o.bisagra) o.bisagra = o.bisagra === 'a' ? 'b' : 'a';
  }
}

export function anadirAbertura(p, mid, tipo, pos) {
  const m = p.muros[mid];
  const L = largo(p, m);
  const ancho = Math.min(ANCHOS[tipo] || 0.9, L);
  const o = { id: nuevoId('h'), tipo, pos: Math.min(Math.max(pos, ancho / 2), L - ancho / 2), ancho };
  if (tipo.startsWith('puerta')) Object.assign(o, { lado: 1, bisagra: 'a' });
  m.aberturas.push(o);
  return o;
}

export function buscarAbertura(p, hid) {
  for (const [mid, m] of Object.entries(p.muros)) {
    const o = m.aberturas.find((x) => x.id === hid);
    if (o) return { mid, m, o };
  }
  return null;
}

/** Recorre todas las plantas del documento. */
export function* plantas(doc) {
  for (const ed of doc.edificios) for (const p of ed.plantas) yield { ed, p };
}
