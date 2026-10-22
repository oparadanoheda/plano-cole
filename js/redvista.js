// Dibujo de la red sobre el plano. Los cables van en metros, dentro del «mundo»; los equipos,
// los pasos de planta y los tiradores, en píxeles de pantalla (siempre del mismo tamaño).
// Al pintar se apunta dónde ha quedado cada cosa en la pantalla, para saber qué se toca.

import { aPantalla } from './vista.js';
import { dist, distSegmento } from './geo.js';
import * as R from './red.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (v) => (Math.round(v * 100) / 100).toString();
const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Glifos de los equipos: trazos blancos en una caja de ±8 px. */
export const GLIFOS = {
  armario: 'M-4.5 -7h9v14h-9zM-4.5 -3.4h9M-4.5 0h9M-4.5 3.4h9',
  router: 'M-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M-6 0h12M0 -6c-3 3.2 -3 8.8 0 12M0 -6c3 3.2 3 8.8 0 12',
  switch: 'M-7.5 -3.5h15v7h-15zM-4.5 -.4v.8M-1.5 -.4v.8M1.5 -.4v.8M4.5 -.4v.8',
  panel: 'M-7.5 -3h15v6h-15zM-5 0h.01M-2.5 0h.01M0 0h.01M2.5 0h.01M5 0h.01',
  ap: 'M-7 -1.2a9.9 9.9 0 0 1 14 0M-4.4 1.6a6.2 6.2 0 0 1 8.8 0M-1.9 4.3a2.7 2.7 0 0 1 3.8 0',
  toma: 'M-3.6 -2.6h7.2v4h-1.8v1.8h-3.6v-1.8h-1.8z',
  equipo: 'M-6.5 -5h13v8h-13zM-2.5 6h5M0 3v3',
};

/** Icono de un equipo (en píxeles, centrado en 0,0). */
export function iconoEquipo(tipo, r = tipo === 'toma' ? 8 : 11) {
  const color = R.TIPOS_EQUIPO[tipo]?.color || '#475569';
  const fondo = tipo === 'ap'
    ? `<circle class="eq-fondo" r="${r}" fill="${color}"/>`
    : `<rect class="eq-fondo" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" rx="${tipo === 'toma' ? 3 : 5}" fill="${color}"/>`;
  return fondo + `<path class="eq-glifo" d="${GLIFOS[tipo] || GLIFOS.equipo}"${tipo === 'toma' ? ' transform="scale(1.1)"' : ''}/>`;
}

/** La red se ve siempre en el modo Red, y en los demás (menos el 3D) si su capa está encendida. */
export const mostrarRed = (est) => est.modo === 'red' || (est.capas.red && est.modo !== '3d');
/** Lo resaltado (y lo demás, atenuado) solo mientras se consulta, no mientras se dibuja. */
const focoActivo = (est) => (est.herr === 'sel' ? est.redFoco : null);

/** Planta que representa a cada edificio en la vista «Exterior»: la más cercana a la baja. */
const plantaDeContexto = (ed) => [...ed.plantas].sort((a, b) => Math.abs(a.nivel) - Math.abs(b.nivel))[0];

/** Equipos que se ven en la planta actual. Los de dentro de un armario no: los representa su
 *  armario. En la vista «Exterior», también los de la planta baja de cada edificio. */
export function equiposVisibles(app, ip) {
  const p = app.planta(), red = app.doc.red, ed = app.edificio();
  const plantas = new Set([p.id]);
  if (ed?.exterior) for (const e2 of app.doc.edificios) if (!e2.exterior && e2.plantas.length) plantas.add(plantaDeContexto(e2).id);
  const dentro = new Map();
  for (const e of Object.values(red.equipos)) if (e.en) dentro.set(e.en, (dentro.get(e.en) || 0) + 1);
  const res = [];
  for (const [id, e] of Object.entries(red.equipos)) {
    if (e.en || !plantas.has(e.pl)) continue;
    const pos = e.pl === p.id ? { x: e.x, y: e.y } : R.aPlanta(ip, e, e.pl, p.id);
    res.push({ id, e, pos, ajeno: e.pl !== p.id, dentro: dentro.get(id) || 0 });
  }
  return res;
}

// ---------------------------------------------------------------------------- mundo (metros)

