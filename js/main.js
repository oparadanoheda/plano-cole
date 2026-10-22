// Arranque y coordinación de la app «Plano del cole».
// Cinco modos: Ver (consultar), Editar (cambiar el plano), Anotar (dibujar encima),
// Red (equipos y cableado) y 3D.

import * as M from './modelo.js';
import * as R from './red.js';
import { pintarRedMundo, pintarRedSobre, htmlRedExport } from './redvista.js';
import { HERR_RED } from './redherr.js';
import { pintarEsquema, irAEquipo, irACable } from './redpanel.js';
import { salas } from './espacios.js';
import { pintarCalco, pintarModelo, htmlModelo, pintarSeleccion, pintarHover, pintarSobre, pintarRejilla, aplicarVista, caja, aPantalla } from './vista.js';
import { instalarInteraccion } from './herramientas.js';
import { pintarPanel, instalarPanel, pintarCapas, pintarVersiones, accionPanel } from './panel.js';
import { CSS_PLANO, CSS_EXPORT } from './estilo.js';
import * as A from './archivo.js';
import { num, fmtM2, fmtM, unit, sub, add, mul } from './geo.js';
import { CapaSatelite, ATRIBUCION, matrizDeSitio, matrizASitio, multiplicar, aplicar } from './satelite.js';
import { crearAnotador, pintarAnotaciones, htmlAnotacion, COLORES, PLUMAS, GROSORES } from './anotar.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

document.head.insertAdjacentHTML('beforeend', `<style>${CSS_PLANO}</style>`);

const est = {
  modo: 'ver',
  vista: { x: 0, y: 0, z: 20 },
  herr: 'sel', sel: null, temp: {}, hover: null, arrastrando: false,
  capas: {
    calco: false, calcoOpac: 0.4, pci: false, evacuacion: false, sectores: false, espacios: true, muros: true,
    rotulos: true, cotas: true, rejilla: true, sueltos: true, satelite: true, sateliteOpac: 1,
    red: true, wifi: false,
  },
  bloqueado: true, orto: true, paso: 0.05,
  grosor: 0.1, tipoMuro: 'tabique', estadoNuevo: 'medido', ancla: 'a',
  anot: { herr: 'boli', color: '#d92d20', grosor: 1, capa: null, soloLapiz: false, lapizVisto: false },
  anotSel: null, ajuste: null, capasAnotVisibles: new Set(),
  // red: cómo se tienden los cables nuevos; qué se resalta (foco); rastreo o dependientes;
  // punto del cable y puerto seleccionados
  redOp: { tipo: 'cat6', estado: 'servicio', canal: 'techo', fin: 'toma', orto: true },
  redFoco: null, redVer: null, redVert: null, redPuerto: null,
  edId: null, plId: null,
};

const app = {
  est,
  svg: $('#plano'),
  doc: null,
  info: { caras: [], salas: {} },
  archivo: { nombre: 'plano.plano.json', manejador: null, sucio: false, guardadoLocal: null },
};
const hist = { pila: [], rehacer: [] };

// ---------------------------------------------------------------------------- acceso
app.edificio = () => app.doc?.edificios.find((e) => e.id === est.edId) || null;
app.planta = () => app.edificio()?.plantas.find((p) => p.id === est.plId) || null;

function buscarPlanta(plId) {
  for (const { ed, p } of M.plantas(app.doc)) if (p.id === plId) return { ed, p };
  return null;
}

// ---------------------------------------------------------------------------- dibujo
let calcoDibujado = null;
let marcoPendiente = false;
const gCalco = $('#g-calco'), gModelo = $('#g-modelo'), gSel = $('#g-sel'), gSobre = $('#g-sobre'), gMundo = $('#mundo');
const gRejilla = $('#g-rejilla'), gHover = $('#g-hover'), gAnot = $('#g-anot'), gContexto = $('#g-contexto');
const gRed = $('#g-red'), gRedSobre = $('#g-red-sobre');
const satelite = new CapaSatelite($('#g-satelite'), app);

app.recalcular = () => { const p = app.planta(); app.info = p ? salas(p) : { caras: [], salas: {} }; };

app.pintar = ({ calco = false } = {}) => {
  const p = app.planta();
  const conFoto = !!(est.capas.satelite && app.doc?.sitio);
  document.body.classList.toggle('con-satelite', conFoto);
  const at = $('#atribucion');
  at.hidden = !conFoto || est.modo === '3d';
  at.textContent = ATRIBUCION;
  const clave = p ? p.id + JSON.stringify([est.capas.calco, est.capas.calcoOpac, est.capas.pci, est.capas.evacuacion, est.capas.sectores]) : '';
  if (calco || clave !== calcoDibujado) {
    if (p) pintarCalco(gCalco, p, est.capas); else gCalco.innerHTML = '';
    calcoDibujado = clave;
  }
  if (p) {
    pintarModelo(gModelo, p, app.info, est.capas);
    pintarAnotaciones(gAnot, p, app);
    pintarSeleccion(gSel, p, est.sel, app.info);
    pintarHover(gHover, p, est.hover, app.info);
    pintarRedMundo(gRed, app);
    pintarContexto();
  } else {
    gModelo.innerHTML = gSel.innerHTML = gAnot.innerHTML = gHover.innerHTML = gContexto.innerHTML = gRed.innerHTML = '';
  }
  app.pintarVista();
};

app.pintarHover = () => { const p = app.planta(); if (p) pintarHover(gHover, p, est.hover, app.info); };

/** En la vista «Exterior» se ven encima los demás edificios, colocados en su sitio. */
function pintarContexto() {
  const ed = app.edificio(), p = app.planta();
  if (!ed?.exterior) { gContexto.innerHTML = ''; return; }
  let html = '';
  for (const e2 of app.doc.edificios) {
    if (e2.exterior || !e2.plantas.length) continue;
    const p0 = [...e2.plantas].sort((a, b) => Math.abs(a.nivel) - Math.abs(b.nivel))[0];
    const T = multiplicar(matrizDeSitio(p), matrizASitio(p0));
    html += `<g class="contexto" transform="matrix(${T.join(' ')})">${htmlModelo(p0, salas(p0), { muros: true, espacios: true })}</g>`;
  }
  gContexto.innerHTML = html;
}

app.pintarVista = () => {
  aplicarVista(gMundo, est.vista);
  app.pintarSobre();
};

app.pintarSobre = () => {
  if (marcoPendiente) return;
  marcoPendiente = true;
  requestAnimationFrame(() => {
    marcoPendiente = false;
    const p = app.planta();
    pintarRejilla(gRejilla, est, app.svg.clientWidth, app.svg.clientHeight);
    satelite.pintar();
    if (!p) { gSobre.innerHTML = gRedSobre.innerHTML = ''; return; }
    pintarSobre(gSobre, p, est, app.info, app.svg.clientWidth, app.svg.clientHeight);
    pintarRedSobre(gRedSobre, app, app.svg.clientWidth, app.svg.clientHeight);
    pintarBarraContexto();
  });
};

/** Caja a encuadrar: la planta, o en el exterior, todos los edificios. */
function cajaEncuadre(p) {
  if (!app.edificio()?.exterior) return caja(p);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e2 of app.doc.edificios) {
    if (e2.exterior) continue;
    for (const p2 of e2.plantas) {
      const T = multiplicar(matrizDeSitio(p), matrizASitio(p2));
      const c = caja(p2);
      for (const q of [{ x: c.x0, y: c.y0 }, { x: c.x1, y: c.y1 }]) {
        const r = aplicar(T, q);
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x); y1 = Math.max(y1, r.y);
      }
    }
  }
  if (!Number.isFinite(x0)) return caja(p);
  return { x0: x0 - 15, y0: y0 - 15, x1: x1 + 15, y1: y1 + 15 };
}

let intentosEncuadre = 0;
app.encuadrar = () => {
  const p = app.planta();
  if (!p) return;
  // si el lienzo aún no tiene tamaño (la página se está montando), se espera un poco
  if ((app.svg.clientWidth < 50 || app.svg.clientHeight < 50) && intentosEncuadre++ < 30) {
    requestAnimationFrame(() => app.encuadrar());
    return;
  }
  intentosEncuadre = 0;
  const c = cajaEncuadre(p);
  const w = app.svg.clientWidth;
  const hoja = innerWidth <= 820 && !document.body.classList.contains('sin-panel') ? $('#panel').offsetHeight : 0;
  const h = app.svg.clientHeight - hoja;
  const m = 56;
  const z = Math.min((w - 2 * m - 60) / Math.max(c.x1 - c.x0, 1), (h - 2 * m - 30) / Math.max(c.y1 - c.y0, 1));
  est.vista.z = Math.min(Math.max(z, 0.5), 400);
  est.vista.x = (w - 60 - (c.x1 - c.x0) * est.vista.z) / 2 - c.x0 * est.vista.z;
  est.vista.y = (h - 30 - (c.y1 - c.y0) * est.vista.z) / 2 - c.y0 * est.vista.z;
  app.pintarVista();
};

// ---------------------------------------------------------------------------- cambios e historial
let temporizador = null;
const apilar = (e) => {
  hist.pila.push(e);
  if (hist.pila.length > 150) hist.pila.shift();
  hist.rehacer = [];
  pintarBotonesHistorial();
};
app.antes = () => {
  const p = app.planta();
  if (p) apilar({ plId: p.id, json: M.contenido(p) });
};
/** Antes de cambiar la red (es de todo el centro, no de una planta). */
app.antesRed = () => apilar({ red: JSON.stringify(app.doc.red) });

