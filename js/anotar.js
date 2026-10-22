// Modo Anotar: dibujo a mano alzada sobre el plano (bolígrafo, rotulador, lápiz), textos,
// flechas y notas, organizados en capas de anotación. Pensado para el Apple Pencil:
// usa la presión y, si se activa «Solo el lápiz dibuja», el dedo sirve para mover el plano.
//
// Las anotaciones se guardan en metros, como el plano: al hacer zoom se comportan
// como tinta sobre el papel.

import { dist, proyectar } from './geo.js';
import { aMundo } from './vista.js';
import { nuevoId } from './modelo.js';

export const COLORES = ['#1d2330', '#d92d20', '#2457d6', '#16a34a', '#ea8a00', '#9333ea', '#0891b2', '#ffffff'];
export const PLUMAS = {
  boli: { nombre: 'Bolígrafo', ancho: 2.4, opacidad: 1 },
  rotulador: { nombre: 'Rotulador', ancho: 16, opacidad: 0.38 },
  lapiz: { nombre: 'Lápiz', ancho: 1.5, opacidad: 0.8 },
};
export const GROSORES = [0.6, 1, 1.8, 3];

const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (v) => (Math.round(v * 1000) / 1000).toString();

// ---------------------------------------------------------------------------- geometría del trazo

