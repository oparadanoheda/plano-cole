// Red del centro: armarios, router, switches, paneles de parcheo, puntos WiFi, tomas y
// equipos, unidos por cables con su recorrido por las plantas. Aquí va el modelo (sin dibujo):
// operaciones, recorridos y longitudes, esquema (árbol desde el router), comprobación del
// archivo y listados en CSV.
//
// doc.red = {
//   equipos: { id: {tipo, nombre, pl, x, y, en, puertos, modelo, ip, notas, h, subtipo, poe,
//                   gestionable, alcance, notasPuertos: {n: texto}} },
//   cables:  { id: {etiqueta, tipo, estado, canal, notas, a: {eq, pto} | null, b: {eq, pto} | null,
//                   tramos: [ {pl, pts: [x, y, x, y, …]} ]} } }
//
// - Un equipo dentro de un armario («en») está donde esté el armario: no tiene pl, x, y propios.
// - Los extremos conectados a un equipo no se guardan en los tramos: se toman de la posición del
//   equipo, así el cable le sigue si se mueve. Un extremo suelto (a o b = null) es el primer o el
//   último punto de los tramos.
// - Cada tramo va en metros de su planta. Entre un tramo y el siguiente el cable cambia de planta
//   (sube, baja o sale al exterior): el último punto de uno y el primero del siguiente son el mismo
//   sitio, cada uno en las coordenadas de su planta.

import { nuevoId, aSitio, deSitio, exigir, esNum, esTextoOpc, deLista, ID } from './modelo.js';
import { dist, dentro } from './geo.js';
import { salas } from './espacios.js';

export const TIPOS_EQUIPO = {
  armario: { nombre: 'Armario', pref: 'AR', puertos: 0, color: '#334155' },
  router: { nombre: 'Router', pref: 'RT', puertos: 4, color: '#7c3aed' },
  switch: { nombre: 'Switch', pref: 'SW', puertos: 24, color: '#2563eb' },
  panel: { nombre: 'Panel de parcheo', pref: 'PP', puertos: 24, color: '#64748b' },
  ap: { nombre: 'Punto WiFi', pref: 'AP', puertos: 1, color: '#0891b2' },
  toma: { nombre: 'Toma de red', pref: 'T', puertos: 2, color: '#b45309' },
  equipo: { nombre: 'Equipo', pref: 'EQ', puertos: 1, color: '#475569' },
};
export const SUBTIPOS = {
  pc: 'Ordenador', portatiles: 'Carro de portátiles', impresora: 'Impresora', proyector: 'Proyector o pantalla',
  camara: 'Cámara', telefono: 'Teléfono IP', otro: 'Otro',
};
export const TIPOS_CABLE = {
  cat5e: { nombre: 'Cobre Cat 5e', color: '#3b82f6', cobre: true },
  cat6: { nombre: 'Cobre Cat 6', color: '#16a34a', cobre: true },
  cat6a: { nombre: 'Cobre Cat 6A', color: '#0f766e', cobre: true },
  'fibra-mm': { nombre: 'Fibra multimodo', color: '#ea580c', cobre: false },
  'fibra-sm': { nombre: 'Fibra monomodo', color: '#ca8a04', cobre: false },
  otro: { nombre: 'Otro o desconocido', color: '#6b7280', cobre: false },
};
export const ESTADOS_CABLE = { servicio: 'En servicio', proyecto: 'Proyectado (por tender)', averia: 'Averiado', 'sin-uso': 'Sin uso' };
/** Por dónde va el cable; h = altura sobre el suelo (negativa: bajo el techo). */
export const CANALES = {
  techo: { nombre: 'Falso techo', h: -0.15 },
  bandeja: { nombre: 'Bandeja', h: -0.45 },
  canaleta: { nombre: 'Canaleta en la pared', h: 1.0 },
  tubo: { nombre: 'Tubo empotrado', h: 0.4 },
  suelo: { nombre: 'Suelo o zócalo', h: 0.05 },
  exterior: { nombre: 'Exterior (fachada o zanja)', h: 0.05 },
};
/** Altura de montaje por defecto (m sobre el suelo); null = en el techo. */
const ALTURA_EQUIPO = { armario: 1.0, router: 1.0, switch: 1.8, panel: 1.0, ap: null, toma: 0.3, equipo: 0.8 };
export const LIMITE_COBRE = 90; // m: enlace permanente máximo en cobre (el canal entero, 100 m)
export const HOLGURA = 0.1;     // se suma a la longitud para las cocas y los latiguillos
const LOSA = 0.25;
const ORDEN_TIPO = { router: 0, switch: 1, panel: 2, armario: 3, ap: 4, equipo: 5, toma: 6 };

