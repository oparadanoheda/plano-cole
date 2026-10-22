// Panel lateral: propiedades de lo seleccionado, capas y versiones.

import * as M from './modelo.js';
import { fmtM, fmtM2, num, leerNum, dist, sub, unit, add, mul } from './geo.js';
import { COLOR_USO } from './vista.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const opciones = (obj, actual) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === actual ? ' selected' : ''}>${esc(v)}</option>`).join('');
const medida = (k, v, extra = '') => `<div class="con-ud"><input data-k="${k}" value="${num(v)}" inputmode="decimal" ${extra}><em>m</em></div>`;
const campo = (etq, html) => `<label class="campo"><span>${etq}</span>${html}</label>`;
const fecha = (iso) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function pintarPanel(app) {
  const c = document.getElementById('pest-props');
  const p = app.planta();
  const sel = app.est.sel;
  let html = '';
  if (!p) html = '<p class="ayuda">Abre un plano para empezar.</p>';
  else if (!sel) html = panelPlanta(app, p);
  else if (sel.tipo === 'muro' && p.muros[sel.id]) html = panelMuro(app, p, sel.id);
  else if (sel.tipo === 'nodo' && p.nodos[sel.id]) html = panelNodo(p, sel.id);
  else if (sel.tipo === 'abertura' && M.buscarAbertura(p, sel.id)) html = panelAbertura(p, sel.id);
  else if (sel.tipo === 'espacio' && p.espacios[sel.id]) html = panelEspacio(app, p, sel.id);
  else if (sel.tipo === 'pilar' && p.pilares[sel.id]) html = panelPilar(p.pilares[sel.id]);
  else if (sel.tipo === 'nota' && p.elementos[sel.id]) html = panelNota(p.elementos[sel.id]);
  else html = panelPlanta(app, p);
  c.innerHTML = html;
  if (app.est.bloqueado) {
    c.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; });
    c.querySelectorAll('.solo-ed').forEach((el) => el.remove());
  }
}

function panelPlanta(app, p) {
  const ed = app.edificio();
  const muros = Object.values(p.muros);
  const cuenta = (e) => muros.filter((m) => m.estado === e).length;
  let util = 0;
  for (const s of Object.values(app.info.salas)) if (s) util += s.util;
  return `
    <div class="p-cab"><h2>${esc(p.nombre)}</h2><span class="chip">${esc(ed?.nombre)}</span></div>
    <div class="cifras">
      <div class="cifra"><b>${Object.keys(p.espacios).length}</b><span>espacios</span></div>
      <div class="cifra"><b>${fmtM2(util).replace(' m²', '')}</b><span>m² útiles con nombre</span></div>
      <div class="cifra"><b>${muros.length}</b><span>muros</span></div>
      <div class="cifra ${cuenta('provisional') ? 'provisional' : ''}"><b>${cuenta('provisional')}</b><span>por medir</span></div>
    </div>
    <p class="ayuda">${cuenta('importado')} importados del PAU · ${cuenta('medido')} medidos en obra.</p>
    <div class="p-sub">Planta</div>
    ${campo('Nombre', `<input data-k="pl-nombre" value="${esc(p.nombre)}">`)}
    ${campo('Nivel', `<input data-k="pl-nivel" value="${p.nivel}" inputmode="numeric">`)}
    <div class="p-sub">Edificio</div>
    ${campo('Nombre', `<input data-k="ed-nombre" value="${esc(ed?.nombre)}">`)}
    <div class="p-sub">Centro</div>
    ${campo('Nombre', `<input data-k="centro" value="${esc(app.doc.centro?.nombre)}">`)}
    <div class="botonera solo-ed">
      <button class="btn" data-acc="nueva-planta">+ Planta</button>
      <button class="btn" data-acc="nuevo-edificio">+ Edificio</button>
      <button class="btn peligro" data-acc="borrar-planta">Borrar planta</button>
    </div>
    <div class="p-sub">Cómo se usa</div>
    <p class="ayuda">Toca un muro, una puerta o una sala para ver y cambiar sus datos. Arrastra un muro para moverlo:
    los muros unidos le siguen. Con dos dedos (o la rueda del ratón) haces zoom.</p>
    <p class="ayuda">Atajos: <b>V</b> mover · <b>M</b> muro · <b>P</b> puerta · <b>W</b> ventana · <b>E</b> espacio ·
    <b>D</b> medir · <b>F</b> encuadrar · <b>Supr</b> borrar · <b>Ctrl+Z</b> deshacer.</p>`;
}