/** Algo ha cambiado en el modelo. «ligero» durante los arrastres: sin panel ni guardado. */
app.cambio = (ligero = false) => {
  app.recalcular();
  R.olvidarSalas();
  const p = app.planta();
  if (est.sel && !existe(p, est.sel)) est.sel = null;
  if (est.anotSel && !p?.anotaciones.some((a) => a.id === est.anotSel)) est.anotSel = null;
  const c = est.sel?.tipo === 'cable' && app.doc.red.cables[est.sel.id];
  if (est.redVert && !(c && est.redVert.i < (c.tramos[est.redVert.t]?.pts.length ?? 0) / 2)) est.redVert = null;
  app.focoRed();
  app.pintar();
  if (ligero) return;
  app.panel();
  pintarPaleta();
  marcarSucio();
};

function existe(p, sel) {
  if (!p) return false;
  switch (sel.tipo) {
    case 'muro': return !!p.muros[sel.id];
    case 'nodo': return !!p.nodos[sel.id];
    case 'abertura': return !!M.buscarAbertura(p, sel.id);
    case 'espacio': return !!p.espacios[sel.id];
    case 'pilar': return !!p.pilares[sel.id];
    case 'nota': return !!p.elementos[sel.id];
    case 'equipo': return !!app.doc.red.equipos[sel.id];
    case 'cable': return !!app.doc.red.cables[sel.id];
  }
  return false;
}

function deshacerRehacer(de, a) {
  const e = de.pop();
  if (!e) return false;
  if (e.red !== undefined) {
    a?.push({ red: JSON.stringify(app.doc.red) });
    app.doc.red = JSON.parse(e.red);
    app.cambio();
    pintarBotonesHistorial();
    return true;
  }
  const r = buscarPlanta(e.plId);
  if (!r) return false;
  a?.push({ plId: e.plId, json: M.contenido(r.p) });
  M.restaurar(r.p, e.json);
  if (r.p.id !== est.plId) irAPlanta(r.ed.id, r.p.id, false);
  app.cambio();
  pintarBotonesHistorial();
  return true;
}
const puedeDeshacer = () => est.modo === 'editar' || est.modo === 'anotar' || est.modo === 'red';
app.deshacer = (silencioso = false) => {
  if (!puedeDeshacer() && !silencioso) return;
  deshacerRehacer(hist.pila, silencioso ? null : hist.rehacer);
};
app.rehacer = () => { if (puedeDeshacer()) deshacerRehacer(hist.rehacer, hist.pila); };

function pintarBotonesHistorial() {
  $('#b-deshacer').disabled = !puedeDeshacer() || !hist.pila.length;
  $('#b-rehacer').disabled = !puedeDeshacer() || !hist.rehacer.length;
}

function marcarSucio() {
  app.archivo.sucio = true;
  pintarEstadoGuardado();
  clearTimeout(temporizador);
  temporizador = setTimeout(guardarEnNavegador, 700);
}
app.marcarSucio = marcarSucio;

async function guardarEnNavegador() {
  if (!app.doc) return;
  try {
    await A.guardarLocal('doc', JSON.stringify(app.doc));
    await A.guardarLocal('meta', { nombre: app.archivo.nombre, sucio: app.archivo.sucio, plId: est.plId, edId: est.edId, vista: est.vista });
    app.archivo.guardadoLocal = new Date();
  } catch (e) {
    app.aviso('No se pudo guardar la copia en el navegador: ' + e.message, 'error');
  }
  pintarEstadoGuardado();
}

function pintarEstadoGuardado() {
  const el = $('#est-guardado');
  const s = app.archivo.sucio;
  document.body.classList.toggle('sucio', s);
  el.classList.toggle('sucio', s);
  el.textContent = !app.doc ? '' : s ? `Sin guardar en «${app.archivo.nombre}»` : `Guardado en «${app.archivo.nombre}»`;
}

// ---------------------------------------------------------------------------- selección
app.seleccionar = (sel) => {
  if (sel?.tipo !== est.sel?.tipo || sel?.id !== est.sel?.id) { est.redVer = null; est.redVert = null; est.redPuerto = null; }
  est.sel = sel;
  app.focoRed();
  const p = app.planta();
  if (p) { pintarSeleccion(gSel, p, sel, app.info); pintarRedMundo(gRed, app); }
  app.pintarSobre();
  app.panel();
  if (innerWidth <= 820) document.body.classList.toggle('sin-panel', !sel);
  else if (sel && est.modo !== 'anotar') document.body.classList.remove('sin-panel');
};

/** Qué se resalta de la red: lo conectado a lo seleccionado, o el rastreo o lo que depende. */
app.focoRed = () => {
  const red = app.doc?.red, sel = est.sel;
  est.redFoco = null;
  if (!red || !sel) return;
  if (sel.tipo === 'equipo' && red.equipos[sel.id]) {
    if (est.redVer?.id === sel.id) {
      const arb = R.arbol(red);
      const r = est.redVer.modo === 'rastreo' ? R.camino(arb, sel.id) : R.descendientes(arb, sel.id);
      est.redFoco = { equipos: new Set([sel.id, ...r.equipos]), cables: new Set(r.cables) };
      return;
    }
    const propios = [sel.id, ...Object.keys(red.equipos).filter((id) => red.equipos[id].en === sel.id)];
    const equipos = new Set(propios), cables = new Set();
    for (const [cid, c] of Object.entries(red.cables)) {
      if (!propios.includes(c.a?.eq) && !propios.includes(c.b?.eq)) continue;
      cables.add(cid);
      if (c.a) equipos.add(c.a.eq);
      if (c.b) equipos.add(c.b.eq);
    }
    est.redFoco = { equipos, cables };
  } else if (sel.tipo === 'cable' && red.cables[sel.id]) {
    const c = red.cables[sel.id];
    est.redFoco = { equipos: new Set([c.a?.eq, c.b?.eq].filter(Boolean)), cables: new Set([sel.id]) };
  }
};

app.seleccionarDesde3D = (edId, plId, esp) => {
  if (plId && plId !== est.plId) { est.edId = edId; est.plId = plId; app.recalcular(); app.pintarPlantas(); }
  app.seleccionar(esp ? { tipo: 'espacio', id: esp } : null);
};

app.panel = () => {
  pintarPanel(app);
  if (!$('#pop-capas').hidden) pintarCapas(app);
  if (!$('#pest-esquema').hidden) pintarEsquema(app);
};

app.enfocarPanel = () => {
  document.body.classList.remove('sin-panel');
  document.querySelector('.pestanas [data-pest="props"]').click();
  const i = $('#pest-props').querySelector('input:not([disabled]), textarea:not([disabled])');
  if (i) { i.focus(); i.select?.(); }
};

app.borrarSeleccion = () => {
  const p = app.planta();
  if (!p) return;
  if (est.sel?.tipo === 'equipo' || est.sel?.tipo === 'cable') {
    if (est.modo !== 'red') return;
    const red = app.doc.red, { tipo, id } = est.sel;
    // con un punto del cable seleccionado, se quita ese punto
    if (tipo === 'cable' && est.redVert && app.redHerr.quitarVertice()) return;
    app.antesRed();
    if (tipo === 'cable') delete red.cables[id];
    else {
      const n = R.borrarEquipo(red, R.indicePlantas(app.doc), id);
      if (n) app.aviso(n === 1 ? 'Un cable se ha quedado con un extremo suelto.' : `${n} cables se han quedado con un extremo suelto.`);
    }
    est.sel = null;
    app.cambio();
    return;
  }
  if (est.modo === 'anotar') {
    if (anotador.borrarSeleccion()) return;
    if (est.sel?.tipo === 'nota') { app.antes(); delete p.elementos[est.sel.id]; est.sel = null; app.cambio(); }
    return;
  }
  const sel = est.sel;
  if (!sel || est.modo !== 'editar') return;
  app.antes();
  switch (sel.tipo) {
    case 'muro': M.borrarMuro(p, sel.id); break;
    case 'nodo': M.borrarNodo(p, sel.id); break;
    case 'abertura': { const r = M.buscarAbertura(p, sel.id); r.m.aberturas = r.m.aberturas.filter((o) => o.id !== sel.id); break; }
    case 'espacio': delete p.espacios[sel.id]; break;
    case 'pilar': p.pilares.splice(sel.id, 1); break;
    case 'nota': delete p.elementos[sel.id]; break;
  }
  est.sel = null;
  app.cambio();
};