export const r3 = (v) => Math.round(v * 1000) / 1000;
export const redVacia = () => ({ equipos: {}, cables: {} });
export const pares = (v) => { const r = []; for (let i = 0; i + 1 < v.length; i += 2) r.push({ x: v[i], y: v[i + 1] }); return r; };
export const etiquetaNivel = (n) => (n === 0 ? 'B' : n < 0 ? 'S' + (n === -1 ? '' : -n) : String(n));
export const nombreTipo = (e) => (e.tipo === 'equipo' && e.subtipo ? SUBTIPOS[e.subtipo] : TIPOS_EQUIPO[e.tipo]?.nombre) || 'Equipo';
const comparar = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
export const porTipoYNombre = (red) => (x, y) => (ORDEN_TIPO[red.equipos[x].tipo] - ORDEN_TIPO[red.equipos[y].tipo]) || comparar(red.equipos[x].nombre, red.equipos[y].nombre);

// ---------------------------------------------------------------------------- plantas y alturas

export function indicePlantas(doc) {
  const m = new Map();
  for (const ed of doc.edificios) for (const p of ed.plantas) m.set(p.id, { ed, p });
  return m;
}

/** Altura del suelo de cada planta sobre la planta baja de su edificio (como en el 3D). */
export function basesPlantas(doc) {
  const b = new Map();
  for (const ed of doc.edificios) {
    const pls = [...ed.plantas].sort((x, y) => x.nivel - y.nivel);
    const i0 = Math.max(0, pls.findIndex((p) => p.nivel >= 0));
    let h = 0;
    for (let i = i0; i < pls.length; i++) { b.set(pls[i].id, h); h += pls[i].altura || 3.2; }
    h = 0;
    for (let i = i0 - 1; i >= 0; i--) { h -= pls[i].altura || 3.2; b.set(pls[i].id, h); }
  }
  return b;
}

/** Contexto para consultas que miran todo el documento. */
export function contexto(doc) {
  return { doc, red: doc.red, ip: indicePlantas(doc), bases: basesPlantas(doc) };
}

const alturaLibre = (p) => Math.max(2, (p?.altura || 3.2) - LOSA);

/** Altura sobre el suelo a la que va el cable en una planta, según por dónde vaya. */
export function alturaCanal(canal, p) {
  const h = (CANALES[canal] || CANALES.techo).h;
  return h < 0 ? alturaLibre(p) + h : h;
}

/** Altura de un equipo sobre el suelo de su planta (los de un armario, la del armario). */
export function alturaEquipo(red, id, p) {
  let e = red.equipos[id];
  if (e?.en && red.equipos[e.en]) e = red.equipos[e.en];
  if (!e) return 1;
  if (esNum(e.h)) return e.h;
  const h = ALTURA_EQUIPO[e.tipo];
  return h == null ? alturaLibre(p) - 0.1 : h;
}

// ---------------------------------------------------------------------------- posiciones y recorridos

/** Planta y punto donde está un equipo (los de un armario, donde el armario). */
export function lugar(red, id) {
  let e = red.equipos[id];
  if (e?.en) e = red.equipos[e.en];
  return e && e.pl ? { pl: e.pl, x: e.x, y: e.y } : null;
}

/** Pasa un punto de las coordenadas de una planta a las de otra, a través del sitio. */
export function aPlanta(ip, pt, de, a) {
  if (de === a) return { x: pt.x, y: pt.y };
  const pd = ip.get(de)?.p, pa = ip.get(a)?.p;
  if (!pd || !pa) return { x: pt.x, y: pt.y };
  return deSitio(pa, aSitio(pd, pt));
}