function panelMuro(app, p, id) {
  const m = p.muros[id];
  const L = M.largo(p, m);
  const ancla = app.est.ancla || 'a';
  const abs = [...m.aberturas].sort((a, b) => a.pos - b.pos).map((o) =>
    `<li><button data-ir-ab="${o.id}">${esc(M.TIPOS_ABERTURA[o.tipo])} · ${num(o.ancho)} m<small>a ${num(o.pos - o.ancho / 2)} m de A</small></button></li>`).join('');
  return `
    <div class="p-cab"><h2>Muro</h2><span class="chip ${m.estado}">${esc(M.ESTADOS_MURO[m.estado])}</span></div>
    ${campo('Longitud', medida('largo', L))}
    <div class="campo solo-ed"><span>Al cambiarla, se mueve</span>
      <div class="seg-mini"><button data-ancla="a" class="${ancla === 'a' ? 'activa' : ''}">extremo B</button><button data-ancla="b" class="${ancla === 'b' ? 'activa' : ''}">extremo A</button></div></div>
    ${campo('Grosor', medida('grosor', m.grosor))}
    ${campo('Tipo', `<select data-k="tipo">${opciones(M.TIPOS_MURO, m.tipo)}</select>`)}
    ${campo('Estado', `<select data-k="estado">${opciones(M.ESTADOS_MURO, m.estado)}</select>`)}
    ${campo('Notas', `<textarea data-k="notas" placeholder="p. ej. medido con láser el 22/10">${esc(m.notas)}</textarea>`)}
    <div class="p-sub">Aberturas (${m.aberturas.length})</div>
    ${abs ? `<ul class="lista">${abs}</ul>` : '<p class="ayuda">Sin puertas ni ventanas. Usa las herramientas Puerta, Ventana o Paso y toca el muro.</p>'}
    <div class="botonera solo-ed">
      <button class="btn" data-acc="partir">Partir en el centro</button>
      <button class="btn" data-acc="invertir">Cambiar A ↔ B</button>
      <button class="btn peligro" data-acc="borrar">Borrar muro</button>
    </div>
    <p class="ayuda solo-ed">Arrastra el muro para moverlo en paralelo, o los círculos A y B para mover sus extremos.
    Si sueltas un extremo encima de otro muro, quedan unidos.</p>`;
}

function panelNodo(p, id) {
  const n = p.nodos[id];
  return `
    <div class="p-cab"><h2>Esquina</h2><span class="chip">${M.murosDeNodo(p, id).length} muros</span></div>
    ${campo('X', medida('nx', n.x))}
    ${campo('Y', medida('ny', n.y))}
    <div class="botonera solo-ed"><button class="btn peligro" data-acc="borrar">Borrar con sus muros</button></div>
    <p class="ayuda">Arrastra la esquina para moverla. Si la sueltas sobre otra, se unen.</p>`;
}

function panelAbertura(p, id) {
  const { m, o } = M.buscarAbertura(p, id);
  const L = M.largo(p, m);
  const puerta = o.tipo.startsWith('puerta');
  return `
    <div class="p-cab"><h2>${esc(M.TIPOS_ABERTURA[o.tipo])}</h2></div>
    ${campo('Tipo', `<select data-k="ab-tipo">${opciones(M.TIPOS_ABERTURA, o.tipo)}</select>`)}
    ${campo('Ancho', medida('ab-ancho', o.ancho))}
    ${campo('Desde A', medida('ab-desde', o.pos - o.ancho / 2))}
    ${campo('Hasta B', `<span class="lectura">${fmtM(L - o.pos - o.ancho / 2)}</span>`)}
    ${puerta ? `<div class="botonera solo-ed">
      <button class="btn" data-acc="lado">Abrir hacia el otro lado</button>
      ${o.tipo === 'puerta' ? '<button class="btn" data-acc="bisagra">Cambiar bisagra</button>' : ''}</div>` : ''}
    <div class="botonera solo-ed">
      <button class="btn" data-acc="ir-muro">Ver el muro</button>
      <button class="btn peligro" data-acc="borrar">Borrar</button>
    </div>
    <p class="ayuda solo-ed">Arrástrala a lo largo del muro para moverla.</p>`;
}

