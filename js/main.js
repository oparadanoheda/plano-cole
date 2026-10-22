// Arranque y coordinación de la app «Plano del cole».

import * as M from './modelo.js';
import { salas } from './espacios.js';
import { pintarCalco, pintarModelo, pintarSeleccion, pintarSobre, pintarRejilla, aplicarVista, caja } from './vista.js';
import { instalarInteraccion } from './herramientas.js';
import { pintarPanel, instalarPanel, pintarCapas, pintarVersiones } from './panel.js';
import { CSS_PLANO, CSS_EXPORT } from './estilo.js';
import * as A from './archivo.js';
import { num, fmtM2 } from './geo.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

document.head.insertAdjacentHTML('beforeend', `<style>${CSS_PLANO}</style>`);

const est = {
  vista: { x: 0, y: 0, z: 20 },
  herr: 'sel', sel: null, temp: {},
  capas: { calco: true, calcoOpac: 0.4, pci: false, evacuacion: false, sectores: false, espacios: true, muros: true, rotulos: true, cotas: true, rejilla: true, sueltos: true },
  bloqueado: false, orto: true, paso: 0.05,
  grosor: 0.1, tipoMuro: 'tabique', estadoNuevo: 'medido', ancla: 'a',
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
const gCalco = $('#g-calco'), gModelo = $('#g-modelo'), gSel = $('#g-sel'), gSobre = $('#g-sobre'), gMundo = $('#mundo'), gRejilla = $('#g-rejilla');

app.recalcular = () => { const p = app.planta(); app.info = p ? salas(p) : { caras: [], salas: {} }; };

app.pintar = ({ calco = false } = {}) => {
  const p = app.planta();
  const clave = p ? p.id + JSON.stringify([est.capas.calco, est.capas.calcoOpac, est.capas.pci, est.capas.evacuacion, est.capas.sectores]) : '';
  if (calco || clave !== calcoDibujado) {
    if (p) pintarCalco(gCalco, p, est.capas); else gCalco.innerHTML = '';
    calcoDibujado = clave;
  }
  if (p) {
    pintarModelo(gModelo, p, app.info, est.capas);
    pintarSeleccion(gSel, p, est.sel, app.info);
  } else {
    gModelo.innerHTML = gSel.innerHTML = '';
  }
  app.pintarVista();
};

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
    if (!p) { gSobre.innerHTML = ''; return; }
    pintarSobre(gSobre, p, est, app.info, app.svg.clientWidth, app.svg.clientHeight);
  });
};

app.encuadrar = () => {
  const p = app.planta();
  if (!p) return;
  const c = caja(p);
  const w = app.svg.clientWidth;
  // en pantallas estrechas el panel es una hoja que tapa la parte de abajo
  const hoja = innerWidth <= 820 && !document.body.classList.contains('sin-panel') ? $('#panel').offsetHeight : 0;
  const h = app.svg.clientHeight - hoja;
  const m = 40;
  const z = Math.min((w - 2 * m) / Math.max(c.x1 - c.x0, 1), (h - 2 * m - 30) / Math.max(c.y1 - c.y0, 1));
  est.vista.z = Math.min(Math.max(z, 0.5), 400);
  est.vista.x = (w - (c.x1 - c.x0) * est.vista.z) / 2 - c.x0 * est.vista.z;
  est.vista.y = (h - 30 - (c.y1 - c.y0) * est.vista.z) / 2 - c.y0 * est.vista.z;
  app.pintarVista();
};

// ---------------------------------------------------------------------------- cambios e historial
let temporizador = null;
app.antes = () => {
  const p = app.planta();
  if (!p) return;
  hist.pila.push({ plId: p.id, json: M.contenido(p) });
  if (hist.pila.length > 150) hist.pila.shift();
  hist.rehacer = [];
  pintarBotonesHistorial();
};

/** Algo ha cambiado en el modelo. «ligero» durante los arrastres: sin panel ni guardado. */
app.cambio = (ligero = false) => {
  app.recalcular();
  const p = app.planta();
  if (est.sel && !existe(p, est.sel)) est.sel = null;
  app.pintar();
  if (ligero) return;
  app.panel();
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
  }
  return false;
}

function deshacerRehacer(de, a) {
  const e = de.pop();
  if (!e) return false;
  const r = buscarPlanta(e.plId);
  if (!r) return false;
  a?.push({ plId: e.plId, json: M.contenido(r.p) });
  M.restaurar(r.p, e.json);
  if (r.p.id !== est.plId) irAPlanta(r.ed.id, r.p.id, false);
  app.cambio();
  pintarBotonesHistorial();
  return true;
}
app.deshacer = (silencioso = false) => {
  if (est.bloqueado && !silencioso) return;
  deshacerRehacer(hist.pila, silencioso ? null : hist.rehacer);
};
app.rehacer = () => { if (!est.bloqueado) deshacerRehacer(hist.rehacer, hist.pila); };