/** Recorrido de un cable: sus tramos con los extremos incluidos y los cambios de planta
 *  ({de, a, pDe, pA}: el punto del cambio en cada una de las dos plantas). */
export function recorrido(red, ip, c) {
  const la = c.a ? lugar(red, c.a.eq) : null;
  const lb = c.b ? lugar(red, c.b.eq) : null;
  const tramos = c.tramos.map((t) => ({ pl: t.pl, pts: pares(t.pts) }));
  if (!tramos.length && (la || lb)) tramos.push({ pl: (la || lb).pl, pts: [] });
  const cambios = [];
  if (tramos.length) {
    const t0 = tramos[0], tn = tramos[tramos.length - 1];
    if (la) {
      t0.pts.unshift(aPlanta(ip, la, la.pl, t0.pl));
      if (la.pl !== t0.pl) cambios.push({ de: la.pl, a: t0.pl, pDe: { x: la.x, y: la.y }, pA: t0.pts[0] });
    }
    for (let i = 0; i + 1 < tramos.length; i++) {
      const t = tramos[i], s = tramos[i + 1];
      if (t.pl !== s.pl && t.pts.length && s.pts.length) cambios.push({ de: t.pl, a: s.pl, pDe: t.pts[t.pts.length - 1], pA: s.pts[0] });
    }
    if (lb) {
      tn.pts.push(aPlanta(ip, lb, lb.pl, tn.pl));
      if (lb.pl !== tn.pl) cambios.push({ de: tn.pl, a: lb.pl, pDe: tn.pts[tn.pts.length - 1], pA: { x: lb.x, y: lb.y } });
    }
  }
  return { tramos, cambios, la, lb };
}

/** Longitud aproximada: en horizontal por los tramos, en vertical por los cambios de planta y las
 *  bajadas hasta los equipos, y una holgura. «largo» = cobre por encima del límite. */
export function longitud(ctx, c, rec = recorrido(ctx.red, ctx.ip, c)) {
  const { red, ip, bases } = ctx;
  let horizontal = 0;
  for (const t of rec.tramos) for (let i = 1; i < t.pts.length; i++) horizontal += dist(t.pts[i - 1], t.pts[i]);
  const canal = (pl) => alturaCanal(c.canal, ip.get(pl)?.p);
  const run = (pl) => (bases.get(pl) ?? 0) + canal(pl);
  let vertical = 0;
  for (const k of rec.cambios) vertical += Math.abs(run(k.a) - run(k.de));
  const hA = rec.la && alturaEquipo(red, c.a.eq, ip.get(rec.la.pl)?.p);
  const hB = rec.lb && alturaEquipo(red, c.b.eq, ip.get(rec.lb.pl)?.p);
  if (horizontal < 0.05 && !rec.cambios.length && rec.la && rec.lb) {
    // dos equipos en el mismo sitio (un latiguillo dentro de un armario): no sube al techo
    vertical = Math.abs(hA - hB);
  } else {
    if (rec.la) vertical += Math.abs(canal(rec.la.pl) - hA);
    if (rec.lb) vertical += Math.abs(canal(rec.lb.pl) - hB);
  }
  // entre dos equipos, como poco un latiguillo de medio metro
  const total = Math.max((horizontal + vertical) * (1 + HOLGURA), rec.la && rec.lb ? 0.5 : 0);
  return { horizontal, vertical, total, largo: !!TIPOS_CABLE[c.tipo]?.cobre && total > LIMITE_COBRE };
}

/** Plantas por las que pasa un cable, en orden (sin repetir seguidas). */
export function plantasDe(red, ip, c) {
  const rec = recorrido(red, ip, c);
  const l = [];
  const pon = (pl) => { if (pl && l[l.length - 1] !== pl) l.push(pl); };
  pon(rec.la?.pl);
  for (const t of rec.tramos) pon(t.pl);
  pon(rec.lb?.pl);
  return l;
}