function panelEspacio(app, p, id) {
  const e = p.espacios[id];
  const s = app.info.salas[id];
  return `
    <div class="p-cab"><h2>Espacio</h2>${s ? '' : '<span class="chip provisional">sin cerrar</span>'}</div>
    ${campo('Nombre', `<input data-k="e-nombre" value="${esc(e.nombre)}">`)}
    ${campo('Uso', `<select data-k="e-uso">${opciones(M.USOS, e.uso)}</select>`)}
    ${campo('Grupo / curso', `<input data-k="e-grupo" value="${esc(e.grupo)}" placeholder="p. ej. 1.º ESO A">`)}
    ${campo('Superficie útil', `<span class="lectura">${s ? fmtM2(s.util) : '—'}</span>`)}
    ${campo('Notas', `<textarea data-k="e-notas">${esc(e.notas)}</textarea>`)}
    <div class="botonera solo-ed"><button class="btn peligro" data-acc="borrar">Borrar espacio</button></div>
    <p class="ayuda">${s ? 'La superficie se calcula sola a partir de los muros que la rodean (descontando medio grosor).'
      : 'No hay muros que cierren este espacio, o el rótulo está fuera de la sala. Arrastra el rótulo dentro, o cierra la sala con muros o pasos.'}</p>`;
}

function panelPilar(pl) {
  return `
    <div class="p-cab"><h2>Pilar</h2></div>
    ${campo('X', medida('pl-x', pl.x))}
    ${campo('Y', medida('pl-y', pl.y))}
    ${campo('Ancho', medida('pl-an', pl.an))}
    ${campo('Fondo', medida('pl-al', pl.al))}
    <div class="botonera solo-ed"><button class="btn peligro" data-acc="borrar">Borrar pilar</button></div>`;
}

function panelNota(n) {
  return `
    <div class="p-cab"><h2>Nota</h2></div>
    ${campo('Texto', `<textarea data-k="nota" rows="4">${esc(n.texto)}</textarea>`)}
    <div class="botonera solo-ed"><button class="btn peligro" data-acc="borrar">Borrar nota</button></div>`;
}

/** Aplica el cambio de un campo del panel. */
function aplicar(app, k, valor) {
  const p = app.planta();
  const sel = app.est.sel;
  const n = leerNum(valor);
  const enMetros = ['largo', 'grosor', 'nx', 'ny', 'ab-ancho', 'ab-desde', 'pl-x', 'pl-y', 'pl-an', 'pl-al'];
  if (enMetros.includes(k) && n === null) { app.aviso('Escribe un número, por ejemplo 6,40'); app.panel(); return; }
  app.antes();
  switch (k) {
    case 'pl-nombre': p.nombre = valor.trim() || p.nombre; app.pintarPlantas(); break;
    case 'pl-nivel': p.nivel = parseInt(valor, 10) || 0; app.edificio().plantas.sort((a, b) => a.nivel - b.nivel); app.pintarPlantas(); break;
    case 'ed-nombre': app.edificio().nombre = valor.trim() || app.edificio().nombre; app.pintarPlantas(); break;
    case 'centro': app.doc.centro.nombre = valor.trim(); app.pintarCabecera(); break;
    case 'largo':
      if (n < 0.05) { app.aviso('El muro tiene que medir al menos 5 cm.'); break; }
      M.fijarLargo(p, sel.id, n, app.est.ancla || 'a');
      for (const nid of [p.muros[sel.id].a, p.muros[sel.id].b]) for (const mid of M.murosDeNodo(p, nid)) M.ajustarAberturas(p, mid);
      break;
    case 'grosor': p.muros[sel.id].grosor = Math.min(Math.max(n, 0.02), 1.5); break;
    case 'tipo': p.muros[sel.id].tipo = valor; break;
    case 'estado': p.muros[sel.id].estado = valor; break;
    case 'notas': p.muros[sel.id].notas = valor; break;
    case 'nx': p.nodos[sel.id].x = n; break;
    case 'ny': p.nodos[sel.id].y = n; break;
    case 'ab-tipo': {
      const { o } = M.buscarAbertura(p, sel.id);
      o.tipo = valor;
      if (valor.startsWith('puerta')) { o.lado ||= 1; o.bisagra ||= 'a'; }
      break;
    }
    case 'ab-ancho': {
      const { m, o, mid } = M.buscarAbertura(p, sel.id);
      const izq = o.pos - o.ancho / 2;
      o.ancho = Math.max(0.2, Math.min(n, M.largo(p, m)));
      o.pos = izq + o.ancho / 2;
      M.ajustarAberturas(p, mid);
      break;
    }
    case 'ab-desde': {
      const { o, mid } = M.buscarAbertura(p, sel.id);
      o.pos = n + o.ancho / 2;
      M.ajustarAberturas(p, mid);
      break;
    }
    case 'e-nombre': p.espacios[sel.id].nombre = valor.trim() || 'Sin nombre'; break;
    case 'e-uso': p.espacios[sel.id].uso = valor; break;
    case 'e-grupo': p.espacios[sel.id].grupo = valor.trim(); break;
    case 'e-notas': p.espacios[sel.id].notas = valor; break;
    case 'pl-x': p.pilares[sel.id].x = n; break;
    case 'pl-y': p.pilares[sel.id].y = n; break;
    case 'pl-an': p.pilares[sel.id].an = Math.max(n, 0.05); break;
    case 'pl-al': p.pilares[sel.id].al = Math.max(n, 0.05); break;
    case 'nota': p.elementos[sel.id].texto = valor; break;
  }
  app.cambio();
}