// ---------------------------------------------------------------------------- barra contextual (Editar)
function pintarBarraContexto() {
  const b = $('#barra-contexto');
  const p = app.planta();
  const sel = est.sel;
  if ((est.modo !== 'editar' && est.modo !== 'red') || est.herr !== 'sel' || !sel || !p || est.arrastrando || est.ajuste) { b.hidden = true; return; }
  let pos = null, html = '';
  const borrar = '<button data-ctx="borrar" class="peligro"><svg class="ic"><use href="#i-papelera"/></svg>Borrar</button>';
  const red = app.doc.red;
  if (est.modo === 'red') {
    if (sel.tipo === 'equipo' && red.equipos[sel.id]) {
      const icono = app.redIconos?.find((q) => q.id === (red.equipos[sel.id].en || sel.id));
      if (icono) {
        pos = icono.pos;
        html = `<span class="medida">${esc(red.equipos[sel.id].nombre)}</span><button data-ctx="red-cable"><svg class="ic"><use href="#i-cable"/></svg>Cable</button>` +
          `<button data-ctx="red-rastrear">Rastrear</button>${borrar}`;
      }
    } else if (sel.tipo === 'cable' && red.cables[sel.id]) {
      const c = red.cables[sel.id], v = est.redVert, t = v && c.tramos[v.t];
      if (t && t.pl === p.id) {
        pos = { x: t.pts[v.i * 2], y: t.pts[v.i * 2 + 1] };
        html = `<button data-ctx="red-quitar-punto">Quitar punto</button>${borrar}`;
      } else {
        const ctx = R.contexto(app.doc);
        const tr = R.recorrido(red, ctx.ip, c).tramos.find((x) => x.pl === p.id && x.pts.length >= 2);
        if (tr) {
          const i = Math.floor((tr.pts.length - 2) / 2);
          pos = mul(add(tr.pts[i], tr.pts[i + 1]), 0.5);
          html = `<span class="medida">≈ ${Math.round(R.longitud(ctx, c).total)} m</span>${borrar}`;
        }
      }
    }
  } else if (sel.tipo === 'muro' && p.muros[sel.id]) {
    const m = p.muros[sel.id];
    const A = p.nodos[m.a], B = p.nodos[m.b];
    pos = mul(add(A, B), 0.5);
    html = `<span class="medida">${fmtM(M.largo(p, m))}</span>
      <button data-ctx="puerta"><svg class="ic"><use href="#i-puerta"/></svg>Puerta</button>
      <button data-ctx="ventana"><svg class="ic"><use href="#i-ventana"/></svg>Ventana</button>
      <button data-ctx="partir">Partir</button>${borrar}`;
  } else if (sel.tipo === 'abertura') {
    const r = M.buscarAbertura(p, sel.id);
    if (!r) { b.hidden = true; return; }
    const [A, B] = M.extremos(p, r.m);
    pos = add(A, mul(unit(sub(B, A)), r.o.pos));
    html = `<span class="medida">${num(r.o.ancho)} m</span>` + (r.o.tipo.startsWith('puerta')
      ? '<button data-ctx="lado">Voltear</button>' + (r.o.tipo === 'puerta' ? '<button data-ctx="bisagra">Bisagra</button>' : '') : '') + borrar;
  } else if (sel.tipo === 'espacio' && p.espacios[sel.id]) {
    pos = p.espacios[sel.id];
    html = `<button data-ctx="renombrar"><svg class="ic"><use href="#i-editar"/></svg>Renombrar</button>${borrar}`;
  } else if (sel.tipo === 'nodo' && p.nodos[sel.id]) {
    pos = p.nodos[sel.id]; html = borrar;
  } else if (sel.tipo === 'pilar' && p.pilares[sel.id]) {
    const pl = p.pilares[sel.id]; pos = { x: pl.x + pl.an / 2, y: pl.y }; html = borrar;
  } else if (sel.tipo === 'nota' && p.elementos[sel.id]) {
    pos = p.elementos[sel.id]; html = `<button data-ctx="renombrar">Editar</button>${borrar}`;
  }
  if (!pos) { b.hidden = true; return; }
  const s = aPantalla(est.vista, pos);
  const w = app.svg.clientWidth;
  if (s.x < 0 || s.y < 0 || s.x > w || s.y > app.svg.clientHeight) { b.hidden = true; return; }
  if (b.dataset.html !== html) { b.innerHTML = html; b.dataset.html = html; }
  b.hidden = false;
  const ancho = b.offsetWidth;
  b.style.left = Math.min(Math.max(s.x, ancho / 2 + 8), w - ancho / 2 - 70) + 'px';
  b.style.top = Math.max(s.y - 22, b.offsetHeight + 8) + 'px';
}

$('#barra-contexto').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ctx]');
  if (!b) return;
  const p = app.planta();
  const sel = est.sel;
  const acc = b.dataset.ctx;
  if (acc === 'borrar') app.borrarSeleccion();
  else if (acc === 'red-quitar-punto') app.redHerr.quitarVertice();
  else if (acc === 'red-cable' && sel?.tipo === 'equipo') {
    const id = sel.id;
    app.herramienta('cable');
    app.redHerr.cableDesde(id);
  } else if (acc === 'red-rastrear' && sel?.tipo === 'equipo') {
    if (!R.arbol(app.doc.red).padre.get(sel.id)) { app.aviso('No está conectado a nada por encima: es el principio de la red, o le falta el cable.'); return; }
    est.redVer = est.redVer?.modo === 'rastreo' && est.redVer.id === sel.id ? null : { modo: 'rastreo', id: sel.id };
    app.focoRed();
    app.pintar();
    app.panel();
    document.body.classList.remove('sin-panel');
  } else if (acc === 'renombrar') app.enfocarPanel();
  else if (acc === 'partir' || acc === 'lado' || acc === 'bisagra') accionPanel(app, acc);
  else if ((acc === 'puerta' || acc === 'ventana') && sel?.tipo === 'muro') {
    const m = p.muros[sel.id];
    const L = M.largo(p, m);
    const ancho = Math.min(M.ANCHOS[acc], L);
    // busca un hueco libre, empezando por el centro
    const libre = (pos) => !m.aberturas.some((o) => Math.abs(o.pos - pos) < (o.ancho + ancho) / 2 + 0.05);
    let pos = null;
    for (let k = 0; k <= 40 && pos === null; k++) {
      for (const sg of [1, -1]) {
        const t = L / 2 + sg * k * 0.25;
        if (t >= ancho / 2 && t <= L - ancho / 2 && libre(t)) { pos = t; break; }
      }
    }
    if (pos === null) { app.aviso('No cabe otra abertura en este muro.'); return; }
    app.antes();
    const o = M.anadirAbertura(p, sel.id, acc, pos);
    app.cambio();
    app.seleccionar({ tipo: 'abertura', id: o.id });
  }
});

// ---------------------------------------------------------------------------- modos
const PISTAS = {
  sel: 'Toca un muro, una puerta o una sala. Arrastra para moverlos; con dos dedos o la rueda, zoom.',
  muro: 'Toca para empezar y ve tocando esquinas. Con teclado, escribe una medida (6,40) e Intro. Para acabar: «Terminar», doble toque o Esc.',
  puerta: 'Toca un muro para poner una puerta. Abrirá hacia el lado donde toques.',
  ventana: 'Toca un muro para poner una ventana.',
  paso: 'Toca un muro para abrir un paso sin puerta.',
  espacio: 'Toca dentro de una sala cerrada para ponerle nombre y ver su superficie.',
  pilar: 'Toca donde va el pilar (40 × 40 cm; luego puedes cambiarlo).',
  nota: 'Toca donde quieras dejar una nota (p. ej. «pendiente de medir»).',
  medir: 'Toca dos puntos. Se ajusta a esquinas y muros.',
  ver: 'Toca una sala para ver su ficha. Busca arriba por nombre o grupo.',
  anotar: 'Dibuja con el lápiz o el ratón. Con dos dedos mueves y haces zoom.',
  anotarLapiz: 'El Apple Pencil dibuja; el dedo mueve el plano.',
  red: 'Toca un equipo o un cable para ver su ficha. Arrastra un equipo para moverlo: sus cables le siguen.',
  cable: 'Toca un equipo (o un punto) para empezar, ve tocando las esquinas y acaba en otro equipo. Para subir o bajar, cambia de planta. Doble toque o «Terminar» acaba.',
  armario: 'Toca donde está el armario (rack).',
  router: 'Toca donde está el router. Si tocas un armario, va dentro.',
  switch: 'Toca donde está el switch. Si tocas un armario, va dentro.',
  ap: 'Toca donde está el punto de acceso WiFi.',
  toma: 'Toca donde está la toma de red.',
  equipo: 'Toca donde está el ordenador, la impresora o el proyector.',
};
const FINALES = { toma: 'toma nueva', ap: 'WiFi nuevo', equipo: 'equipo nuevo', libre: 'suelto' };

app.modo = async (m) => {
  if (!app.doc && m !== 'ver') return;
  const antes = est.modo;
  if (antes === m) return;
  if (antes === 'anotar') anotador.cerrarEditor();
  if (est.ajuste) app.terminarAjuste(true);
  est.modo = m;
  est.bloqueado = m !== 'editar';
  document.body.classList.remove('modo-ver', 'modo-editar', 'modo-anotar', 'modo-red', 'modo-3d');
  document.body.classList.add('modo-' + m);
  document.querySelectorAll('[data-modo]').forEach((b) => b.classList.toggle('activo', b.dataset.modo === m));
  est.temp = {};
  est.hover = null;
  est.anotSel = null;
  // en Editar y Anotar la red no se toca: fuera su selección
  if ((m === 'editar' || m === 'anotar') && (est.sel?.tipo === 'equipo' || est.sel?.tipo === 'cable')) { est.sel = null; app.focoRed(); }
  if (m !== 'red' && m !== 'ver' && !$('#pest-esquema').hidden) document.querySelector('.pestanas [data-pest="props"]').click();
  if (m === 'editar') app.herramienta(est.herrEditar || 'sel');
  else if (m === 'red') app.herramienta(est.herrRed || 'sel');
  else { est.herr = 'sel'; app.svg.dataset.herr = 'sel'; pintarOpciones(); }
  if (m === 'anotar' && innerWidth <= 820) document.body.classList.add('sin-panel');
  $('#b-medir').classList.toggle('activo', est.herr === 'medir');
  pintarPaleta();
  app.pintarPlantas();
  app.panel();
  pintarVersiones(app);
  pintarBotonesHistorial();
  if (m === '3d') await abrir3D(); else cerrar3D();
  app.pintar();
  // el panel cambia el ancho del lienzo
  requestAnimationFrame(() => app.pintarSobre());
};