// ---------------------------------------------------------------------------- puertos

/** Qué cables llegan a cada puerto de un equipo: usados = Map(puerto → [{cid, lado}]). */
export function puertosDe(red, eqId) {
  const usados = new Map();
  const sinPuerto = [];
  for (const [cid, c] of Object.entries(red.cables)) {
    for (const lado of ['a', 'b']) {
      const x = c[lado];
      if (!x || x.eq !== eqId) continue;
      if (x.pto) {
        if (!usados.has(x.pto)) usados.set(x.pto, []);
        usados.get(x.pto).push({ cid, lado });
      } else sinPuerto.push({ cid, lado });
    }
  }
  return { usados, sinPuerto };
}

export function puertoLibre(red, eqId) {
  const e = red.equipos[eqId];
  if (!e?.puertos) return null;
  const { usados } = puertosDe(red, eqId);
  for (let i = 1; i <= e.puertos; i++) if (!usados.has(i)) return i;
  return null;
}

// ---------------------------------------------------------------------------- esquema

/** Vecinos de cada equipo por los cables que unen dos equipos. */
export function grafo(red) {
  const g = new Map();
  for (const id of Object.keys(red.equipos)) g.set(id, []);
  for (const [cid, c] of Object.entries(red.cables)) {
    if (!c.a || !c.b || c.a.eq === c.b.eq || !g.has(c.a.eq) || !g.has(c.b.eq)) continue;
    g.get(c.a.eq).push({ cid, otro: c.b.eq, mio: c.a.pto, suyo: c.b.pto });
    g.get(c.b.eq).push({ cid, otro: c.a.eq, mio: c.b.pto, suyo: c.a.pto });
  }
  return g;
}

/** Árbol de la red desde el router (si no hay, desde el switch con más cables). Lo que no llega al
 *  router forma sus propios árboles («raices» después de la primera); «sueltos» = sin cables. */
export function arbol(red) {
  const g = grafo(red);
  const ids = Object.keys(red.equipos);
  const grado = (id) => g.get(id).length;
  const prio = (id) => ({ router: 0, switch: 1 })[red.equipos[id].tipo] ?? 2;
  const candidatos = ids.filter((id) => grado(id) > 0).sort((x, y) => prio(x) - prio(y) || grado(y) - grado(x));
  const padre = new Map(), via = new Map(), hijos = new Map(), raices = [];
  for (const r of candidatos) {
    if (padre.has(r)) continue;
    raices.push(r);
    padre.set(r, null);
    const cola = [r];
    while (cola.length) {
      const u = cola.shift();
      hijos.set(u, []);
      for (const v of g.get(u)) {
        if (padre.has(v.otro)) continue;
        padre.set(v.otro, u);
        via.set(v.otro, v);
        hijos.get(u).push(v.otro);
        cola.push(v.otro);
      }
    }
  }
  const sueltos = ids.filter((id) => !padre.has(id) && red.equipos[id].tipo !== 'armario');
  return { g, padre, via, hijos, raices, sueltos };
}

/** Del equipo hasta la raíz de su árbol (el router): equipos y cables por los que pasa. */
export function camino(arb, id) {
  const equipos = [id], cables = [];
  let u = id;
  while (arb.padre.get(u)) {
    cables.push(arb.via.get(u).cid);
    u = arb.padre.get(u);
    equipos.push(u);
  }
  return { equipos, cables };
}

/** Lo que cuelga de un equipo: lo que se queda sin red si falla. */
export function descendientes(arb, id) {
  const equipos = [], cables = [];
  const pila = [...(arb.hijos.get(id) || [])];
  while (pila.length) {
    const u = pila.pop();
    equipos.push(u);
    cables.push(arb.via.get(u).cid);
    pila.push(...(arb.hijos.get(u) || []));
  }
  return { equipos, cables };
}

/** Lo que conviene revisar: puertos con dos cables, puertos que no existen, cables con un
 *  extremo suelto, cables de cobre demasiado largos y equipos sin ningún cable. */