export function pintarRedMundo(g, app) {
  const p = app.planta(), est = app.est, red = app.doc?.red;
  if (!p || !red || !mostrarRed(est)) { g.innerHTML = ''; return; }
  const ip = R.indicePlantas(app.doc);
  const foco = focoActivo(est), sel = est.sel;
  const out = [], halos = [], lineas = [];
  if (est.capas.wifi) {
    for (const v of equiposVisibles(app, ip)) {
      if (v.e.tipo === 'ap') out.push(`<circle class="cobertura" cx="${f(v.pos.x)}" cy="${f(v.pos.y)}" r="${f(v.e.alcance || 15)}"/>`);
    }
  }
  for (const [cid, c] of Object.entries(red.cables)) {
    const rec = R.recorrido(red, ip, c);
    const esSel = sel?.tipo === 'cable' && sel.id === cid;
    const tenue = foco && !foco.cables.has(cid);
    for (const t of rec.tramos) {
      if (t.pl !== p.id || t.pts.length < 2) continue;
      const d = 'M' + t.pts.map((q) => f(q.x) + ' ' + f(q.y)).join('L');
      if (esSel || (foco && !tenue)) halos.push(`<path class="cable-halo${esSel ? ' sel' : ''}" d="${d}"/>`);
      lineas.push(`<path class="cable ${c.estado}${tenue ? ' tenue' : ''}${esSel ? ' sel' : ''}" stroke="${R.TIPOS_CABLE[c.tipo].color}" d="${d}"/>`);
    }
  }
  g.innerHTML = out.join('') + halos.join('') + lineas.join('');
}

// ---------------------------------------------------------------------------- pantalla (píxeles)

const corto = (s, n = 12) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Lo que de la red se puede tocar en la pantalla: iconos de equipos, pasos de planta y, del
 *  cable seleccionado, sus puntos y los + de en medio. Se calcula al pintar y también al tocar,
 *  para no depender de que ya se haya repintado. */
export function objetivosRed(app, w = app.svg.clientWidth, h = app.svg.clientHeight) {
  const res = { iconos: [], pasos: [], vertices: [], medios: [], sueltos: [] };
  const p = app.planta(), est = app.est, red = app.doc?.red;
  if (!p || !red || !mostrarRed(est)) return res;
  const v = est.vista;
  const ip = R.indicePlantas(app.doc);
  const bases = R.basesPlantas(app.doc);
  const foco = focoActivo(est), sel = est.sel;
  const fuera = (s, m = 30) => s.x < -m || s.y < -m || s.x > w + m || s.y > h + m;

  // pasos de una planta a otra (los que coinciden se juntan) y extremos sueltos
  const pasos = new Map();
  for (const [cid, c] of Object.entries(red.cables)) {
    const rec = R.recorrido(red, ip, c);
    const tenue = !!foco && !foco.cables.has(cid);
    for (const k of rec.cambios) {
      for (const [pl, q, otro] of [[k.de, k.pDe, k.a], [k.a, k.pA, k.de]]) {
        if (pl !== p.id) continue;
        const s = aPantalla(v, q);
        if (fuera(s)) continue;
        const clave = `${Math.round(s.x / 10)},${Math.round(s.y / 10)},${otro}`;
        const m = pasos.get(clave) || { s, q, otro, n: 0, tenue: true };
        m.n++;
        if (!tenue) m.tenue = false;
        pasos.set(clave, m);
      }
    }
    const t0 = rec.tramos[0], tn = rec.tramos[rec.tramos.length - 1];
    const suelto = (q) => { const s = aPantalla(v, q); if (!fuera(s)) res.sueltos.push({ s, tenue }); };
    if (!c.a && t0?.pl === p.id && t0.pts.length) suelto(t0.pts[0]);
    if (!c.b && tn?.pl === p.id && tn.pts.length) suelto(tn.pts[tn.pts.length - 1]);
  }
  // equipos
  for (const it of equiposVisibles(app, ip)) {
    const s = aPantalla(v, it.pos);
    if (fuera(s)) continue;
    const r = it.e.tipo === 'toma' ? 8 : 11;
    res.iconos.push({ id: it.id, it, s, r: r + 5, radio: r, pos: it.pos, ajeno: it.ajeno });
  }

  const edActual = app.edificio();
  for (const m of pasos.values()) {
    const r = ip.get(m.otro);
    if (!r) continue;
    // el paso es un equipo: si ese equipo ya se ve aquí (vista Exterior), sobra; si no, va debajo
    const eq = res.iconos.find((q) => dist(q.s, m.s) < 12);
    if (eq?.ajeno && eq.it.e.pl === m.otro) continue;
    const s = eq ? { x: eq.s.x, y: eq.s.y + eq.radio + 13 } : m.s;
    const dz = (bases.get(m.otro) ?? 0) - (bases.get(p.id) ?? 0);
    const flecha = Math.abs(dz) < 0.01 ? '→' : dz > 0 ? '↑' : '↓';
    const texto = (r.ed === edActual ? `${flecha} ${R.etiquetaNivel(r.p.nivel)}`
      : `${flecha} ${corto(r.ed.nombre)}${r.ed.plantas.length > 1 ? ' ' + R.etiquetaNivel(r.p.nivel) : ''}`) + (m.n > 1 ? ` ×${m.n}` : '');
    res.pasos.push({ ...m, s, pl: m.otro, ed: r.ed.id, texto, ancho: texto.length * 6.6 + 14 });
  }

  // cable seleccionado: puntos que se arrastran y, en medio de cada tramo, un + para añadir otro
  if (est.modo === 'red' && est.herr === 'sel' && sel?.tipo === 'cable' && red.cables[sel.id]) {
    const c = red.cables[sel.id];
    const rec = R.recorrido(red, ip, c);
    c.tramos.forEach((t, ti) => {
      if (t.pl !== p.id) return;
      const o = ti === 0 && c.a ? 1 : 0; // el primer punto dibujado es el equipo A, no se guarda
      const dib = rec.tramos[ti].pts;
      for (let j = 0; j + 1 < dib.length; j++) {
        const a = aPantalla(v, dib[j]), b = aPantalla(v, dib[j + 1]);
        if (dist(a, b) < 44) continue;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (!fuera(m)) res.medios.push({ t: ti, i: j + 1 - o, s: m });
      }
      R.pares(t.pts).forEach((q, i) => {
        const s = aPantalla(v, q);
        if (!fuera(s)) res.vertices.push({ t: ti, i, s, act: est.redVert?.t === ti && est.redVert.i === i });
      });
    });
  }
  return res;
}