function pintarBotonesHistorial() {
  $('#b-deshacer').disabled = est.bloqueado || !hist.pila.length;
  $('#b-rehacer').disabled = est.bloqueado || !hist.rehacer.length;
}

function marcarSucio() {
  app.archivo.sucio = true;
  pintarEstadoGuardado();
  clearTimeout(temporizador);
  temporizador = setTimeout(guardarEnNavegador, 700);
}

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
  el.textContent = !app.doc ? '' : s ? `Copia en el navegador · sin guardar en «${app.archivo.nombre}»` : `Guardado en «${app.archivo.nombre}»`;
}

// ---------------------------------------------------------------------------- selección y herramientas
app.seleccionar = (sel) => {
  est.sel = sel;
  const p = app.planta();
  if (p) pintarSeleccion(gSel, p, sel, app.info);
  app.pintarSobre();
  app.panel();
  if (innerWidth <= 820) document.body.classList.toggle('sin-panel', !sel);
};

app.panel = () => {
  pintarPanel(app);
  if (!$('#pest-capas').hidden) pintarCapas(app);
};

app.enfocarPanel = () => {
  document.body.classList.remove('sin-panel');
  document.querySelector('.pestanas [data-pest="props"]').click();
  const i = $('#pest-props').querySelector('input:not([disabled]), textarea:not([disabled])');
  if (i) { i.focus(); i.select?.(); }
};

app.borrarSeleccion = () => {
  const p = app.planta();
  const sel = est.sel;
  if (!p || !sel || est.bloqueado) return;
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

const PISTAS = {
  muro: 'Toca para empezar y ve tocando esquinas. Escribe una medida (6,40) e Intro para fijar el largo. Doble toque o Esc para terminar.',
  puerta: 'Toca un muro para poner una puerta. Abrirá hacia el lado donde toques.',
  ventana: 'Toca un muro para poner una ventana.',
  paso: 'Toca un muro para abrir un paso sin puerta.',
  espacio: 'Toca dentro de una sala cerrada para ponerle nombre y ver su superficie.',
  pilar: 'Toca donde va el pilar (40 × 40 cm; luego puedes cambiarlo).',
  nota: 'Toca donde quieras dejar una nota (p. ej. «pendiente de medir»).',
  medir: 'Toca dos puntos. Se ajusta a esquinas y muros.',
};

app.herramienta = (h) => {
  if (est.bloqueado && h !== 'sel' && h !== 'medir') return;
  est.herr = h;
  est.temp = {};
  app.svg.dataset.herr = h;
  document.querySelectorAll('[data-herr]').forEach((b) => b.classList.toggle('activa', b.dataset.herr === h));
  pintarOpciones();
  app.pintarSobre();
};

function pintarOpciones() {
  const o = $('#opciones');
  const h = est.herr;
  $('#est-pista').textContent = PISTAS[h] || '';
  if (h !== 'muro' && h !== 'medir') { o.hidden = true; return; }
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
  o.innerHTML = html;
  o.hidden = false;
}

$('#opciones').addEventListener('change', (e) => {
  const k = e.target.dataset.op;
  if (!k) return;
  if (k === 'grosor') est.grosor = +e.target.value;
  else if (k === 'orto') est.orto = e.target.checked;
  else if (k === 'paso') est.paso = e.target.checked ? 0.05 : 0;
  else est[k] = e.target.value;
  app.guardarPreferencias();
});

// ---------------------------------------------------------------------------- avisos y estado
app.aviso = (texto, tipo = '') => {
  const d = document.createElement('div');
  d.className = 'aviso ' + tipo;
  d.textContent = texto;
  $('#avisos').appendChild(d);
  setTimeout(() => d.remove(), tipo === 'error' ? 7000 : 3500);
};
app.estado = (t) => { $('#est-msg').textContent = t; };
app.mostrarCursor = (w) => { $('#est-cursor').textContent = `x ${num(w.x)}  ·  y ${num(w.y)} m`; };

// ---------------------------------------------------------------------------- edificios y plantas
app.pintarCabecera = () => { $('#nombre-centro').textContent = app.doc?.centro?.nombre || '—'; };

app.pintarPlantas = () => {
  const nav = $('#plantas');
  if (!app.doc) { nav.innerHTML = ''; return; }
  const ed = app.edificio();
  const eds = app.doc.edificios.map((e) => `<option value="${e.id}"${e.id === est.edId ? ' selected' : ''}>${esc(e.nombre)}</option>`).join('');
  const pls = (ed?.plantas || []).map((p) => `<button data-pl="${p.id}" class="${p.id === est.plId ? 'activa' : ''}">${esc(abreviar(p.nombre))}</button>`).join('');
  nav.innerHTML = `<select id="sel-edificio" aria-label="Edificio">${eds}</select><div class="segmentos">${pls}</div>`;
};
const abreviar = (n) => n.replace(/^Planta\s+/i, '').replace(/^\w/, (c) => c.toUpperCase());

$('#plantas').addEventListener('change', (e) => {
  if (e.target.id !== 'sel-edificio') return;
  const ed = app.doc.edificios.find((x) => x.id === e.target.value);
  irAPlanta(ed.id, ed.plantas[0]?.id, true);
});
$('#plantas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pl]');
  if (b) irAPlanta(est.edId, b.dataset.pl, false);
});