export function problemas(ctx) {
  const { red } = ctx;
  const r = { dobles: [], fuera: [], sueltos: [], largos: [], sinCable: [] };
  for (const [id, e] of Object.entries(red.equipos)) {
    const { usados, sinPuerto } = puertosDe(red, id);
    for (const [pto, l] of usados) {
      if (l.length > 1) r.dobles.push({ id, pto });
      if (pto > e.puertos) r.fuera.push({ id, pto });
    }
    if (e.tipo !== 'armario' && !usados.size && !sinPuerto.length) r.sinCable.push(id);
  }
  for (const [cid, c] of Object.entries(red.cables)) {
    if (!c.a || !c.b) r.sueltos.push(cid);
    if (longitud(ctx, c).largo) r.largos.push(cid);
  }
  return r;
}

// ---------------------------------------------------------------------------- salas

const cacheSalas = new Map();
/** Hay que llamarla cuando cambian los muros o las salas. */
export function olvidarSalas() { cacheSalas.clear(); }

/** Sala donde cae un punto de una planta. Si la planta no tiene muros, la sala con el
 *  rótulo más cercano (a menos de 6 m). */
export function salaEn(p, pt) {
  if (!p) return null;
  let info = cacheSalas.get(p.id);
  if (!info) { info = salas(p); cacheSalas.set(p.id, info); }
  let mejor = null, area = Infinity;
  for (const [id, s] of Object.entries(info.salas)) {
    if (s && s.cara.area < area && dentro(pt, s.cara.pts)) { mejor = p.espacios[id]; area = s.cara.area; }
  }
  if (mejor || Object.keys(p.muros).length) return mejor;
  let md = 6;
  for (const e of Object.values(p.espacios)) { const d = dist(e, pt); if (d < md) { md = d; mejor = e; } }
  return mejor;
}

/** Edificio, planta y sala de un equipo. */
export function ubicacion(ctx, id) {
  const l = lugar(ctx.red, id);
  const r = l && ctx.ip.get(l.pl);
  if (!r) return { edificio: '', planta: '', sala: '', grupo: '' };
  const s = salaEn(r.p, l);
  return { edificio: r.ed.nombre, planta: r.p.nombre, sala: s?.nombre || '', grupo: s?.grupo || '', ed: r.ed, p: r.p };
}
export function textoUbicacion(ctx, id, conEdificio = true) {
  const u = ubicacion(ctx, id);
  return [conEdificio && u.edificio, u.planta, u.sala].filter(Boolean).join(' · ');
}
export function textoExtremo(red, x) {
  if (!x) return 'extremo suelto';
  const e = red.equipos[x.eq];
  return e ? e.nombre + (x.pto ? ' · p' + x.pto : '') : '¿?';
}

// ---------------------------------------------------------------------------- operaciones

export function nombreNuevo(red, tipo) {
  const pref = TIPOS_EQUIPO[tipo].pref + '-';
  let n = 0;
  for (const e of Object.values(red.equipos)) {
    if (!e.nombre?.startsWith(pref)) continue;
    const k = parseInt(e.nombre.slice(pref.length), 10);
    if (k > n) n = k;
  }
  return pref + String(n + 1).padStart(2, '0');
}

export function etiquetaNueva(red) {
  let n = 0;
  for (const c of Object.values(red.cables)) {
    const m = /^C-(\d+)$/.exec(c.etiqueta || '');
    if (m && +m[1] > n) n = +m[1];
  }
  return 'C-' + String(n + 1).padStart(3, '0');
}

export function crearEquipo(red, tipo, datos = {}) {
  const id = nuevoId('q');
  red.equipos[id] = { tipo, nombre: nombreNuevo(red, tipo), puertos: TIPOS_EQUIPO[tipo].puertos, ...datos };
  return id;
}

export function crearCable(red, datos) {
  const id = nuevoId('k');
  red.cables[id] = { etiqueta: etiquetaNueva(red), tipo: 'cat6', estado: 'servicio', canal: 'techo', a: null, b: null, tramos: [], ...datos };
  return id;
}