export function pintarRedSobre(g, app, w, h) {
  const o = objetivosRed(app, w, h);
  app.redIconos = o.iconos;
  const p = app.planta(), est = app.est, red = app.doc?.red;
  if (!p || !red || !mostrarRed(est)) { g.innerHTML = ''; return; }
  const v = est.vista;
  const ip = R.indicePlantas(app.doc);
  const foco = focoActivo(est), sel = est.sel;
  const out = [];
  for (const s of o.sueltos) out.push(`<circle class="extremo-suelto${s.tenue ? ' tenue' : ''}" cx="${f(s.s.x)}" cy="${f(s.s.y)}" r="4.5"/>`);
  for (const m of o.pasos) {
    out.push(`<g class="paso${m.tenue ? ' tenue' : ''}" transform="translate(${f(m.s.x)} ${f(m.s.y)})"><rect x="${f(-m.ancho / 2)}" y="-9" width="${f(m.ancho)}" height="18" rx="9"/><text y="4">${esc(m.texto)}</text></g>`);
  }

  // equipos
  const dentroFoco = new Set();
  if (foco) for (const id of foco.equipos) { const e = red.equipos[id]; if (e?.en) dentroFoco.add(e.en); }
  const selEq = sel?.tipo === 'equipo' && red.equipos[sel.id] ? red.equipos[sel.id].en || sel.id : null;
  for (const { id, it, s, radio: r } of o.iconos) {
    const tipo = it.e.tipo;
    const tenue = foco && !foco.equipos.has(id) && !dentroFoco.has(id);
    const anillo = selEq === id ? `<circle class="eq-anillo" r="${r + 5}"/>` : '';
    const insignia = it.dentro ? `<g class="eq-insignia" transform="translate(${r} ${-r})"><circle r="7.5"/><text y="3.5">${it.dentro}</text></g>` : '';
    const nombre = selEq === id || v.z > (tipo === 'toma' || tipo === 'equipo' ? 16 : 5)
      ? `<text class="eq-nombre" x="${r + 5}" y="4">${esc(it.e.nombre)}</text>` : '';
    out.push(`<g class="eq${tenue ? ' tenue' : ''}${it.ajeno ? ' ajeno' : ''}" transform="translate(${f(s.x)} ${f(s.y)})">${anillo}${iconoEquipo(tipo, r)}${insignia}${nombre}</g>`);
  }
  for (const m of o.medios) out.push(`<g class="medio" transform="translate(${f(m.s.x)} ${f(m.s.y)})"><circle r="6.5"/><path d="M-3 0h6M0 -3v6"/></g>`);
  for (const q of o.vertices) out.push(`<circle class="vertice${q.act ? ' sel' : ''}" cx="${f(q.s.x)}" cy="${f(q.s.y)}" r="6"/>`);

  // cable que se está tendiendo
  const tc = est.temp?.cable;
  if (tc && est.modo === 'red') {
    const t = tc.tramos[tc.tramos.length - 1];
    let largo = 0;
    for (const tr of tc.tramos) {
      const ps = R.pares(tr.pts);
      if (tr === tc.tramos[0] && tc.a) { const l = R.lugar(red, tc.a.eq); if (l) ps.unshift(R.aPlanta(ip, l, l.pl, tr.pl)); }
      if (tr === t && tc.cursor) ps.push(tc.cursor);
      for (let i = 1; i < ps.length; i++) largo += dist(ps[i - 1], ps[i]);
      if (tr !== t || tr.pl !== p.id) continue;
      const ss = ps.map((q) => aPantalla(v, q));
      if (ss.length >= 2) out.push(`<path class="dib-cable" d="M${ss.map((q) => f(q.x) + ' ' + f(q.y)).join('L')}"/>`);
      for (const q of tc.cursor ? ss.slice(0, -1) : ss) out.push(`<circle class="dib-punto" cx="${f(q.x)}" cy="${f(q.y)}" r="3.5"/>`);
      if (tc.cursor) {
        const s = aPantalla(v, tc.cursor);
        out.push(`<g class="dib-largo" transform="translate(${f(s.x + 14)} ${f(s.y + 22)})"><rect x="-4" y="-13" width="${f(nf.format(largo).length * 7.5 + 20)}" height="19" rx="5"/><text y="1">${nf.format(largo)} m</text></g>`);
      }
    }
    if (tc.snap) {
      const s = aPantalla(v, tc.snap);
      out.push(`<rect class="snap" x="${f(s.x - 7)}" y="${f(s.y - 7)}" width="14" height="14"/>`);
    }
  }
  g.innerHTML = out.join('');
}