app.herramienta = (h) => {
  if (HERR_RED.includes(h)) { if (est.modo !== 'red') app.modo('red'); }
  else if (h !== 'medir' && h !== 'sel' && est.modo !== 'editar') app.modo('editar');
  if (h === 'medir' && est.modo === 'anotar') app.modo('ver');
  est.herr = h;
  if (est.modo === 'editar') est.herrEditar = h;
  if (est.modo === 'red') est.herrRed = h;
  est.temp = {};
  app.svg.dataset.herr = h;
  document.querySelectorAll('[data-herr]').forEach((b) => b.classList.toggle('activa', b.dataset.herr === h));
  $('#b-medir').classList.toggle('activo', h === 'medir');
  pintarOpciones();
  app.pintarSobre();
};

function pintarOpciones() {
  const o = $('#opciones');
  const h = est.herr;
  const pista = est.modo === 'anotar' ? (est.anot.soloLapiz ? PISTAS.anotarLapiz : PISTAS.anotar)
    : est.modo === 'ver' && h === 'sel' ? PISTAS.ver : est.modo === 'red' && h === 'sel' ? PISTAS.red : PISTAS[h] || '';
  $('#est-pista').textContent = pista;
  if (est.modo === 'red' && h === 'cable') {
    // cómo son los cables que se tienden
    const op = est.redOp;
    const lista = (k, obj) => `<select data-opr="${k}">${Object.entries(obj).map(([v, t]) => `<option value="${v}"${op[k] === v ? ' selected' : ''}>${esc(typeof t === 'string' ? t : t.nombre)}</option>`).join('')}</select>`;
    o.innerHTML = `<label>Cable ${lista('tipo', R.TIPOS_CABLE)}</label><label>Va por ${lista('canal', R.CANALES)}</label>
      <label>Estado ${lista('estado', R.ESTADOS_CABLE)}</label><label title="Qué se pone donde acaba el cable cuando no acaba en un equipo">Final ${lista('fin', FINALES)}</label>
      <label class="interruptor"><input type="checkbox" data-opr="orto" ${op.orto ? 'checked' : ''}> Ortogonal</label>` +
      (est.temp.cable ? '<button class="btn primario" data-op-terminar style="height:32px">Terminar</button>' : '');
    o.hidden = false;
    return;
  }
  if (est.modo !== 'editar' || (h !== 'muro' && h !== 'medir')) { o.hidden = true; return; }
  let html = '';
  if (h === 'muro') {
    const grosores = [0.07, 0.1, 0.15, 0.2, 0.25, 0.3, 0.43];
    if (!grosores.includes(est.grosor)) grosores.push(est.grosor);
    html += `<label>Grosor <select data-op="grosor">${grosores.sort((a, b) => a - b).map((g) => `<option value="${g}"${g === est.grosor ? ' selected' : ''}>${num(g)} m</option>`).join('')}</select></label>
      <label>Tipo <select data-op="tipoMuro">${Object.entries(M.TIPOS_MURO).map(([k, v]) => `<option value="${k}"${k === est.tipoMuro ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Estado <select data-op="estadoNuevo">${Object.entries(M.ESTADOS_MURO).map(([k, v]) => `<option value="${k}"${k === est.estadoNuevo ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="interruptor"><input type="checkbox" data-op="orto" ${est.orto ? 'checked' : ''}> Ortogonal</label>`;
  }
  html += `<label class="interruptor"><input type="checkbox" data-op="paso" ${est.paso ? 'checked' : ''}> 5 cm</label>`;
  // mientras se dibuja una cadena de muros, un botón para acabarla (en el iPad no hay Esc)
  if (h === 'muro' && est.temp.cadena?.length) html += '<button class="btn primario" data-op-terminar style="height:32px">Terminar</button>';
  o.innerHTML = html;
  o.hidden = false;
}
app.pintarOpciones = pintarOpciones;

$('#opciones').addEventListener('click', (e) => {
  if (e.target.closest('[data-op-terminar]')) app.terminar();
});
$('#opciones').addEventListener('change', (e) => {
  const kr = e.target.dataset.opr;
  if (kr) {
    est.redOp[kr] = kr === 'orto' ? e.target.checked : e.target.value;
    app.guardarPreferencias();
    return;
  }
  const k = e.target.dataset.op;
  if (!k) return;
  if (k === 'grosor') est.grosor = +e.target.value;
  else if (k === 'orto') est.orto = e.target.checked;
  else if (k === 'paso') est.paso = e.target.checked ? 0.05 : 0;
  else est[k] = e.target.value;
  app.guardarPreferencias();
});

// ---------------------------------------------------------------------------- Anotar
const anotador = crearAnotador(app);
app.anotar = anotador;

const HERR_ANOT = [
  ['seleccion', 'i-sel', 'Seleccionar y mover'], ['boli', 'i-boli', 'Bolígrafo'], ['rotulador', 'i-rotulador', 'Rotulador'],
  ['lapiz', 'i-lapiz', 'Lápiz'], ['borrador', 'i-borrador', 'Borrador'], ['texto', 'i-texto', 'Texto'],
  ['flecha', 'i-flecha', 'Flecha'], ['nota', 'i-nota', 'Nota'],
];

function pintarPaleta() {
  const pal = $('#paleta');
  if (est.modo !== 'anotar' || !app.doc) { pal.hidden = true; return; }
  const a = est.anot;
  const capas = app.doc.capasAnotacion;
  if (!capas.some((c) => c.id === a.capa)) a.capa = capas[0].id;
  pal.innerHTML = `
    <div class="grupo">${HERR_ANOT.map(([k, ic, t]) => `<button class="herr ${a.herr === k ? 'activa' : ''}" data-anot-herr="${k}" title="${t}"><svg class="ic"><use href="#${ic}"/></svg></button>`).join('')}</div>
    <span class="sep-v"></span>
    <div class="grupo">${COLORES.map((c) => `<button class="color ${a.color === c ? 'activo' : ''}" data-anot-color="${c}" style="background:${c}" title="Color"></button>`).join('')}</div>
    <span class="sep-v"></span>
    <div class="grupo">${GROSORES.map((g, i) => `<button class="grosor ${a.grosor === g ? 'activo' : ''}" data-anot-grosor="${g}" title="Grosor"><i style="height:${[2, 3, 5, 8][i]}px"></i></button>`).join('')}</div>
    <span class="sep-v"></span>
    <select data-anot-capa aria-label="Capa donde se dibuja">${capas.map((c) => `<option value="${c.id}"${c.id === a.capa ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}<option value="__nueva">+ Nueva capa…</option></select>
    <label class="interruptor" title="Con el Apple Pencil: el dedo mueve el plano en vez de dibujar"><input type="checkbox" data-anot-solo ${a.soloLapiz ? 'checked' : ''}> Solo el lápiz dibuja</label>
    ${esTextoSel() ? '<button class="btn" data-anot-editar style="height:36px">Editar texto</button>' : ''}
    ${est.anotSel ? '<button class="btn peligro" data-anot-borrar style="height:36px">Borrar</button>' : ''}`;
  pal.hidden = false;
}
app.pintarBarraAnot = pintarPaleta;
const esTextoSel = () => !!est.anotSel && app.planta()?.anotaciones.some((x) => x.id === est.anotSel && x.tipo === 'texto');

$('#paleta').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const a = est.anot;
  if (b.dataset.anotHerr) { a.herr = b.dataset.anotHerr; if (a.herr !== 'seleccion') est.anotSel = null; app.pintar(); }
  else if (b.dataset.anotColor) a.color = b.dataset.anotColor;
  else if (b.dataset.anotGrosor) a.grosor = +b.dataset.anotGrosor;
  else if ('anotBorrar' in b.dataset) { anotador.borrarSeleccion(); }
  else if ('anotEditar' in b.dataset) { anotador.editarSeleccion(); return; }
  pintarPaleta();
  app.guardarPreferencias();
});
$('#paleta').addEventListener('change', (e) => {
  if ('anotCapa' in e.target.dataset) {
    if (e.target.value === '__nueva') {
      const nombre = prompt('Nombre de la capa de anotaciones:', 'Anotaciones ' + (app.doc.capasAnotacion.length + 1));
      if (nombre) {
        const id = M.nuevoId('a');
        app.doc.capasAnotacion.push({ id, nombre, visible: true });
        est.anot.capa = id;
        app.cambioCapasAnot();
      } else pintarPaleta();
      return;
    }
    est.anot.capa = e.target.value;
    pintarPaleta();
  } else if ('anotSolo' in e.target.dataset) {
    est.anot.soloLapiz = e.target.checked;
    pintarOpciones();
    app.guardarPreferencias();
  }
});

app.cambioCapasAnot = () => {
  est.capasAnotVisibles = new Set(app.doc.capasAnotacion.filter((c) => c.visible).map((c) => c.id));
  marcarSucio();
  pintarCapas(app);
  pintarPaleta();
  app.pintar();
};

// ---------------------------------------------------------------------------- foto aérea: ajuste
app.empezarAjuste = () => {
  const p = app.planta();
  if (!app.doc.sitio) {
    const c = caja(p);
    app.doc.sitio = { ancla: { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, lat: 40.4168, lon: -3.7038 }, rumbo: 0 };
  }
  est.ajuste = {
    modo: 'foto',
    copia: JSON.stringify({ sitio: app.doc.sitio, coloc: [...M.plantas(app.doc)].map(({ p: q }) => q.colocacion) }),
    rumbo0: app.doc.sitio.rumbo,
  };
  est.capas.satelite = true;
  document.body.classList.add('ajustando');
  pintarAjuste();
  app.pintar();
};

function pintarAjuste() {
  const c = $('#ajuste-sat');
  if (!est.ajuste) { c.hidden = true; return; }
  const s = app.doc.sitio;
  const ed = app.edificio();
  const otro = app.doc.edificios.findIndex((e) => e === ed) > 0;
  c.innerHTML = `
    <h3>Colocar el plano sobre la foto aérea</h3>
    <p>Arrastra sobre el plano para mover ${est.ajuste.modo === 'foto' ? 'la foto' : 'este edificio'} hasta que coincidan los bordes.
      Usa la transparencia en Capas para ver mejor.</p>
    ${otro ? `<div class="seg-mini"><button data-aj-modo="foto" class="${est.ajuste.modo === 'foto' ? 'activa' : ''}">Mover la foto (todo el cole)</button>
      <button data-aj-modo="edificio" class="${est.ajuste.modo === 'edificio' ? 'activa' : ''}">Mover solo este edificio</button></div>` : ''}
    <div class="fila"><span>Giro</span>
      <button class="btn-ic" data-aj-giro="-0.5" title="Girar a la izquierda"><svg class="ic"><use href="#i-girar"/></svg></button>
      <input type="range" min="${(est.ajuste.rumbo0 - 20).toFixed(1)}" max="${(est.ajuste.rumbo0 + 20).toFixed(1)}" step="0.1" value="${s.rumbo}" data-aj-rumbo>
      <span class="valor">${num(s.rumbo).replace(/,?0+$/, '')}°</span></div>
    <div class="fila"><span>Coordenadas</span>
      <input data-aj-coord value="${s.ancla.lat.toFixed(6)}, ${s.ancla.lon.toFixed(6)}" style="flex:1;height:34px;border:1px solid var(--linea-2);border-radius:8px;padding:0 8px" title="Latitud, longitud (por ejemplo, copiadas de Google Maps)"></div>
    <div class="fila fin"><button class="btn" data-aj-fin="no">Cancelar</button><button class="btn primario" data-aj-fin="si">Listo</button></div>`;
  c.hidden = false;
}

$('#ajuste-sat').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.ajModo) { est.ajuste.modo = b.dataset.ajModo; pintarAjuste(); }
  else if (b.dataset.ajGiro) { app.doc.sitio.rumbo = Math.round((app.doc.sitio.rumbo + +b.dataset.ajGiro) * 10) / 10; pintarAjuste(); app.pintar(); }
  else if (b.dataset.ajFin) app.terminarAjuste(b.dataset.ajFin === 'si');
});
$('#ajuste-sat').addEventListener('input', (e) => {
  if ('ajRumbo' in e.target.dataset) {
    app.doc.sitio.rumbo = +e.target.value;
    e.target.parentElement.querySelector('.valor').textContent = num(app.doc.sitio.rumbo).replace(/,?0+$/, '') + '°';
    app.pintar();
  }
});
$('#ajuste-sat').addEventListener('change', (e) => {
  if ('ajCoord' in e.target.dataset) {
    const m = e.target.value.match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
    if (!m) { app.aviso('Escribe latitud y longitud, por ejemplo: 40.47797, -3.65100'); return; }
    // las coordenadas se asignan al centro de lo que se ve ahora
    const p = app.planta();
    const w = app.svg.clientWidth / 2, h = app.svg.clientHeight / 2;
    const centro = M.aSitio(p, { x: (w - est.vista.x) / est.vista.z, y: (h - est.vista.y) / est.vista.z });
    app.doc.sitio.ancla = { x: centro.x, y: centro.y, lat: +m[1].replace(',', '.'), lon: +m[2].replace(',', '.') };
    app.pintar();
  }
});

/** Arrastre durante el ajuste: dx, dy en metros de la planta. */
app.ajustarArrastre = (dx, dy) => {
  const p = app.planta();
  const g = ((p.colocacion?.giro || 0) * Math.PI) / 180;
  const d = { x: dx * Math.cos(g) - dy * Math.sin(g), y: dx * Math.sin(g) + dy * Math.cos(g) };
  if (est.ajuste.modo === 'foto') {
    app.doc.sitio.ancla.x += d.x;
    app.doc.sitio.ancla.y += d.y;
  } else {
    for (const q of app.edificio().plantas) { q.colocacion.x += d.x; q.colocacion.y += d.y; }
    // el edificio sigue al dedo: se mueve la vista con él y la foto queda quieta en pantalla
    est.vista.x += dx * est.vista.z;
    est.vista.y += dy * est.vista.z;
  }
  app.pintar();
};

app.terminarAjuste = (guardar) => {
  if (!est.ajuste) return;
  if (!guardar) {
    const c = JSON.parse(est.ajuste.copia);
    app.doc.sitio = c.sitio;
    [...M.plantas(app.doc)].forEach(({ p }, i) => { p.colocacion = c.coloc[i]; });
  } else marcarSucio();
  est.ajuste = null;
  document.body.classList.remove('ajustando');
  pintarAjuste();
  app.pintar();
};

// ---------------------------------------------------------------------------- 3D
let vista3d = null;
async function abrir3D() {
  $('#vista3d').hidden = false;
  $('#cargando-3d').hidden = false;
  try {
    const { Vista3D } = await import('./tresd.js');
    vista3d ||= new Vista3D(app, $('#vista3d'));
    pintarBarra3D();
    await vista3d.abrir();
  } catch (e) {
    app.aviso('No se pudo abrir el 3D: ' + e.message, 'error');
    console.error(e);
  }
  $('#cargando-3d').hidden = true;
}
function cerrar3D() {
  $('#vista3d').hidden = true;
  vista3d?.cerrar();
}

const etiquetaNivel = (n) => (n === 0 ? 'Baja' : n < 0 ? 'Sótano' : n + '.ª');
function pintarBarra3D() {
  const niveles = new Set();
  for (const ed of app.doc.edificios) if (!ed.exterior) for (const p of ed.plantas) niveles.add(p.nivel);
  const ns = [...niveles].sort((a, b) => a - b);
  const op = vista3d.op;
  $('#barra-3d').innerHTML = `
    <span class="etq">Plantas</span>
    <div class="segmentos">${ns.map((n) => `<button data-hasta="${n}" class="${op.hasta === n ? 'activo' : ''}">${n === ns[ns.length - 1] ? 'Todas' : 'Hasta ' + etiquetaNivel(n).toLowerCase()}</button>`).join('')}</div>
    <label class="interruptor"><input type="checkbox" data-op3d="separar" ${op.separar ? 'checked' : ''}> Separar</label>
    <label class="interruptor"><input type="checkbox" data-op3d="foto" ${op.foto ? 'checked' : ''}> Foto aérea</label>
    <label class="interruptor"><input type="checkbox" data-op3d="nombres" ${op.nombres ? 'checked' : ''}> Nombres</label>
    ${Object.keys(app.doc.red.equipos).length || Object.keys(app.doc.red.cables).length ? `<label class="interruptor"><input type="checkbox" data-op3d="red" ${op.red ? 'checked' : ''}> Red</label>` : ''}
    <button class="btn-ic" data-v3d="cenital" title="Vista desde arriba"><svg class="ic"><use href="#i-abajo"/></svg></button>
    <button class="btn-ic" data-v3d="encuadrar" title="Vista en perspectiva"><svg class="ic"><use href="#i-cubo"/></svg></button>
    <button class="btn-ic" data-v3d="captura" title="Guardar imagen"><svg class="ic"><use href="#i-camara"/></svg></button>`;
  if (!Number.isFinite(op.hasta) || !ns.includes(op.hasta)) op.hasta = ns[ns.length - 1];
  $('#barra-3d').querySelectorAll('[data-hasta]').forEach((b) => b.classList.toggle('activo', +b.dataset.hasta === op.hasta));
}
$('#barra-3d').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || !vista3d) return;
  if (b.dataset.hasta !== undefined) { vista3d.op.hasta = +b.dataset.hasta; pintarBarra3D(); await vista3d.construir(); }
  else if (b.dataset.v3d === 'cenital') vista3d.encuadrar(true);
  else if (b.dataset.v3d === 'encuadrar') vista3d.encuadrar(false);
  else if (b.dataset.v3d === 'captura') exportar3D();
});
$('#barra-3d').addEventListener('change', async (e) => {
  const k = e.target.dataset.op3d;
  if (!k || !vista3d) return;
  vista3d.op[k] = e.target.checked;
  await vista3d.construir(k === 'separar');
});
async function exportar3D() {
  if (!vista3d) { app.aviso('Abre primero el modo 3D.'); return; }
  const url = vista3d.captura();
  const blob = await (await fetch(url)).blob();
  A.descargar(blob, `${app.doc.centro?.nombre || 'Plano'} - 3D.png`.replace(/[\\/:*?"<>|]/g, ''));
}

// ---------------------------------------------------------------------------- avisos y estado
app.aviso = (texto, tipo = '', accion = null) => {
  const d = document.createElement('div');
  d.className = 'aviso ' + tipo;
  d.textContent = texto;
  if (accion) {
    const b = document.createElement('button');
    b.className = 'aviso-accion';
    b.textContent = accion.etiqueta;
    b.addEventListener('click', () => { d.remove(); accion.accion(); });
    d.appendChild(b);
  }
  $('#avisos').appendChild(d);
  setTimeout(() => d.remove(), accion ? 15000 : tipo === 'error' ? 7000 : 3500);
};
app.estado = (t) => { $('#est-msg').textContent = t; };
app.mostrarCursor = (w) => { $('#est-cursor').textContent = `x ${num(w.x)}  ·  y ${num(w.y)} m`; };

// ---------------------------------------------------------------------------- edificios y plantas
app.pintarCabecera = () => { $('#nombre-centro').textContent = app.doc?.centro?.nombre || '—'; };

const etiquetaPiso = (p) => (p.nivel === 0 ? 'B' : p.nivel < 0 ? 'S' + (p.nivel === -1 ? '' : -p.nivel) : String(p.nivel));
app.pintarPlantas = () => {
  const sel = $('#sel-edificio');
  const nav = $('#pisos');
  if (!app.doc) { sel.innerHTML = ''; nav.innerHTML = ''; return; }
  sel.innerHTML = app.doc.edificios.map((e) => `<option value="${e.id}"${e.id === est.edId ? ' selected' : ''}>${esc(e.nombre)}</option>`).join('');
  const ed = app.edificio();
  const pls = [...(ed?.plantas || [])].sort((a, b) => b.nivel - a.nivel);
  const editar = est.modo === 'editar';
  if (pls.length < 2 && !editar) { nav.innerHTML = ''; return; }
  nav.innerHTML = '<div class="pisos-tit">Planta</div>' +
    pls.map((p) => `<button data-pl="${p.id}" class="${p.id === est.plId ? 'activo' : ''}" title="${esc(p.nombre)}">${etiquetaPiso(p)}</button>`).join('') +
    (editar ? '<button class="anadir" data-piso-nuevo title="Añadir una planta">+</button>' : '');
};

$('#sel-edificio').addEventListener('change', (e) => {
  const ed = app.doc.edificios.find((x) => x.id === e.target.value);
  const p0 = [...ed.plantas].sort((a, b) => Math.abs(a.nivel) - Math.abs(b.nivel))[0];
  irAPlanta(ed.id, p0?.id, true);
});
$('#pisos').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.pl) irAPlanta(est.edId, b.dataset.pl, false);
  else if ('pisoNuevo' in b.dataset) app.nuevaPlanta();
});

function irAPlanta(edId, plId, encuadrar, mantenerSel = false) {
  const cambiaEdificio = edId !== est.edId;
  const anterior = est.plId;
  if (est.ajuste && cambiaEdificio) app.terminarAjuste(true);
  est.edId = edId;
  est.plId = plId;
  // un equipo o un cable de la red siguen seleccionados al cambiar de planta (para seguirlos)
  if (!mantenerSel && est.sel?.tipo !== 'equipo' && est.sel?.tipo !== 'cable') est.sel = null;
  // si se está tendiendo un cable, sigue en la planta nueva: sube o baja por el último punto
  const cable = est.temp.cable;
  est.temp = cable ? { cable } : {};
  if (cable) app.redHerr.cambioDePlanta(anterior, plId);
  est.redVert = null;
  est.anotSel = null;
  est.hover = null;
  app.recalcular();
  app.pintarPlantas();
  app.pintar({ calco: true });
  app.panel();
  // las plantas de un mismo edificio están superpuestas: se mantiene la vista
  if (encuadrar || cambiaEdificio) app.encuadrar();
  if (est.ajuste) pintarAjuste();
  guardarEnNavegador();
}
app.irAPlanta = irAPlanta;

app.nuevaPlanta = () => {
  const ed = app.edificio();
  const nombre = prompt('Nombre de la planta nueva:', 'Planta ' + ed.plantas.length);
  if (!nombre) return;
  const nivel = Math.max(-1, ...ed.plantas.map((p) => p.nivel)) + 1;
  const p = M.plantaVacia(nombre, nivel, ed.plantas[0]?.colocacion);
  ed.plantas.push(p);
  marcarSucio();
  irAPlanta(ed.id, p.id, false);
};

app.nuevoEdificio = () => {
  const nombre = prompt('Nombre del edificio nuevo:', 'Edificio');
  if (!nombre) return;
  const ed = { id: M.nuevoId('b'), nombre, plantas: [M.plantaVacia('Planta baja', 0)] };
  app.doc.edificios.push(ed);
  marcarSucio();
  irAPlanta(ed.id, ed.plantas[0].id, true);
};

app.borrarPlanta = () => {
  const ed = app.edificio(), p = app.planta();
  if (!confirm(`¿Borrar «${p.nombre}» de «${ed.nombre}»? Se puede recuperar desde una versión guardada, pero no con Deshacer.`)) return;
  // con ella se van sus equipos de red y los tramos de cable que pasan por ella
  R.quitarPlanta(app.doc.red, R.indicePlantas(app.doc), p.id);
  hist.pila = hist.pila.filter((h) => h.red === undefined);
  hist.rehacer = hist.rehacer.filter((h) => h.red === undefined);
  ed.plantas = ed.plantas.filter((x) => x !== p);
  if (!ed.plantas.length) app.doc.edificios = app.doc.edificios.filter((x) => x !== ed);
  hist.pila = hist.pila.filter((h) => h.plId !== p.id);
  marcarSucio();
  const sig = app.doc.edificios[0];
  if (sig) irAPlanta(sig.id, sig.plantas[0].id, true);
  else cargarDocumento(M.documentoVacio(), {});
};

// ---------------------------------------------------------------------------- versiones
app.guardarVersion = (nombre) => {
  const plantas = {};
  for (const { p } of M.plantas(app.doc)) plantas[p.id] = M.contenido(p);
  app.doc.versiones.push({ id: M.nuevoId('v'), nombre, fecha: new Date().toISOString(), plantas, red: JSON.stringify(app.doc.red) });
  marcarSucio();
  app.aviso(`Versión «${nombre}» guardada.`, 'ok');
};

app.restaurarVersion = (id) => {
  const v = app.doc.versiones.find((x) => x.id === id);
  if (!v || !confirm(`¿Volver a la versión «${v.nombre}»? Antes se guardará automáticamente el estado actual como versión.`)) return;
  app.guardarVersion('Antes de restaurar «' + v.nombre + '»');
  for (const { p } of M.plantas(app.doc)) if (v.plantas[p.id]) M.restaurar(p, v.plantas[p.id]);
  // las versiones de antes de la red no la traen: entonces se deja la de ahora
  if (v.red) app.doc.red = R.redDeVersion(app.doc, v.red);
  est.temp = {};
  hist.pila = []; hist.rehacer = [];
  pintarBotonesHistorial();
  app.cambio();
  app.aviso(`Restaurada la versión «${v.nombre}».`, 'ok');
};

app.borrarVersion = (id) => {
  const v = app.doc.versiones.find((x) => x.id === id);
  if (!v || !confirm(`¿Borrar la versión «${v.nombre}»?`)) return;
  app.doc.versiones = app.doc.versiones.filter((x) => x.id !== id);
  marcarSucio();
};

// ---------------------------------------------------------------------------- búsqueda
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let resultados = [];
$('#buscar').addEventListener('input', (e) => {
  const q = normal(e.target.value.trim());
  const cajaR = $('#resultados');
  if (!q || !app.doc) { cajaR.hidden = true; return; }
  resultados = [];
  for (const { ed, p } of M.plantas(app.doc)) {
    for (const [id, es] of Object.entries(p.espacios)) {
      if (normal(es.nombre).includes(q) || normal(es.grupo).includes(q)) resultados.push({ ed, p, id, es });
    }
  }
  // equipos (por nombre, modelo o IP) y cables (por etiqueta)
  const red = app.doc.red;
  const ctx = R.contexto(app.doc);
  for (const [id, e] of Object.entries(red.equipos)) {
    if ([e.nombre, e.modelo, e.ip].some((t) => normal(t).includes(q))) {
      resultados.push({ red: 'equipo', id, titulo: e.nombre, sub: `${R.nombreTipo(e)} · ${R.textoUbicacion(ctx, id)}` });
    }
  }
  for (const [id, c] of Object.entries(red.cables)) {
    if (normal(c.etiqueta).includes(q)) resultados.push({ red: 'cable', id, titulo: c.etiqueta, sub: `Cable · ${R.textoExtremo(red, c.a)} → ${R.textoExtremo(red, c.b)}` });
  }
  cajaR.innerHTML = resultados.slice(0, 30).map((r, i) => `<button data-i="${i}" class="${i === 0 ? 'activa' : ''}">` +
    (r.red ? `${esc(r.titulo)}<small>${esc(r.sub)}</small>` : `${esc(r.es.nombre)}${r.es.grupo ? ' · ' + esc(r.es.grupo) : ''}<small>${esc(r.ed.nombre)} · ${esc(r.p.nombre)}</small>`) +
    '</button>').join('') || '<div class="vacio">No hay ninguna sala ni ningún equipo con ese nombre.</div>';
  cajaR.hidden = false;
});
$('#buscar').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && resultados[0]) irAResultado(resultados[0]);
  if (e.key === 'Escape') { e.target.value = ''; $('#resultados').hidden = true; e.target.blur(); }
});
$('#resultados').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b) irAResultado(resultados[+b.dataset.i]);
});
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.buscador')) $('#resultados').hidden = true;
  if (!e.target.closest('.menu-cont')) $('#menu-archivo').hidden = true;
  if (!e.target.closest('.flot-capas')) { $('#pop-capas').hidden = true; $('#b-capas').classList.remove('activo'); }
});
function irAResultado(r) {
  $('#resultados').hidden = true;
  $('#buscar').blur();
  if (r.red === 'equipo') { irAEquipo(app, r.id); return; }
  if (r.red === 'cable') { irACable(app, r.id); return; }
  document.querySelector('.pestanas [data-pest="props"]').click();
  if (est.modo === '3d') app.modo('ver');
  if (r.p.id !== est.plId) irAPlanta(r.ed.id, r.p.id, r.ed.id !== est.edId);
  const v = est.vista;
  v.z = Math.max(v.z, 30);
  v.x = app.svg.clientWidth / 2 - r.es.x * v.z;
  v.y = app.svg.clientHeight / 2 - r.es.y * v.z;
  app.seleccionar({ tipo: 'espacio', id: r.id });
  app.pintarVista();
}
app.enfocarBusqueda = () => { $('#buscar').focus(); $('#buscar').select(); };

// ---------------------------------------------------------------------------- archivo
function cargarDocumento(doc, { nombre, manejador = null, sucio = false, plId, edId, vista } = {}) {
  app.doc = R.normalizarRed(M.normalizar(doc));
  app.archivo = { nombre: nombre || 'plano.plano.json', manejador, sucio, guardadoLocal: null };
  hist.pila = []; hist.rehacer = [];
  const primera = app.doc.edificios[0];
  const r = plId && buscarPlanta(plId);
  est.edId = r ? r.ed.id : primera?.id;
  est.plId = r ? r.p.id : primera?.plantas[0]?.id;
  est.sel = null;
  est.temp = {};
  est.anotSel = null;
  est.redFoco = est.redVer = est.redVert = est.redPuerto = null;
  R.olvidarSalas();
  est.capasAnotVisibles = new Set(app.doc.capasAnotacion.filter((c) => c.visible).map((c) => c.id));
  if (!app.doc.capasAnotacion.some((c) => c.id === est.anot.capa)) est.anot.capa = app.doc.capasAnotacion[0].id;
  satelite.vaciar();
  $('#bienvenida').hidden = true;
  app.pintarCabecera();
  app.pintarPlantas();
  app.recalcular();
  app.pintar({ calco: true });
  app.panel();
  pintarVersiones(app);
  pintarPaleta();
  pintarBotonesHistorial();
  pintarEstadoGuardado();
  // se recupera la vista de la última vez, salvo que deje la planta fuera de la pantalla
  const c = r ? caja(r.p) : null;
  const centro = c && vista ? aPantalla(vista, { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }) : null;
  const vale = centro && vista.z > 2 && centro.x > 0 && centro.y > 0 && centro.x < app.svg.clientWidth && centro.y < app.svg.clientHeight;
  if (vale) { Object.assign(est.vista, vista); app.pintarVista(); } else app.encuadrar();
}

app.abrir = async () => {
  try {
    const f = await A.pedirArchivo();
    if (!f) return;
    abrirTexto(f);
  } catch (e) {
    app.aviso('No se pudo abrir: ' + e.message, 'error');
  }
};

function abrirTexto(f) {
  if (app.doc && app.archivo.sucio && !confirm('Hay cambios sin guardar en archivo. ¿Abrir otro plano igualmente? (La copia del navegador se sustituirá.)')) return;
  let doc;
  try { doc = JSON.parse(f.texto); } catch { app.aviso('El archivo no es un JSON válido.', 'error'); return; }
  try {
    cargarDocumento(doc, { nombre: f.nombre, manejador: f.manejador });
  } catch (e) { app.aviso(e.message, 'error'); return; }
  guardarEnNavegador();
  if (f.manejador) A.guardarLocal('manejador', f.manejador).catch(() => {});
  app.aviso(`Abierto «${f.nombre}».`, 'ok');
}

app.guardar = async (comoNuevo = false) => {
  if (!app.doc) return;
  try {
    const texto = JSON.stringify(app.doc);
    const r = await A.escribirArchivo(texto, app.archivo.nombre, app.archivo.manejador, comoNuevo);
    if (!r) return;
    app.archivo.nombre = r.nombre;
    app.archivo.manejador = r.manejador;
    app.archivo.sucio = false;
    if (r.manejador) A.guardarLocal('manejador', r.manejador).catch(() => {});
    guardarEnNavegador();
    app.aviso(r.modo === 'archivo' ? `Guardado en «${r.nombre}».` : r.modo === 'compartido' ? 'Archivo listo: elige dónde guardarlo.' : `Descargado «${r.nombre}».`, 'ok');
  } catch (e) {
    app.aviso('No se pudo guardar: ' + e.message, 'error');
  }
};

app.nuevo = () => {
  if (app.doc && app.archivo.sucio && !confirm('Hay cambios sin guardar en archivo. ¿Empezar un plano vacío?')) return;
  cargarDocumento(M.documentoVacio(), { nombre: 'plano-nuevo.plano.json', sucio: true });
  guardarEnNavegador();
};

// ---------------------------------------------------------------------------- exportar e imprimir
function svgDePlanta(p, { conCalco = est.capas.calco, cajetin = false } = {}) {
  const c = caja(p);
  const mg = 1.2;
  const banda = cajetin ? 2.4 : 0;
  const x0 = c.x0 - mg, y0 = c.y0 - mg - 0.8, w = c.x1 - c.x0 + 2 * mg, h = c.y1 - c.y0 + 2 * mg + 0.8 + banda;
  const modelo = htmlModelo(p, app.info, { ...est.capas, muros: true });
  const calco = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  if (conCalco) pintarCalco(calco, p, est.capas);
  const visibles = new Set(app.doc.capasAnotacion.filter((x) => x.visible).map((x) => x.id));
  const anot = (p.anotaciones || []).filter((a) => visibles.has(a.capa)).map((a) => htmlAnotacion(a)).join('');
  let rot = '';
  for (const [id, e] of Object.entries(p.espacios)) {
    const s = app.info.salas[id];
    rot += `<text class="ex-nombre" x="${e.x}" y="${e.y}">${esc(e.nombre)}</text>`;
    if (e.grupo) rot += `<text class="ex-sup" x="${e.x}" y="${e.y + 0.34}" style="fill:#2a5bd7">${esc(e.grupo)}</text>`;
    if (s) rot += `<text class="ex-sup" x="${e.x}" y="${e.y + (e.grupo ? 0.68 : 0.36)}">${fmtM2(s.util)}</text>`;
  }
  for (const n of Object.values(p.elementos)) if (n.tipo === 'nota' && (!n.capa || visibles.has(n.capa))) rot += `<text class="ex-nota" x="${n.x}" y="${n.y}">● ${esc(n.texto)}</text>`;
  // la red sale si se está en el modo Red o si su capa está encendida
  const red = est.modo === 'red' || est.capas.red ? htmlRedExport(app, p) : '';
  const titulo = `${app.doc.centro?.nombre || ''} · ${app.edificio().nombre} · ${p.nombre}`;
  // cajetín dibujado dentro del SVG (para la imagen que se imprime desde el iPad)
  let pie = '';
  if (cajetin) {
    const yb = y0 + h - banda + 0.2, hb = banda - 0.5;
    const celda = (x, etq, valor) => `<text x="${x + 0.35}" y="${yb + 0.65}" style="font:600 0.3px system-ui,Arial,sans-serif;fill:#666;letter-spacing:.03px">${etq}</text>` +
      `<text x="${x + 0.35}" y="${yb + 1.35}" style="font:600 0.48px system-ui,Arial,sans-serif;fill:#1d2330">${esc(valor)}</text>`;
    const cols = [x0 + 0.3, x0 + 0.3 + (w - 0.6) * 0.4, x0 + 0.3 + (w - 0.6) * 0.8];
    pie = `<rect x="${x0 + 0.3}" y="${yb}" width="${w - 0.6}" height="${hb}" fill="#fff" stroke="#333" stroke-width="0.04"/>` +
      cols.slice(1).map((x) => `<path d="M${x} ${yb}v${hb}" stroke="#333" stroke-width="0.04"/>`).join('') +
      celda(cols[0], 'CENTRO', app.doc.centro?.nombre || '') + celda(cols[1], 'PLANO', `${app.edificio().nombre} · ${p.nombre}`) +
      celda(cols[2], 'FECHA', new Date().toLocaleDateString('es-ES'));
  }
  return {
    w, h,
    texto: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${(w * 10).toFixed(1)}mm" height="${(h * 10).toFixed(1)}mm">
<style>${CSS_EXPORT}</style>
<defs><pattern id="rayado" patternUnits="userSpaceOnUse" width="0.18" height="0.18" patternTransform="rotate(45)"><rect width="0.18" height="0.18" fill="#fde3c4"/><rect width="0.07" height="0.18" fill="#e07b16"/></pattern></defs>
<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fff"/>
${calco.innerHTML}${modelo}${red}<g>${anot}</g><g>${rot}</g>
<text x="${x0 + 0.6}" y="${y0 + 0.9}" style="font:600 0.5px system-ui,Arial,sans-serif;fill:#1d2330">${esc(titulo)}</text>
${pie}
</svg>`,
  };
}

function nombreExport(ext) {
  const p = app.planta();
  const base = `${app.edificio().nombre} - ${p.nombre}`.replace(/[\\/:*?"<>|]/g, '');
  return `${base}.${ext}`;
}

app.exportarSVG = () => {
  const { texto } = svgDePlanta(app.planta());
  A.descargar(new Blob([texto], { type: 'image/svg+xml' }), nombreExport('svg'));
};

app.exportarPNG = async () => {
  const { texto, w, h } = svgDePlanta(app.planta());
  const k = Math.min(60, 6000 / Math.max(w, h));
  try {
    const blob = await A.svgAPng(texto, Math.round(w * k), Math.round(h * k));
    A.descargar(blob, nombreExport('png'));
  } catch (e) { app.aviso(e.message, 'error'); }
};

/** En el iPad, la app instalada en la pantalla de inicio no abre el diálogo de imprimir:
 *  se prepara una imagen con el cajetín y se abre «Compartir», que tiene «Imprimir» y
 *  «Guardar en Archivos». */
async function imprimirEnIPad(p) {
  try {
    const { texto, w, h } = svgDePlanta(p, { cajetin: true });
    const k = Math.min(60, 5000 / Math.max(w, h));
    const blob = await A.svgAPng(texto, Math.round(w * k), Math.round(h * k));
    const file = new File([blob], nombreExport('png'), { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] })) { A.descargar(blob, file.name); return; }
    const compartir = () => navigator.share({ files: [file], title: file.name })
      .catch((e) => { if (e.name !== 'AbortError') app.aviso('No se pudo compartir: ' + e.message, 'error'); });
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (e) {
      if (e.name === 'AbortError') return;
      // si preparar la imagen ha tardado, el iPad pide un toque nuevo para compartir
      app.aviso('La imagen para imprimir está lista.', 'ok', { etiqueta: 'Imprimir…', accion: compartir });
    }
  } catch (e) {
    app.aviso('No se pudo preparar la impresión: ' + e.message, 'error');
  }
}

app.imprimir = () => {
  const p = app.planta();
  if (window.navigator.standalone === true) { imprimirEnIPad(p); return; }
  const { texto, w, h } = svgDePlanta(p);
  const necesaria = Math.max((w * 1000) / 400, (h * 1000) / 245);
  const escala = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000].find((s) => s >= necesaria) || Math.ceil(necesaria);
  const svg = texto.replace(/width="[^"]+mm" height="[^"]+mm"/, `width="${(w * 1000 / escala).toFixed(1)}mm" height="${(h * 1000 / escala).toFixed(1)}mm"`);
  $('#impresion').innerHTML = `${svg}
    <div class="cajetin">
      <div><small>Centro</small>${esc(app.doc.centro?.nombre)}</div>
      <div><small>Plano</small>${esc(app.edificio().nombre)} · ${esc(p.nombre)}</div>
      <div><small>Escala (A3)</small>1:${escala}</div>
      <div><small>Fecha</small>${new Date().toLocaleDateString('es-ES')}</div>
    </div>`;
  setTimeout(() => window.print(), 50);
};

// ---------------------------------------------------------------------------- barra superior y botones
$('#b-archivo').addEventListener('click', () => { $('#menu-archivo').hidden = !$('#menu-archivo').hidden; });
document.body.addEventListener('click', (e) => {
  const b = e.target.closest('[data-acc]');
  if (!b || b.closest('#pest-props, #pest-versiones, #pop-capas')) return;
  $('#menu-archivo').hidden = true;
  const acc = b.dataset.acc;
  if (acc === 'abrir') app.abrir();
  else if (acc === 'guardar') app.guardar(false);
  else if (acc === 'guardar-como') app.guardar(true);
  else if (acc === 'svg') app.planta() && app.exportarSVG();
  else if (acc === 'png') app.planta() && app.exportarPNG();
  else if (acc === 'png3d') exportar3D();
  else if (acc === 'imprimir') app.planta() && app.imprimir();
  else if (acc === 'nuevo') app.nuevo();
});
$('#modos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-modo]');
  if (b) app.modo(b.dataset.modo);
});
$('#b-capas').addEventListener('click', () => {
  const pc = $('#pop-capas');
  pc.hidden = !pc.hidden;
  $('#b-capas').classList.toggle('activo', !pc.hidden);
  if (!pc.hidden) pintarCapas(app);
});
$('#b-deshacer').addEventListener('click', () => app.deshacer());
$('#b-rehacer').addEventListener('click', () => app.rehacer());
$('#b-zoom-mas').addEventListener('click', () => app.zoomEn({ x: app.svg.clientWidth / 2, y: app.svg.clientHeight / 2 }, 1.3));
$('#b-zoom-menos').addEventListener('click', () => app.zoomEn({ x: app.svg.clientWidth / 2, y: app.svg.clientHeight / 2 }, 1 / 1.3));
$('#b-encuadrar').addEventListener('click', () => app.encuadrar());
$('#b-medir').addEventListener('click', () => app.herramienta(est.herr === 'medir' ? 'sel' : 'medir'));
$('#b-panel').addEventListener('click', () => { document.body.classList.toggle('sin-panel'); requestAnimationFrame(() => { app.pintarSobre(); vista3d?.redimensionar(); }); });
$('#b-cerrar-panel').addEventListener('click', () => { document.body.classList.add('sin-panel'); app.pintarSobre(); });
$('#herramientas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-herr]');
  if (b) app.herramienta(b.dataset.herr);
});