/** Desconecta un extremo: queda suelto donde estaba el equipo. */
export function soltarExtremo(red, ip, c, lado) {
  const x = c[lado];
  if (!x) return;
  const l = lugar(red, x.eq);
  c[lado] = null;
  if (!l) return;
  if (!c.tramos.length) c.tramos.push({ pl: l.pl, pts: [] });
  const t = lado === 'a' ? c.tramos[0] : c.tramos[c.tramos.length - 1];
  const q = aPlanta(ip, l, l.pl, t.pl);
  if (lado === 'a') t.pts.unshift(r3(q.x), r3(q.y)); else t.pts.push(r3(q.x), r3(q.y));
}

/** Conecta el extremo suelto de un cable a un equipo (quita el punto suelto). */
export function conectarExtremo(red, c, lado, eqId) {
  if (c[lado]) return;
  const t = lado === 'a' ? c.tramos[0] : c.tramos[c.tramos.length - 1];
  if (t?.pts.length) { if (lado === 'a') t.pts.splice(0, 2); else t.pts.length -= 2; }
  c[lado] = { eq: eqId, pto: puertoLibre(red, eqId) };
}

/** Borra un equipo. Sus cables se quedan con ese extremo suelto (en el mismo sitio); si es un
 *  armario, lo que tenía dentro se queda donde estaba. Devuelve cuántos cables quedan sueltos. */
export function borrarEquipo(red, ip, id) {
  const e = red.equipos[id];
  if (!e) return 0;
  if (e.tipo === 'armario') {
    let k = 0;
    for (const o of Object.values(red.equipos)) {
      if (o.en !== id) continue;
      delete o.en;
      Object.assign(o, { pl: e.pl, x: r3(e.x + 0.6 * ++k), y: e.y });
    }
  }
  let sueltos = 0;
  for (const c of Object.values(red.cables)) {
    for (const lado of ['a', 'b']) if (c[lado]?.eq === id) { soltarExtremo(red, ip, c, lado); sueltos++; }
  }
  delete red.equipos[id];
  return sueltos;
}

/** Al borrar una planta: fuera sus equipos y los tramos que pasan por ella. */
export function quitarPlanta(red, ip, plId) {
  const ids = Object.keys(red.equipos).filter((id) => lugar(red, id)?.pl === plId);
  // los armarios al final: así lo de dentro ya está borrado y no se saca a la planta
  ids.sort((x, y) => (red.equipos[x].tipo === 'armario') - (red.equipos[y].tipo === 'armario'));
  for (const id of ids) borrarEquipo(red, ip, id);
  for (const [id, c] of Object.entries(red.cables)) {
    c.tramos = c.tramos.filter((t) => t.pl !== plId);
    if (!c.tramos.length) delete red.cables[id];
  }
}

export function meterEnArmario(red, id, armarioId) {
  const e = red.equipos[id];
  e.en = armarioId;
  delete e.pl; delete e.x; delete e.y;
}

export function sacarDeArmario(red, id) {
  const l = lugar(red, id);
  const e = red.equipos[id];
  delete e.en;
  Object.assign(e, { pl: l.pl, x: r3(l.x + 0.6), y: l.y });
}

export function invertirCable(c) {
  [c.a, c.b] = [c.b, c.a];
  c.tramos.reverse();
  for (const t of c.tramos) {
    const ps = pares(t.pts).reverse();
    t.pts = ps.flatMap((q) => [q.x, q.y]);
  }
}

// ---------------------------------------------------------------------------- archivo