function irAPlanta(edId, plId, encuadrar) {
  const cambiaEdificio = edId !== est.edId;
  est.edId = edId;
  est.plId = plId;
  est.sel = null;
  est.temp = {};
  app.recalcular();
  app.pintarPlantas();
  app.pintar({ calco: true });
  app.panel();
  // las plantas de un mismo edificio están superpuestas: se mantiene la vista
  if (encuadrar || cambiaEdificio) app.encuadrar();
  guardarEnNavegador();
}
app.irAPlanta = irAPlanta;

app.nuevaPlanta = () => {
  const ed = app.edificio();
  const nombre = prompt('Nombre de la planta nueva:', 'Planta ' + (ed.plantas.length));
  if (!nombre) return;
  const nivel = Math.max(-1, ...ed.plantas.map((p) => p.nivel)) + 1;
  const p = M.plantaVacia(nombre, nivel);
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
  app.doc.versiones.push({ id: M.nuevoId('v'), nombre, fecha: new Date().toISOString(), plantas });
  marcarSucio();
  app.aviso(`Versión «${nombre}» guardada.`, 'ok');
};

app.restaurarVersion = (id) => {
  const v = app.doc.versiones.find((x) => x.id === id);
  if (!v || !confirm(`¿Volver a la versión «${v.nombre}»? Antes se guardará automáticamente el estado actual como versión.`)) return;
  app.guardarVersion('Antes de restaurar «' + v.nombre + '»');
  for (const { p } of M.plantas(app.doc)) if (v.plantas[p.id]) M.restaurar(p, v.plantas[p.id]);
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
  const caja = $('#resultados');
  if (!q || !app.doc) { caja.hidden = true; return; }
  resultados = [];
  for (const { ed, p } of M.plantas(app.doc)) {
    for (const [id, es] of Object.entries(p.espacios)) {
      if (normal(es.nombre).includes(q) || normal(es.grupo).includes(q)) resultados.push({ ed, p, id, es });
    }
  }
  caja.innerHTML = resultados.slice(0, 30).map((r, i) => `<button data-i="${i}" class="${i === 0 ? 'activa' : ''}">${esc(r.es.nombre)}${r.es.grupo ? ' · ' + esc(r.es.grupo) : ''}<small>${esc(r.ed.nombre)} · ${esc(r.p.nombre)}</small></button>`).join('')
    || '<div class="vacio">No hay ninguna sala con ese nombre.</div>';
  caja.hidden = false;
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
});
function irAResultado(r) {
  $('#resultados').hidden = true;
  $('#buscar').blur();
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
  app.doc = M.normalizar(doc);
  app.archivo = { nombre: nombre || 'plano.plano.json', manejador, sucio, guardadoLocal: null };
  hist.pila = []; hist.rehacer = [];
  const primera = app.doc.edificios[0];
  const r = plId && buscarPlanta(plId);
  est.edId = r ? r.ed.id : primera?.id;
  est.plId = r ? r.p.id : primera?.plantas[0]?.id;
  est.sel = null;
  est.temp = {};
  $('#bienvenida').hidden = true;
  app.pintarCabecera();
  app.pintarPlantas();
  app.recalcular();
  app.pintar({ calco: true });
  app.panel();
  pintarVersiones(app);
  pintarBotonesHistorial();
  pintarEstadoGuardado();
  if (vista && r) { Object.assign(est.vista, vista); app.pintarVista(); } else app.encuadrar();
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
function svgDePlanta(p, { conCalco = est.capas.calco } = {}) {
  const c = caja(p);
  const mg = 1.2;
  const x0 = c.x0 - mg, y0 = c.y0 - mg - 0.8, w = c.x1 - c.x0 + 2 * mg, h = c.y1 - c.y0 + 2 * mg + 0.8;
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  pintarModelo(tmp, p, app.info, { ...est.capas, muros: true });
  const calco = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  if (conCalco) pintarCalco(calco, p, est.capas);
  let rot = '';
  for (const [id, e] of Object.entries(p.espacios)) {
    const s = app.info.salas[id];
    rot += `<text class="ex-nombre" x="${e.x}" y="${e.y}">${esc(e.nombre)}</text>`;
    if (s) rot += `<text class="ex-sup" x="${e.x}" y="${e.y + 0.36}">${fmtM2(s.util)}</text>`;
  }
  for (const n of Object.values(p.elementos)) if (n.tipo === 'nota') rot += `<text class="ex-nota" x="${n.x}" y="${n.y}">● ${esc(n.texto)}</text>`;
  const titulo = `${app.doc.centro?.nombre || ''} · ${app.edificio().nombre} · ${p.nombre}`;
  // 1:100 → 1 m = 10 mm
  return {
    w, h,
    texto: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${(w * 10).toFixed(1)}mm" height="${(h * 10).toFixed(1)}mm">
<style>${CSS_EXPORT}</style>
<defs><pattern id="rayado" patternUnits="userSpaceOnUse" width="0.18" height="0.18" patternTransform="rotate(45)"><rect width="0.18" height="0.18" fill="#fde3c4"/><rect width="0.07" height="0.18" fill="#e07b16"/></pattern></defs>
<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fff"/>
${calco.innerHTML}${tmp.innerHTML}<g>${rot}</g>
<text x="${x0 + 0.6}" y="${y0 + 0.9}" style="font:600 0.5px system-ui,Arial,sans-serif;fill:#1d2330">${esc(titulo)}</text>
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

app.imprimir = () => {
  const p = app.planta();
  const { texto, w, h } = svgDePlanta(p);
  // escala normalizada que cabe en un A3 apaisado (400 × 250 mm útiles)
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
  if (!b || b.closest('#pest-props, #pest-versiones')) return;
  $('#menu-archivo').hidden = true;
  const acc = b.dataset.acc;
  if (acc === 'abrir') app.abrir();
  else if (acc === 'guardar') app.guardar(false);
  else if (acc === 'guardar-como') app.guardar(true);
  else if (acc === 'svg') app.planta() && app.exportarSVG();
  else if (acc === 'png') app.planta() && app.exportarPNG();
  else if (acc === 'imprimir') app.planta() && app.imprimir();
  else if (acc === 'nuevo') app.nuevo();
});
$('#b-deshacer').addEventListener('click', () => app.deshacer());
$('#b-rehacer').addEventListener('click', () => app.rehacer());
$('#b-zoom-mas').addEventListener('click', () => app.zoomEn({ x: app.svg.clientWidth / 2, y: app.svg.clientHeight / 2 }, 1.3));
$('#b-zoom-menos').addEventListener('click', () => app.zoomEn({ x: app.svg.clientWidth / 2, y: app.svg.clientHeight / 2 }, 1 / 1.3));
$('#b-encuadrar').addEventListener('click', () => app.encuadrar());
$('#b-panel').addEventListener('click', () => { document.body.classList.toggle('sin-panel'); app.pintarSobre(); });
$('#b-cerrar-panel').addEventListener('click', () => { document.body.classList.add('sin-panel'); app.pintarSobre(); });
$('#herramientas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-herr]');
  if (b) app.herramienta(b.dataset.herr);
});
$('#b-modo').addEventListener('click', () => {
  est.bloqueado = !est.bloqueado;
  document.body.classList.toggle('bloqueado', est.bloqueado);
  const b = $('#b-modo');
  b.classList.toggle('bloqueado', est.bloqueado);
  b.querySelector('use').setAttribute('href', est.bloqueado ? '#i-candado' : '#i-abierto');
  b.querySelector('span').textContent = est.bloqueado ? 'Consulta' : 'Editando';
  if (est.bloqueado && est.herr !== 'medir') app.herramienta('sel');
  pintarBotonesHistorial();
  app.panel();
  pintarVersiones(app);
  app.guardarPreferencias();
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

// ---------------------------------------------------------------------------- preferencias
app.guardarPreferencias = () => {
  const { capas, orto, paso, grosor, tipoMuro, estadoNuevo, bloqueado } = est;
  A.guardarLocal('prefs', { capas, orto, paso, grosor, tipoMuro, estadoNuevo, bloqueado }).catch(() => {});
};

// ---------------------------------------------------------------------------- arranque
instalarInteraccion(app);
instalarPanel(app);
app.herramienta('sel');

(async () => {
  const prefs = await A.leerLocal('prefs');
  if (prefs) {
    Object.assign(est.capas, prefs.capas || {});
    for (const k of ['orto', 'paso', 'grosor', 'tipoMuro', 'estadoNuevo']) if (k in prefs) est[k] = prefs[k];
    if (prefs.bloqueado) $('#b-modo').click();
  }
  const texto = await A.leerLocal('doc');
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