function accion(app, acc) {
  const p = app.planta();
  const sel = app.est.sel;
  switch (acc) {
    case 'borrar': app.borrarSeleccion(); return;
    case 'partir': {
      app.antes();
      const m = p.muros[sel.id];
      M.partirMuro(p, sel.id, M.largo(p, m) / 2);
      app.cambio();
      return;
    }
    case 'invertir': app.antes(); M.invertirMuro(p, sel.id); app.cambio(); return;
    case 'lado': { app.antes(); const { o } = M.buscarAbertura(p, sel.id); o.lado = -(o.lado || 1); app.cambio(); return; }
    case 'bisagra': { app.antes(); const { o } = M.buscarAbertura(p, sel.id); o.bisagra = o.bisagra === 'b' ? 'a' : 'b'; app.cambio(); return; }
    case 'ir-muro': { const r = M.buscarAbertura(p, sel.id); app.seleccionar({ tipo: 'muro', id: r.mid }); return; }
    case 'nueva-planta': app.nuevaPlanta(); return;
    case 'nuevo-edificio': app.nuevoEdificio(); return;
    case 'borrar-planta': app.borrarPlanta(); return;
  }
}

export function instalarPanel(app) {
  const c = document.getElementById('pest-props');
  c.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k) aplicar(app, k, e.target.value);
  });
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') e.target.blur();
  });
  c.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.acc) accion(app, b.dataset.acc);
    else if (b.dataset.ancla) { app.est.ancla = b.dataset.ancla; app.panel(); }
    else if (b.dataset.irAb) app.seleccionar({ tipo: 'abertura', id: b.dataset.irAb });
  });

  // pestañas
  document.querySelectorAll('.pestanas button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b));
    for (const id of ['props', 'capas', 'versiones']) document.getElementById('pest-' + id).hidden = id !== b.dataset.pest;
    if (b.dataset.pest === 'capas') pintarCapas(app);
    if (b.dataset.pest === 'versiones') pintarVersiones(app);
  }));

  document.getElementById('pest-capas').addEventListener('input', (e) => {
    const k = e.target.dataset.capa;
    if (!k) return;
    if (k === 'calcoOpac') app.est.capas.calcoOpac = +e.target.value;
    else app.est.capas[k] = e.target.checked;
    app.pintar({ calco: true });
    app.guardarPreferencias();
  });

  const pv = document.getElementById('pest-versiones');
  pv.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.acc === 'nueva-version') {
      const nombre = pv.querySelector('[data-k="v-nombre"]').value.trim();
      app.guardarVersion(nombre || 'Versión sin nombre');
      pintarVersiones(app);
    } else if (b.dataset.restaurar) {
      app.restaurarVersion(b.dataset.restaurar);
      pintarVersiones(app);
    } else if (b.dataset.borrarV) {
      app.borrarVersion(b.dataset.borrarV);
      pintarVersiones(app);
    }
  });
  pv.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.k === 'v-nombre') pv.querySelector('[data-acc="nueva-version"]').click();
  });
}