/** Comprueba la red leída de un archivo (o de una versión) y completa lo que falte. */
export function validarRed(red, donde = 'red') {
  if (red == null) return redVacia();
  exigir(typeof red === 'object' && red.equipos && typeof red.equipos === 'object' && red.cables && typeof red.cables === 'object', donde);
  for (const [id, e] of Object.entries(red.equipos)) {
    exigir(ID.test(id) && e && typeof e === 'object' && Object.hasOwn(TIPOS_EQUIPO, e.tipo) && typeof e.nombre === 'string', `${donde}: equipo`);
    if (e.en != null) exigir(ID.test(e.en), `${donde}: equipo`);
    else exigir(ID.test(e.pl) && esNum(e.x) && esNum(e.y), `${donde}: equipo`);
    for (const k of ['modelo', 'ip', 'notas']) exigir(esTextoOpc(e[k]), `${donde}: equipo`);
    for (const k of ['h', 'alcance']) exigir(e[k] == null || esNum(e[k]), `${donde}: equipo`);
    if (!(Number.isInteger(e.puertos) && e.puertos >= 0 && e.puertos <= 192)) e.puertos = TIPOS_EQUIPO[e.tipo].puertos;
    if (e.subtipo != null) e.subtipo = deLista(e.subtipo, SUBTIPOS, 'otro');
    for (const k of ['poe', 'gestionable']) if (e[k] != null) e[k] = !!e[k];
    if (e.notasPuertos != null) {
      exigir(typeof e.notasPuertos === 'object' && !Array.isArray(e.notasPuertos), `${donde}: puertos`);
      for (const [k, v] of Object.entries(e.notasPuertos)) exigir(/^\d{1,3}$/.test(k) && typeof v === 'string', `${donde}: puertos`);
    }
  }
  // dentro de algo que no es un armario (o de un armario que no existe): no se sabe dónde está
  for (const [id, e] of Object.entries(red.equipos)) {
    if (e.en == null) continue;
    const r = red.equipos[e.en];
    if (!r || r.tipo !== 'armario' || r.en != null || e.tipo === 'armario') delete red.equipos[id];
  }
  for (const [id, c] of Object.entries(red.cables)) {
    exigir(ID.test(id) && c && typeof c === 'object' && esTextoOpc(c.etiqueta) && esTextoOpc(c.notas), `${donde}: cable`);
    c.tipo = deLista(c.tipo, TIPOS_CABLE, 'otro');
    c.estado = deLista(c.estado, ESTADOS_CABLE, 'servicio');
    c.canal = deLista(c.canal, CANALES, 'techo');
    for (const lado of ['a', 'b']) {
      const x = c[lado];
      if (x == null) { c[lado] = null; continue; }
      exigir(typeof x === 'object' && ID.test(x.eq) && (x.pto == null || (Number.isInteger(x.pto) && x.pto >= 1 && x.pto <= 192)), `${donde}: cable`);
      if (x.pto == null) x.pto = null;
      if (!red.equipos[x.eq]) c[lado] = null;
    }
    c.tramos ??= [];
    exigir(Array.isArray(c.tramos), `${donde}: cable`);
    for (const t of c.tramos) exigir(t && ID.test(t.pl) && Array.isArray(t.pts) && t.pts.length % 2 === 0 && t.pts.every(esNum), `${donde}: cable`);
  }
  return red;
}

/** Quita lo que esté en plantas que ya no existen y los cables que se han quedado sin nada. */
function depurar(doc, red) {
  const ip = indicePlantas(doc);
  for (const [id, e] of Object.entries(red.equipos)) if (e.en == null && !ip.has(e.pl)) delete red.equipos[id];
  // lo que estaba dentro de un armario que se ha ido
  for (const [id, e] of Object.entries(red.equipos)) if (e.en != null && !red.equipos[e.en]) delete red.equipos[id];
  for (const [id, c] of Object.entries(red.cables)) {
    for (const lado of ['a', 'b']) if (c[lado] && !red.equipos[c[lado].eq]) c[lado] = null;
    c.tramos = c.tramos.filter((t) => ip.has(t.pl));
    if (!c.tramos.length) {
      const l = (c.a && lugar(red, c.a.eq)) || (c.b && lugar(red, c.b.eq));
      if (l) c.tramos.push({ pl: l.pl, pts: [] });
      else delete red.cables[id];
    }
  }
  return red;
}

/** Comprueba y completa la red del documento y la de sus versiones. */
export function normalizarRed(doc) {
  doc.red = depurar(doc, validarRed(doc.red));
  for (const v of doc.versiones) {
    if (v.red == null) continue;
    exigir(typeof v.red === 'string', `versión «${v.nombre}»`);
    let r;
    try { r = JSON.parse(v.red); } catch { exigir(false, `versión «${v.nombre}»`); }
    validarRed(r, `versión «${v.nombre}»`);
  }
  return doc;
}