/** Cable más cercano a un punto de la pantalla (a menos de «tol» píxeles). */
export function cableEn(app, s, tol = 7) {
  const p = app.planta(), red = app.doc.red, v = app.est.vista;
  const ip = R.indicePlantas(app.doc);
  let mejor = null, md = tol;
  for (const [cid, c] of Object.entries(red.cables)) {
    for (const t of R.recorrido(red, ip, c).tramos) {
      if (t.pl !== p.id) continue;
      for (let i = 1; i < t.pts.length; i++) {
        const d = distSegmento(s, aPantalla(v, t.pts[i - 1]), aPantalla(v, t.pts[i]));
        if (d < md) { md = d; mejor = cid; }
      }
    }
  }
  return mejor;
}

// ---------------------------------------------------------------------------- exportar (metros)

/** La red de una planta para el SVG exportado o impreso: todo en metros. */
export function htmlRedExport(app, p) {
  const red = app.doc.red;
  if (!red) return '';
  const ip = R.indicePlantas(app.doc);
  const out = [];
  for (const c of Object.values(red.cables)) {
    const rec = R.recorrido(red, ip, c);
    for (const t of rec.tramos) {
      if (t.pl !== p.id || t.pts.length < 2) continue;
      const color = c.estado === 'averia' ? '#dc2626' : R.TIPOS_CABLE[c.tipo].color;
      out.push(`<path class="ex-cable${c.estado === 'proyecto' ? ' proyecto' : ''}" stroke="${color}" d="M${t.pts.map((q) => f(q.x) + ' ' + f(q.y)).join('L')}"/>`);
    }
    for (const k of rec.cambios) {
      for (const [pl, q, otro] of [[k.de, k.pDe, k.a], [k.a, k.pA, k.de]]) {
        if (pl !== p.id) continue;
        const r = ip.get(otro);
        const texto = r ? (r.ed === ip.get(p.id)?.ed ? R.etiquetaNivel(r.p.nivel) : corto(r.ed.nombre, 10)) : '';
        out.push(`<g transform="translate(${f(q.x)} ${f(q.y)})"><circle class="ex-paso" r="0.22"/><text class="ex-paso-t" x="0.3" y="0.1">${esc(texto)}</text></g>`);
      }
    }
  }
  for (const [id, e] of Object.entries(red.equipos)) {
    if (e.en || e.pl !== p.id) continue;
    const n = Object.values(red.equipos).filter((o) => o.en === id).length;
    out.push(`<g transform="translate(${f(e.x)} ${f(e.y)})"><g transform="scale(0.032)">${iconoEquipo(e.tipo)}</g>` +
      `<text class="ex-eq" x="0.45" y="0.11">${esc(e.nombre)}${n ? ` (+${n})` : ''}</text></g>`);
  }
  return out.length ? `<g class="ex-red">${out.join('')}</g>` : '';
}