// arrastrar y soltar un archivo (PC)
let contadorArrastre = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { contadorArrastre++; document.body.classList.add('arrastrando'); } });
window.addEventListener('dragleave', () => { if (--contadorArrastre <= 0) { contadorArrastre = 0; document.body.classList.remove('arrastrando'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  contadorArrastre = 0;
  document.body.classList.remove('arrastrando');
  const f = e.dataTransfer?.files?.[0];
  if (f) abrirTexto(await A.leerArchivoSoltado(f));
});

window.addEventListener('resize', () => app.pintarSobre());

// iPad: pellizcar no debe ampliar la página entera (el zoom es del plano)
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
// en pantallas estrechas el panel es una hoja inferior: empieza cerrada
if (innerWidth <= 820) document.body.classList.add('sin-panel');

// ---------------------------------------------------------------------------- preferencias
app.guardarPreferencias = () => {
  const { capas, orto, paso, grosor, tipoMuro, estadoNuevo, anot, redOp } = est;
  const { herr, color, grosor: grosorAnot, soloLapiz, lapizVisto } = anot;
  A.guardarLocal('prefs', { capas, orto, paso, grosor, tipoMuro, estadoNuevo, anot: { herr, color, grosor: grosorAnot, soloLapiz, lapizVisto }, redOp }).catch(() => {});
};

// ---------------------------------------------------------------------------- arranque
instalarInteraccion(app);
instalarPanel(app);
document.querySelectorAll('[data-modo]').forEach((b) => b.classList.toggle('activo', b.dataset.modo === 'ver'));
pintarOpciones();

(async () => {
  const prefs = await A.leerLocal('prefs');
  if (prefs) {
    Object.assign(est.capas, prefs.capas || {});
    for (const k of ['orto', 'paso', 'grosor', 'tipoMuro', 'estadoNuevo']) if (k in prefs) est[k] = prefs[k];
    if (prefs.anot) Object.assign(est.anot, prefs.anot);
    if (prefs.redOp) {
      const o = prefs.redOp, d = est.redOp;
      d.tipo = M.deLista(o.tipo, R.TIPOS_CABLE, d.tipo);
      d.estado = M.deLista(o.estado, R.ESTADOS_CABLE, d.estado);
      d.canal = M.deLista(o.canal, R.CANALES, d.canal);
      d.fin = M.deLista(o.fin, FINALES, d.fin);
      d.orto = o.orto !== false;
    }
  }
  // Windows: la app instalada puede abrir un .plano.json con doble clic («Abrir con…»)
  let lanzado = false;
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const h = params.files?.[0];
      if (!h) return;
      lanzado = true;
      try {
        const f = await h.getFile();
        abrirTexto({ texto: await f.text(), nombre: f.name, manejador: h });
      } catch (e) {
        app.aviso('No se pudo abrir: ' + e.message, 'error');
      }
    });
  }
  const texto = await A.leerLocal('doc');
  if (lanzado) return; // manda el archivo con el que se ha abierto la app
  if (texto) {
    try {
      const meta = (await A.leerLocal('meta')) || {};
      const manejador = await A.leerLocal('manejador');
      cargarDocumento(JSON.parse(texto), { ...meta, manejador: manejador || null });
      return;
    } catch (e) {
      app.aviso('La copia del navegador no se pudo leer: ' + e.message, 'error');
    }
  }
  $('#bienvenida').hidden = false;
  app.panel();
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// para depurar desde la consola
app.abrirTexto = abrirTexto;
window.planoApp = app;