/** Red guardada en una versión (texto), comprobada y ajustada a las plantas de ahora. */
export function redDeVersion(doc, texto) {
  return depurar(doc, validarRed(JSON.parse(texto)));
}

// ---------------------------------------------------------------------------- listados (CSV)

const celda = (v) => {
  let s = String(v ?? '');
  if (/^[=+@\t\r]/.test(s)) s = "'" + s; // que la hoja de cálculo no lo tome por una fórmula
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV para Excel en español: punto y coma, y marca UTF-8 para los acentos. */
export const csv = (filas) => '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
const m1 = (v) => v.toFixed(1).replace('.', ',');

export function filasInventario(ctx) {
  const { red } = ctx;
  const filas = [['Nombre', 'Tipo', 'Modelo', 'IP', 'Puertos', 'Puertos usados', 'Edificio', 'Planta', 'Sala', 'Armario', 'Notas']];
  for (const id of Object.keys(red.equipos).sort(porTipoYNombre(red))) {
    const e = red.equipos[id];
    const u = ubicacion(ctx, id);
    filas.push([e.nombre, nombreTipo(e), e.modelo, e.ip, e.puertos || '', e.puertos ? puertosDe(red, id).usados.size : '',
      u.edificio, u.planta, u.sala, e.en ? red.equipos[e.en]?.nombre : '', e.notas]);
  }
  return filas;
}

export function filasCables(ctx) {
  const { red, ip } = ctx;
  const filas = [['Etiqueta', 'Tipo', 'Estado', 'Por', 'Desde', 'Puerto', 'Sala', 'Hasta', 'Puerto', 'Sala', 'Longitud aprox. (m)', 'Plantas', 'Notas']];
  const ids = Object.keys(red.cables).sort((x, y) => comparar(red.cables[x].etiqueta, red.cables[y].etiqueta));
  for (const id of ids) {
    const c = red.cables[id];
    const ext = (x) => (x ? [red.equipos[x.eq]?.nombre, x.pto || '', ubicacion(ctx, x.eq).sala] : ['(suelto)', '', '']);
    const pls = plantasDe(red, ip, c).map((pl) => { const r = ip.get(pl); return r ? `${r.ed.nombre} ${r.p.nombre}` : ''; });
    filas.push([c.etiqueta, TIPOS_CABLE[c.tipo].nombre, ESTADOS_CABLE[c.estado], CANALES[c.canal].nombre, ...ext(c.a), ...ext(c.b),
      m1(longitud(ctx, c).total), pls.join(' > '), c.notas]);
  }
  return filas;
}

export function filasPuertos(ctx) {
  const { red } = ctx;
  const filas = [['Equipo', 'Puerto', 'Conectado a', 'Su puerto', 'Sala', 'Cable', 'Tipo de cable', 'Nota del puerto']];
  const ids = Object.keys(red.equipos).filter((id) => ['router', 'switch', 'panel'].includes(red.equipos[id].tipo)).sort(porTipoYNombre(red));
  for (const id of ids) {
    const e = red.equipos[id];
    const { usados } = puertosDe(red, id);
    for (let n = 1; n <= e.puertos; n++) {
      const nota = e.notasPuertos?.[n] || '';
      const l = usados.get(n) || [];
      if (!l.length) { filas.push([e.nombre, n, '', '', '', '', '', nota]); continue; }
      for (const { cid, lado } of l) {
        const c = red.cables[cid];
        const otro = c[lado === 'a' ? 'b' : 'a'];
        filas.push([e.nombre, n, otro ? red.equipos[otro.eq]?.nombre : '(suelto)', otro?.pto || '', otro ? ubicacion(ctx, otro.eq).sala : '',
          c.etiqueta, TIPOS_CABLE[c.tipo].nombre, nota]);
      }
    }
  }
  return filas;
}