export function pintarCapas(app) {
  const p = app.planta();
  const c = app.est.capas;
  const tiene = (k) => !!p?.calco?.capas?.[k];
  const fila = (k, nombre, desc, muestra, extra = '') => `
    <label class="capa"><span class="muestra" style="${muestra}"></span>
      <div>${esc(nombre)}<small>${esc(desc)}</small>${extra}</div>
      <span class="interruptor"><input type="checkbox" data-capa="${k}" ${c[k] ? 'checked' : ''}></span></label>`;
  let html = '<div class="p-sub" style="margin-top:0">Plano de referencia (PAU 2026)</div>';
  if (tiene('arquitectura')) {
    html += fila('calco', 'Calco del plano original', 'El dibujo del PAU debajo de tus muros, para comparar.', 'background:#8a94a6',
      `<input type="range" min="0.1" max="1" step="0.05" value="${c.calcoOpac}" data-capa="calcoOpac" aria-label="Opacidad del calco">`);
    if (tiene('pci')) html += fila('pci', 'Medios contra incendios', 'Extintores, BIE, pulsadores, cuadros eléctricos.', 'background:#e11d1d');
    if (tiene('evacuacion')) html += fila('evacuacion', 'Evacuación', 'Recorridos, salidas y escaleras.', 'background:#37dd00');
    if (tiene('sectores')) html += fila('sectores', 'Sectores y locales de riesgo', 'Sectorización de incendios.', 'background:repeating-linear-gradient(90deg,#f00 0 5px,transparent 5px 8px)');
  } else {
    html += '<p class="ayuda">Esta planta no tiene calco.</p>';
  }
  html += '<div class="p-sub">Plano</div>';
  html += fila('muros', 'Muros, puertas y ventanas', '', 'background:#262b33');
  html += fila('espacios', 'Color de los espacios', 'Según su uso.', `background:${COLOR_USO.aula}`);
  html += fila('rotulos', 'Nombres y superficies', '', 'background:#fff;border:1px solid #ccc');
  html += fila('cotas', 'Cotas al seleccionar', '', 'background:#2457d6');
  html += fila('sueltos', 'Extremos sueltos', 'Muros que no llegan a unirse con otro: impiden cerrar la sala. Arrastra el extremo hasta el muro.', 'background:#fff;border:2px solid #dc2626;border-radius:50%;width:14px');
  html += fila('rejilla', 'Rejilla', 'Cuadrícula de 1 m (más fina al acercarte).', 'background:#e2dfd5');
  html += '<div class="p-sub">Usos</div><div class="cifras">' +
    Object.entries(M.USOS).map(([k, v]) => `<div class="capa" style="border:0;padding:3px 0"><span class="muestra" style="background:${COLOR_USO[k]};border:1px solid #ddd"></span><div>${esc(v)}</div></div>`).join('') + '</div>';
  document.getElementById('pest-capas').innerHTML = html;
}

export function pintarVersiones(app) {
  const vs = [...(app.doc?.versiones || [])].reverse();
  const ro = app.est.bloqueado;
  document.getElementById('pest-versiones').innerHTML = `
    <p class="ayuda" style="margin-top:0">Una versión es una foto de todo el plano (todas las plantas). Guárdala antes y después de cada obra
    para poder volver atrás o consultar cómo era.</p>
    ${ro ? '' : `<div class="campo ancho" style="margin-top:12px"><input data-k="v-nombre" placeholder="p. ej. Antes de la obra de 1.º ESO"></div>
    <button class="btn primario" data-acc="nueva-version" style="width:100%">Guardar versión</button>`}
    <div class="p-sub">Guardadas (${vs.length})</div>
    ${vs.length ? vs.map((v) => `<div class="version"><div><b title="${esc(v.nombre)}">${esc(v.nombre)}</b><small>${fecha(v.fecha)}</small></div>
      ${ro ? '' : `<button class="btn" data-restaurar="${v.id}">Restaurar</button><button class="btn-ic" data-borrar-v="${v.id}" title="Borrar versión"><svg class="ic"><use href="#i-papelera"/></svg></button>`}</div>`).join('')
      : '<p class="ayuda">Todavía no hay versiones.</p>'}`;
}