/** Contorno de un trazo con grosor variable según la presión (relleno, no línea). */
function contorno(puntos, ancho) {
  const n = puntos.length / 3;
  if (n === 0) return '';
  const P = [];
  for (let i = 0; i < n; i++) P.push({ x: puntos[i * 3], y: puntos[i * 3 + 1], p: puntos[i * 3 + 2] });
  if (n === 1 || (n === 2 && dist(P[0], P[1]) < 1e-4)) {
    const r = (ancho / 2) * (0.4 + 0.6 * P[0].p);
    return `M${f(P[0].x - r)} ${f(P[0].y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  }
  const izq = [], der = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    // afina los extremos, como un trazo real
    const borde = Math.min(1, (i + 1) / 3, (n - i) / 3);
    const r = (ancho / 2) * (0.35 + 0.65 * P[i].p) * (0.55 + 0.45 * borde);
    izq.push({ x: P[i].x - dy * r, y: P[i].y + dx * r });
    der.push({ x: P[i].x + dy * r, y: P[i].y - dx * r });
  }
  const lado = (pts) => {
    let d = '';
    for (let i = 1; i < pts.length; i++) {
      const m = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
      d += `Q${f(pts[i - 1].x)} ${f(pts[i - 1].y)} ${f(m.x)} ${f(m.y)}`;
    }
    return d + `L${f(pts[pts.length - 1].x)} ${f(pts[pts.length - 1].y)}`;
  };
  const fin = P[n - 1], ini = P[0];
  const rf = dist(izq[n - 1], der[n - 1]) / 2, ri = dist(izq[0], der[0]) / 2;
  return `M${f(izq[0].x)} ${f(izq[0].y)}${lado(izq)}A${f(rf)} ${f(rf)} 0 0 0 ${f(der[n - 1].x)} ${f(der[n - 1].y)}` +
    `${lado(der.slice().reverse())}A${f(ri)} ${f(ri)} 0 0 0 ${f(izq[0].x)} ${f(izq[0].y)}Z`;
}

/** Línea suavizada (para el rotulador, de grosor constante). */
function linea(puntos) {
  const n = puntos.length / 3;
  let d = `M${f(puntos[0])} ${f(puntos[1])}`;
  if (n === 1) return d + `l0.001 0`;
  for (let i = 1; i < n; i++) {
    const x0 = puntos[(i - 1) * 3], y0 = puntos[(i - 1) * 3 + 1], x1 = puntos[i * 3], y1 = puntos[i * 3 + 1];
    d += `Q${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)}`;
  }
  return d + `L${f(puntos[(n - 1) * 3])} ${f(puntos[(n - 1) * 3 + 1])}`;
}

function flecha(a) {
  const [x0, y0, x1, y1] = a.puntos;
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  const cab = Math.min(L * 0.4, a.ancho * 5);
  const bx = x1 - ux * cab, by = y1 - uy * cab;
  return { linea: `M${f(x0)} ${f(y0)}L${f(bx)} ${f(by)}`,
    punta: `M${f(x1)} ${f(y1)}L${f(bx - uy * cab * 0.5)} ${f(by + ux * cab * 0.5)}L${f(bx + uy * cab * 0.5)} ${f(by - ux * cab * 0.5)}Z` };
}

const cacheD = new Map();
function dTrazo(a) {
  const k = a.id + ':' + a.puntos.length;
  let d = cacheD.get(k);
  if (!d) { d = a.herr === 'rotulador' ? linea(a.puntos) : contorno(a.puntos, a.ancho); cacheD.set(k, d); }
  return d;
}

export function htmlAnotacion(a, seleccionada = false) {
  let s = '';
  if (a.tipo === 'trazo') {
    s = a.herr === 'rotulador'
      ? `<path class="tinta rotulador" d="${dTrazo(a)}" stroke="${a.color}" stroke-width="${f(a.ancho)}" opacity="${PLUMAS.rotulador.opacidad}"/>`
      : `<path class="tinta" d="${dTrazo(a)}" fill="${a.color}" opacity="${a.herr === 'lapiz' ? PLUMAS.lapiz.opacidad : 1}"/>`;
  } else if (a.tipo === 'flecha') {
    const fl = flecha(a);
    s = `<path class="tinta" d="${fl.linea}" stroke="${a.color}" stroke-width="${f(a.ancho)}" fill="none" stroke-linecap="round"/><path d="${fl.punta}" fill="${a.color}"/>`;
  } else if (a.tipo === 'texto') {
    const lineas = String(a.texto || '').split('\n');
    s = `<text class="tinta-texto" x="${f(a.x)}" y="${f(a.y)}" font-size="${f(a.tam)}" fill="${a.color}">` +
      lineas.map((l, i) => `<tspan x="${f(a.x)}" dy="${i ? f(a.tam * 1.2) : 0}">${esc(l) || ' '}</tspan>`).join('') + '</text>';
  }
  if (seleccionada) {
    const c = caja(a);
    s += `<rect class="sel-anot" x="${f(c.x0 - 0.1)}" y="${f(c.y0 - 0.1)}" width="${f(c.x1 - c.x0 + 0.2)}" height="${f(c.y1 - c.y0 + 0.2)}"/>`;
  }
  return s;
}

export function caja(a) {
  if (a.tipo === 'texto') {
    const lineas = String(a.texto || '').split('\n');
    const ancho = Math.max(...lineas.map((l) => l.length)) * a.tam * 0.55;
    return { x0: a.x, y0: a.y - a.tam, x1: a.x + ancho, y1: a.y + a.tam * 0.25 + (lineas.length - 1) * a.tam * 1.2 };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const paso = a.tipo === 'flecha' ? 2 : 3;
  for (let i = 0; i < a.puntos.length; i += paso) {
    x0 = Math.min(x0, a.puntos[i]); x1 = Math.max(x1, a.puntos[i]);
    y0 = Math.min(y0, a.puntos[i + 1]); y1 = Math.max(y1, a.puntos[i + 1]);
  }
  const m = a.ancho / 2;
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

/** ¿Toca el punto w (metros) esta anotación, con una tolerancia en metros? */
export function toca(a, w, tol) {
  const c = caja(a);
  if (w.x < c.x0 - tol || w.x > c.x1 + tol || w.y < c.y0 - tol || w.y > c.y1 + tol) return false;
  if (a.tipo === 'texto') return true;
  const paso = a.tipo === 'flecha' ? 2 : 3;
  const pts = [];
  for (let i = 0; i < a.puntos.length; i += paso) pts.push({ x: a.puntos[i], y: a.puntos[i + 1] });
  if (pts.length === 1) return dist(pts[0], w) <= a.ancho / 2 + tol;
  for (let i = 1; i < pts.length; i++) {
    const r = proyectar(w, pts[i - 1], pts[i]);
    const t = Math.min(Math.max(r.t, 0), r.L);
    const q = { x: pts[i - 1].x + r.u.x * t, y: pts[i - 1].y + r.u.y * t };
    if (dist(q, w) <= a.ancho / 2 + tol) return true;
  }
  return false;
}

export function pintarAnotaciones(g, planta, app) {
  const visibles = new Set(app.doc.capasAnotacion.filter((c) => c.visible).map((c) => c.id));
  const sel = app.est.anotSel;
  const partes = [];
  for (const a of planta.anotaciones || []) if (visibles.has(a.capa)) partes.push(htmlAnotacion(a, a.id === sel));
  g.innerHTML = partes.join('');
}

// ---------------------------------------------------------------------------- herramienta de anotar

export function crearAnotador(app) {
  const est = app.est;
  let actual = null;    // anotación en curso
  let previa = null;    // <g> donde se dibuja el trazo en curso
  let arrastre = null;  // mover una anotación seleccionada
  let editor = null;    // <textarea> para escribir
  let textoPendiente = null;

  const planta = () => app.planta();
  const capaActiva = () => {
    const cs = app.doc.capasAnotacion;
    if (!cs.some((c) => c.id === est.anot.capa)) est.anot.capa = cs[0].id;
    const c = cs.find((x) => x.id === est.anot.capa);
    if (!c.visible) { c.visible = true; app.pintar(); }
    return c.id;
  };

  function grupoPrevio() {
    if (!previa) {
      previa = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      previa.setAttribute('class', 'anot-previa');
      document.getElementById('mundo').appendChild(previa);
    }
    return previa;
  }

  /** ¿Este puntero dibuja? (el lápiz siempre; el dedo solo si no está activado «Solo el lápiz») */
  function quiere(e, numPunteros) {
    if (est.modo !== 'anotar') return false;
    if (e.pointerType === 'pen') { est.anot.hayLapiz = true; return true; }
    if (e.pointerType === 'touch') return !est.anot.soloLapiz && numPunteros === 1;
    return e.button === 0;
  }

  function presion(e) {
    if (e.pointerType === 'pen') return Math.max(0.05, e.pressure || 0.5);
    return 0.55;
  }

  function puntoMundo(e) {
    const r = app.svg.getBoundingClientRect();
    return aMundo(est.vista, { x: e.clientX - r.left, y: e.clientY - r.top });
  }

  function empezar(e) {
    const herr = est.anot.herr;
    const w = puntoMundo(e);
    const z = est.vista.z;
    const p = planta();
    if (editor) cerrarEditor(true);
    // el cuadro de texto se abre al soltar: si se abre al pulsar, el propio clic le quita el foco
    if (herr === 'texto') { textoPendiente = w; return 'texto'; }
    if (herr === 'nota') {
      app.antes();
      const id = nuevoId('x');
      p.elementos[id] = { tipo: 'nota', x: w.x, y: w.y, texto: 'Nota', capa: capaActiva() };
      app.cambio();
      app.seleccionar({ tipo: 'nota', id });
      app.enfocarPanel();
      return 'nota';
    }
    if (herr === 'borrador') { borrarEn(w, true); return 'borrador'; }
    if (herr === 'seleccion') {
      const a = buscar(w);
      est.anotSel = a?.id || null;
      app.pintar();
      if (a) arrastre = { a, ultimo: w, movido: false };
      app.pintarBarraAnot?.();
      return a ? 'mover' : 'nada';
    }
    if (herr === 'flecha') {
      actual = { id: nuevoId('t'), capa: capaActiva(), tipo: 'flecha', color: est.anot.color,
        ancho: r3((2.4 * est.anot.grosor) / z), puntos: [w.x, w.y, w.x, w.y] };
    } else {
      const pl = PLUMAS[herr];
      actual = { id: nuevoId('t'), capa: capaActiva(), tipo: 'trazo', herr, color: herr === 'lapiz' ? est.anot.color : est.anot.color,
        ancho: r3((pl.ancho * est.anot.grosor) / z), puntos: [r3(w.x), r3(w.y), r3(presion(e))] };
    }
    grupoPrevio().innerHTML = htmlAnotacion(actual);
    return 'trazo';
  }

  function mover(e) {
    if (arrastre) {
      const w = puntoMundo(e);
      if (!arrastre.movido) { app.antes(); arrastre.movido = true; }
      desplazar(arrastre.a, w.x - arrastre.ultimo.x, w.y - arrastre.ultimo.y);
      arrastre.ultimo = w;
      app.pintar();
      return;
    }
    if (est.anot.herr === 'borrador') { borrarEn(puntoMundo(e), false); return; }
    if (!actual) return;
    const eventos = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of eventos.length ? eventos : [e]) {
      const w = puntoMundo(ev);
      if (actual.tipo === 'flecha') { actual.puntos[2] = w.x; actual.puntos[3] = w.y; continue; }
      const n = actual.puntos.length;
      const ux = actual.puntos[n - 3], uy = actual.puntos[n - 2];
      // ignora movimientos de menos de medio píxel; suaviza un poco
      if (Math.hypot(w.x - ux, w.y - uy) * est.vista.z < 0.8) continue;
      const k = 0.55;
      actual.puntos.push(r3(ux + (w.x - ux) * k), r3(uy + (w.y - uy) * k), r3(presion(ev)));
    }
    grupoPrevio().innerHTML = htmlAnotacion(actual);
  }

  function terminar() {
    if (textoPendiente) {
      const w = textoPendiente;
      textoPendiente = null;
      abrirEditor(w);
      return;
    }
    if (arrastre) {
      if (arrastre.movido) app.cambio();
      arrastre = null;
      return;
    }
    if (est.anot.herr === 'borrador' && borrados) { borrados = false; app.cambio(); return; }
    if (!actual) return;
    const a = actual;
    actual = null;
    if (previa) previa.innerHTML = '';
    if (a.tipo === 'flecha' && Math.hypot(a.puntos[2] - a.puntos[0], a.puntos[3] - a.puntos[1]) * est.vista.z < 6) return;
    if (a.tipo === 'flecha') a.puntos = a.puntos.map(r3);
    app.antes();
    planta().anotaciones.push(a);
    app.cambio();
  }

  function cancelar() {
    actual = null;
    arrastre = null;
    textoPendiente = null;
    if (previa) previa.innerHTML = '';
  }

  let borrados = false;
  function borrarEn(w, primero) {
    const p = planta();
    const visibles = new Set(app.doc.capasAnotacion.filter((c) => c.visible).map((c) => c.id));
    const tol = 8 / est.vista.z;
    const quedan = p.anotaciones.filter((a) => !(visibles.has(a.capa) && toca(a, w, tol)));
    if (quedan.length === p.anotaciones.length) return;
    if (primero || !borrados) app.antes();
    borrados = true;
    p.anotaciones = quedan;
    app.pintar();
  }

  function buscar(w) {
    const p = planta();
    const visibles = new Set(app.doc.capasAnotacion.filter((c) => c.visible).map((c) => c.id));
    const tol = 8 / est.vista.z;
    for (let i = p.anotaciones.length - 1; i >= 0; i--) {
      const a = p.anotaciones[i];
      if (visibles.has(a.capa) && toca(a, w, tol)) return a;
    }
    return null;
  }

  function desplazar(a, dx, dy) {
    if (a.tipo === 'texto') { a.x = r3(a.x + dx); a.y = r3(a.y + dy); return; }
    const paso = a.tipo === 'flecha' ? 2 : 3;
    for (let i = 0; i < a.puntos.length; i += paso) { a.puntos[i] = r3(a.puntos[i] + dx); a.puntos[i + 1] = r3(a.puntos[i + 1] + dy); }
    cacheD.clear();
  }

  // ---------------------------------------------------------------- textos
  function abrirEditor(w, existente = null) {
    const r = app.svg.getBoundingClientRect();
    const lienzo = document.getElementById('lienzo').getBoundingClientRect();
    const v = est.vista;
    const tam = existente ? existente.tam : r3(Math.max(0.25, 16 / v.z));
    const pos = existente ? { x: existente.x, y: existente.y } : w;
    editor = document.createElement('textarea');
    editor.className = 'editor-texto';
    editor.value = existente ? existente.texto : '';
    editor.placeholder = 'Escribe…';
    editor.style.left = (pos.x * v.z + v.x + r.left - lienzo.left) + 'px';
    editor.style.top = (pos.y * v.z + v.y + r.top - lienzo.top - tam * v.z) + 'px';
    editor.style.fontSize = tam * v.z + 'px';
    editor.style.color = existente ? existente.color : est.anot.color;
    editor._datos = { pos, tam, existente };
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cerrarEditor(false); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); cerrarEditor(true); }
      e.stopPropagation();
    });
    editor.addEventListener('input', () => { editor.style.height = 'auto'; editor.style.height = editor.scrollHeight + 'px'; });
    editor.addEventListener('blur', () => setTimeout(() => editor && cerrarEditor(true), 0));
    document.getElementById('lienzo').appendChild(editor);
    setTimeout(() => editor?.focus(), 0);
  }

  function cerrarEditor(guardar) {
    const ed = editor;
    if (!ed) return;
    editor = null;
    const { pos, tam, existente } = ed._datos;
    const texto = ed.value.replace(/\s+$/, '');
    ed.remove();
    if (!guardar) return;
    const p = planta();
    if (existente) {
      if (texto === existente.texto) return;
      app.antes();
      if (texto) existente.texto = texto;
      else p.anotaciones = p.anotaciones.filter((a) => a !== existente);
      app.cambio();
      return;
    }
    if (!texto) return;
    app.antes();
    p.anotaciones.push({ id: nuevoId('t'), capa: capaActiva(), tipo: 'texto', x: r3(pos.x), y: r3(pos.y), tam, texto, color: est.anot.color });
    app.cambio();
  }

  function editarTexto(w) {
    const a = buscar(w);
    if (a?.tipo === 'texto') { abrirEditor(null, a); return true; }
    return false;
  }

  function borrarSeleccion() {
    const p = planta();
    if (!est.anotSel) return false;
    app.antes();
    p.anotaciones = p.anotaciones.filter((a) => a.id !== est.anotSel);
    est.anotSel = null;
    app.cambio();
    return true;
  }

  function borrarCapa(capa) {
    const p = planta();
    app.antes();
    p.anotaciones = p.anotaciones.filter((a) => a.capa !== capa);
    for (const [id, n] of Object.entries(p.elementos)) if (n.capa === capa) delete p.elementos[id];
    app.cambio();
  }

  return { quiere, empezar, mover, terminar, cancelar, editarTexto, borrarSeleccion, borrarCapa, cerrarEditor: () => cerrarEditor(true) };
}
