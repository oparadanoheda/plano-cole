// Dibujo del plano en SVG.
//  - «mundo» va en metros y se transforma con la vista (zoom y desplazamiento).
//  - «sobre» va en píxeles de pantalla: rótulos, cotas, tiradores y rejilla,
//    para que el texto y los tiradores tengan siempre el mismo tamaño.

import { dist, sub, add, mul, unit, perp, num, fmtM, fmtM2 } from './geo.js';
import { largo } from './modelo.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (v) => (Math.round(v * 1000) / 1000).toString();
const pt = (p) => f(p.x) + ' ' + f(p.y);

export const COLOR_USO = {
  aula: '#e7eef9', despacho: '#f1eaf7', aseo: '#e3f2ee', almacen: '#f3efe6', comedor: '#fcefe1',
  deporte: '#e8f3e1', instalaciones: '#f9e6e7', paso: '#f4f4f2', otro: '#efefed',
};

// ---------------------------------------------------------------------------
// Calco (dibujo original del PAU)
// ---------------------------------------------------------------------------

const ESTILO_CALCO = {
  arquitectura: { trazo: '#8a94a6', relleno: '#8a94a6' },
};

export function pintarCalco(g, planta, capas) {
  const partes = [];
  const c = planta?.calco?.capas || {};
  for (const nombre of ['arquitectura', 'sectores', 'evacuacion', 'pci']) {
    if (!c[nombre] || !capas[nombre === 'arquitectura' ? 'calco' : nombre]) continue;
    const forzado = ESTILO_CALCO[nombre];
    const op = nombre === 'arquitectura' ? capas.calcoOpac : 0.85;
    partes.push(`<g class="calco calco-${nombre}" opacity="${op}">`);
    for (const t of c[nombre]) {
      const trazo = t.trazo ? (forzado ? forzado.trazo : t.trazo) : 'none';
      const relleno = t.relleno ? (forzado ? forzado.relleno : t.relleno) : 'none';
      partes.push(`<path d="${t.d}" stroke="${trazo}" fill="${relleno}"${t.parImpar ? ' fill-rule="evenodd"' : ''}` +
        (t.trazo ? ` stroke-width="${t.ancho || 0.6}" vector-effect="non-scaling-stroke"` : '') +
        (t.discontinuo ? ' stroke-dasharray="4 3"' : '') + '/>');
    }
    partes.push('</g>');
  }
  g.innerHTML = partes.join('');
}

// ---------------------------------------------------------------------------
// Geometría de los muros
// ---------------------------------------------------------------------------

/** Cuánto se prolonga cada extremo del muro para que las esquinas queden macizas. */
function prolongacion(planta, mid, nid, porNodo) {
  let e = 0;
  for (const otro of porNodo.get(nid) || []) {
    if (otro === mid) continue;
    e = Math.max(e, planta.muros[otro].grosor / 2);
  }
  return Math.min(e, 0.6);
}

export function indicePorNodo(planta) {
  const porNodo = new Map();
  for (const [id, m] of Object.entries(planta.muros)) {
    for (const n of [m.a, m.b]) {
      if (!porNodo.has(n)) porNodo.set(n, []);
      porNodo.get(n).push(id);
    }
  }
  return porNodo;
}

/** Datos para dibujar un muro: tramos macizos y aberturas, en coordenadas de mundo. */
export function geometriaMuro(planta, mid, porNodo) {
  const m = planta.muros[mid];
  const A = planta.nodos[m.a], B = planta.nodos[m.b];
  const L = dist(A, B);
  const u = unit(sub(B, A)), n = perp(u), h = m.grosor / 2;
  const ea = prolongacion(planta, mid, m.a, porNodo);
  const eb = prolongacion(planta, mid, m.b, porNodo);
  let libres = [[-ea, L + eb]];
  const huecos = [...m.aberturas].sort((x, y) => x.pos - y.pos);
  for (const o of huecos) {
    const a = o.pos - o.ancho / 2, b = o.pos + o.ancho / 2;
    const r = [];
    for (const [x0, x1] of libres) {
      if (b <= x0 || a >= x1) { r.push([x0, x1]); continue; }
      if (a > x0) r.push([x0, a]);
      if (b < x1) r.push([b, x1]);
    }
    libres = r;
  }
  const P = (s, d) => add(add(A, mul(u, s)), mul(n, d));
  const tramos = libres.filter(([a, b]) => b - a > 0.001).map(([a, b]) => [P(a, -h), P(b, -h), P(b, h), P(a, h)]);
  return { m, A, B, L, u, n, h, P, tramos, contorno: [P(-ea, -h), P(L + eb, -h), P(L + eb, h), P(-ea, h)] };
}

function simboloAbertura(G, o) {
  const { P, h, u, n } = G;
  const a = o.pos - o.ancho / 2, b = o.pos + o.ancho / 2;
  const out = [];
  if (o.tipo === 'ventana') {
    out.push(`<path class="ab-marco" d="M${pt(P(a, -h))}L${pt(P(b, -h))}M${pt(P(a, h))}L${pt(P(b, h))}M${pt(P(a, -h))}L${pt(P(a, h))}M${pt(P(b, -h))}L${pt(P(b, h))}"/>`);
    out.push(`<path class="ab-vidrio" d="M${pt(P(a, -0.025))}L${pt(P(b, -0.025))}M${pt(P(a, 0.025))}L${pt(P(b, 0.025))}"/>`);
  } else if (o.tipo === 'paso') {
    out.push(`<path class="ab-paso" d="M${pt(P(a, -h))}L${pt(P(b, -h))}M${pt(P(a, h))}L${pt(P(b, h))}"/>`);
  } else {
    const lado = o.lado || 1;
    const hojas = o.tipo === 'puerta-doble'
      ? [{ s: a, w: o.ancho / 2, dir: 1 }, { s: b, w: o.ancho / 2, dir: -1 }]
      : [{ s: o.bisagra === 'b' ? b : a, w: o.ancho, dir: o.bisagra === 'b' ? -1 : 1 }];
    for (const hj of hojas) {
      const H = P(hj.s, lado * h);
      const dl = mul(n, lado), ds = mul(u, hj.dir);
      const fin = add(H, mul(dl, hj.w));
      let arco = `M${pt(fin)}`;
      for (let i = 1; i <= 12; i++) {
        const th = (i / 12) * (Math.PI / 2);
        arco += `L${pt(add(H, add(mul(dl, hj.w * Math.cos(th)), mul(ds, hj.w * Math.sin(th)))))}`;
      }
      out.push(`<path class="ab-hoja" d="M${pt(H)}L${pt(fin)}"/><path class="ab-arco" d="${arco}"/>`);
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Modelo: espacios, muros, pilares
// ---------------------------------------------------------------------------

export function pintarModelo(g, planta, info, capas) {
  const out = [];
  if (capas.espacios) {
    out.push('<g class="espacios">');
    for (const [id, e] of Object.entries(planta.espacios)) {
      const s = info.salas[id];
      if (!s) continue;
      out.push(`<path data-esp="${id}" fill="${COLOR_USO[e.uso] || COLOR_USO.otro}" d="M${s.cara.pts.map(pt).join('L')}Z"/>`);
    }
    out.push('</g>');
  }
  if (capas.muros) {
    const porNodo = indicePorNodo(planta);
    const macizos = { fachada: [], carga: [], tabique: [] }, prov = [], simbolos = [];
    for (const mid of Object.keys(planta.muros)) {
      const G = geometriaMuro(planta, mid, porNodo);
      const d = G.tramos.map((q) => `M${q.map(pt).join('L')}Z`).join('');
      (macizos[G.m.tipo] || macizos.tabique).push(d);
      if (G.m.estado === 'provisional') prov.push(d);
      for (const o of G.m.aberturas) simbolos.push(simboloAbertura(G, o));
    }
    out.push('<g class="muros">');
    for (const [tipo, ds] of Object.entries(macizos)) if (ds.length) out.push(`<path class="muro muro-${tipo}" d="${ds.join('')}"/>`);
    if (prov.length) out.push(`<path class="muro-provisional" d="${prov.join('')}"/>`);
    out.push(`<g class="aberturas">${simbolos.join('')}</g></g>`);
  }
  out.push('<g class="pilares">');
  for (const pl of planta.pilares) out.push(`<rect class="pilar" x="${f(pl.x)}" y="${f(pl.y)}" width="${f(pl.an)}" height="${f(pl.al)}"/>`);
  out.push('</g>');
  g.innerHTML = out.join('');
}

/** Resalte de la selección (en coordenadas de mundo). */
export function pintarSeleccion(g, planta, sel, info) {
  if (!sel) { g.innerHTML = ''; return; }
  const out = [];
  if (sel.tipo === 'muro' && planta.muros[sel.id]) {
    const G = geometriaMuro(planta, sel.id, indicePorNodo(planta));
    out.push(`<path class="sel-muro" d="M${G.contorno.map(pt).join('L')}Z"/>`);
  } else if (sel.tipo === 'abertura') {
    for (const [mid, m] of Object.entries(planta.muros)) {
      const o = m.aberturas.find((x) => x.id === sel.id);
      if (!o) continue;
      const G = geometriaMuro(planta, mid, indicePorNodo(planta));
      const a = o.pos - o.ancho / 2, b = o.pos + o.ancho / 2;
      out.push(`<path class="sel-abertura" d="M${[G.P(a, -G.h - 0.05), G.P(b, -G.h - 0.05), G.P(b, G.h + 0.05), G.P(a, G.h + 0.05)].map(pt).join('L')}Z"/>`);
    }
  } else if (sel.tipo === 'espacio' && info.salas[sel.id]) {
    out.push(`<path class="sel-espacio" d="M${info.salas[sel.id].cara.pts.map(pt).join('L')}Z"/>`);
  } else if (sel.tipo === 'pilar' && planta.pilares[sel.id]) {
    const pl = planta.pilares[sel.id];
    out.push(`<rect class="sel-muro" x="${f(pl.x)}" y="${f(pl.y)}" width="${f(pl.an)}" height="${f(pl.al)}"/>`);
  }
  g.innerHTML = out.join('');
}

// ---------------------------------------------------------------------------
// Capa de pantalla
// ---------------------------------------------------------------------------

export const aPantalla = (v, p) => ({ x: p.x * v.z + v.x, y: p.y * v.z + v.y });
export const aMundo = (v, p) => ({ x: (p.x - v.x) / v.z, y: (p.y - v.y) / v.z });

function rejilla(v, w, h) {
  const pasos = [0.1, 0.5, 1, 5, 10, 50];
  const paso = pasos.find((s) => s * v.z >= 14) || 50;
  const mayor = paso * (paso === 0.5 ? 2 : 5);
  const tl = aMundo(v, { x: 0, y: 0 }), br = aMundo(v, { x: w, y: h });
  let menor = '', may = '';
  for (let x = Math.floor(tl.x / paso) * paso; x <= br.x; x += paso) {
    const sx = Math.round(x * v.z + v.x) + 0.5;
    const esM = Math.abs(x / mayor - Math.round(x / mayor)) < 1e-6;
    (esM ? (s) => (may += s) : (s) => (menor += s))(`M${sx} 0V${h}`);
  }
  for (let y = Math.floor(tl.y / paso) * paso; y <= br.y; y += paso) {
    const sy = Math.round(y * v.z + v.y) + 0.5;
    const esM = Math.abs(y / mayor - Math.round(y / mayor)) < 1e-6;
    (esM ? (s) => (may += s) : (s) => (menor += s))(`M0 ${sy}H${w}`);
  }
  return `<path class="rej-menor" d="${menor}"/><path class="rej-mayor" d="${may}"/>`;
}

function escala(v, h) {
  const opciones = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const m = opciones.find((s) => s * v.z >= 70) || 100;
  const px = m * v.z;
  const x = 18, y = h - 50;
  return `<g class="escala"><rect x="${x - 6}" y="${y - 18}" width="${px + 12 + 40}" height="30" rx="6"/>` +
    `<path d="M${x} ${y}h${px}M${x} ${y - 5}v10M${x + px} ${y - 5}v10M${x + px / 2} ${y - 3}v6"/>` +
    `<text x="${x + px + 8}" y="${y + 4}">${num(m).replace(/,00$/, '')} m</text></g>`;
}

function cota(v, A, B, lado, texto, cls = 'cota') {
  const a = aPantalla(v, A), b = aPantalla(v, B);
  const L = dist(a, b);
  if (L < 24) return '';
  const u = unit(sub(b, a)), n = mul(perp(u), lado * 22);
  const a2 = add(a, n), b2 = add(b, n);
  let ang = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang <= -90) ang += 180;
  const c = mul(add(a2, b2), 0.5);
  const t = mul(perp(u), lado * 4);
  return `<g class="${cls}"><path d="M${pt(add(a, mul(n, 0.3)))}L${pt(add(a2, mul(n, 0.15)))}M${pt(add(b, mul(n, 0.3)))}L${pt(add(b2, mul(n, 0.15)))}M${pt(a2)}L${pt(b2)}"/>` +
    `<path class="cota-tick" d="M${pt(add(a2, mul(add(u, perp(u)), -4)))}L${pt(add(a2, mul(add(u, perp(u)), 4)))}M${pt(add(b2, mul(add(u, perp(u)), -4)))}L${pt(add(b2, mul(add(u, perp(u)), 4)))}"/>` +
    `<text transform="translate(${pt(add(c, t))}) rotate(${f(ang)})" y="${lado > 0 ? 13 : -6}">${esc(texto)}</text></g>`;
}

export function pintarRejilla(g, est, w, h) {
  g.innerHTML = est.capas.rejilla ? rejilla(est.vista, w, h) : '';
}

export function pintarSobre(g, planta, est, info, w, h) {
  const v = est.vista;
  const out = [];

  // rótulos de salas
  if (est.capas.rotulos && v.z > 3) {
    const hayMuros = Object.keys(planta.muros).length > 0;
    out.push('<g class="rotulos">');
    for (const [id, e] of Object.entries(planta.espacios)) {
      const s = aPantalla(v, e);
      if (s.x < -100 || s.y < -40 || s.x > w + 100 || s.y > h + 40) continue;
      const sala = info.salas[id];
      const sel = est.sel?.tipo === 'espacio' && est.sel.id === id ? ' sel' : '';
      const sup = sala ? fmtM2(sala.util) : hayMuros ? 'sin cerrar' : '';
      out.push(`<g class="rotulo${sel}${sala ? '' : ' abierto'}" transform="translate(${f(s.x)} ${f(s.y)})">` +
        `<text class="r-nombre" y="${v.z > 9 && sup ? -2 : 4}">${esc(e.nombre)}</text>` +
        (v.z > 9 && sup ? `<text class="r-sup" y="12">${sup}</text>` : '') + '</g>');
    }
    out.push('</g>');
  }
  // notas
  for (const [id, n] of Object.entries(planta.elementos)) {
    if (n.tipo !== 'nota') continue;
    const s = aPantalla(v, n);
    const sel = est.sel?.tipo === 'nota' && est.sel.id === id ? ' sel' : '';
    out.push(`<g class="nota${sel}" transform="translate(${f(s.x)} ${f(s.y)})"><circle r="9"/><text y="4">!</text>` +
      (v.z > 6 ? `<text class="nota-t" x="14" y="4">${esc(n.texto)}</text>` : '') + '</g>');
  }

  // extremos sueltos: muros que no llegan a unirse con otro (impiden cerrar salas)
  if (est.capas.sueltos && !est.bloqueado && v.z > 4) {
    const grado = new Map();
    for (const m of Object.values(planta.muros)) for (const n of [m.a, m.b]) grado.set(n, (grado.get(n) || 0) + 1);
    let d = '';
    for (const [n, g] of grado) {
      if (g !== 1) continue;
      const s = aPantalla(v, planta.nodos[n]);
      if (s.x < -10 || s.y < -10 || s.x > w + 10 || s.y > h + 10) continue;
      d += `M${f(s.x - 5)} ${f(s.y)}a5 5 0 1 0 10 0a5 5 0 1 0 -10 0`;
    }
    if (d) out.push(`<path class="suelto" d="${d}"/>`);
  }

  // selección: cotas y tiradores
  const sel = est.sel;
  if (sel?.tipo === 'muro' && planta.muros[sel.id]) {
    const m = planta.muros[sel.id];
    const A = planta.nodos[m.a], B = planta.nodos[m.b];
    if (est.capas.cotas) out.push(cota(v, A, B, 1, fmtM(dist(A, B))));
    const u = unit(sub(aPantalla(v, B), aPantalla(v, A)));
    for (const [nid, N, letra, sg] of [[m.a, A, 'A', -1], [m.b, B, 'B', 1]]) {
      const s = aPantalla(v, N);
      const l = add(s, mul(u, sg * 16));
      out.push(`<circle class="tirador" data-nodo="${nid}" cx="${f(s.x)}" cy="${f(s.y)}" r="7"/>` +
        `<text class="letra-nodo" x="${f(l.x)}" y="${f(l.y + 3.5)}">${letra}</text>`);
    }
    // cotas de las aberturas
    if (est.capas.cotas) {
      const u = unit(sub(B, A));
      for (const o of m.aberturas) {
        const a = add(A, mul(u, o.pos - o.ancho / 2)), b = add(A, mul(u, o.pos + o.ancho / 2));
        out.push(cota(v, a, b, -1, num(o.ancho), 'cota cota-ab'));
      }
    }
  } else if (sel?.tipo === 'nodo' && planta.nodos[sel.id]) {
    const s = aPantalla(v, planta.nodos[sel.id]);
    out.push(`<circle class="tirador activo" cx="${f(s.x)}" cy="${f(s.y)}" r="8"/>`);
  } else if (sel?.tipo === 'abertura' && est.capas.cotas) {
    for (const m of Object.values(planta.muros)) {
      const o = m.aberturas.find((x) => x.id === sel.id);
      if (!o) continue;
      const A = planta.nodos[m.a], B = planta.nodos[m.b];
      const u = unit(sub(B, A));
      const a = add(A, mul(u, o.pos - o.ancho / 2)), b = add(A, mul(u, o.pos + o.ancho / 2));
      out.push(cota(v, A, a, 1, fmtM(o.pos - o.ancho / 2)));
      out.push(cota(v, a, b, 1, fmtM(o.ancho), 'cota cota-ab'));
      out.push(cota(v, b, B, 1, fmtM(largo(planta, m) - o.pos - o.ancho / 2)));
    }
  }

  // herramienta en curso
  const t = est.temp || {};
  if (t.cadena?.length) {
    const ps = t.cadena.map((p) => aPantalla(v, p));
    if (t.cursor) ps.push(aPantalla(v, t.cursor));
    out.push(`<path class="dib-muro" d="M${ps.map(pt).join('L')}" stroke-width="${Math.max(2, (est.grosor || 0.1) * v.z)}"/>`);
    out.push(`<path class="dib-eje" d="M${ps.map(pt).join('L')}"/>`);
    if (t.cursor) {
      const A = t.cadena[t.cadena.length - 1];
      out.push(cota(v, A, t.cursor, 1, fmtM(dist(A, t.cursor)) + (t.tecleado ? `  ⟵ ${t.tecleado}` : ''), 'cota cota-viva'));
    }
  }
  if (t.medir?.A) {
    const B = t.medir.B || t.cursor;
    if (B) {
      const a = aPantalla(v, t.medir.A), b = aPantalla(v, B);
      out.push(`<path class="medida" d="M${pt(a)}L${pt(b)}"/><circle class="medida-p" cx="${f(a.x)}" cy="${f(a.y)}" r="4"/><circle class="medida-p" cx="${f(b.x)}" cy="${f(b.y)}" r="4"/>`);
      const c = mul(add(a, b), 0.5);
      const d = dist(t.medir.A, B);
      const dx = Math.abs(B.x - t.medir.A.x), dy = Math.abs(B.y - t.medir.A.y);
      out.push(`<g class="medida-t" transform="translate(${pt(c)})"><rect x="-58" y="-30" width="116" height="${dx > 0.01 && dy > 0.01 ? 40 : 24}" rx="6"/>` +
        `<text y="-13">${fmtM(d)}</text>` + (dx > 0.01 && dy > 0.01 ? `<text class="medida-xy" y="2">↔ ${num(dx)}  ↕ ${num(dy)}</text>` : '') + '</g>');
    }
  }
  if (t.guias) for (const gd of t.guias) {
    const a = aPantalla(v, gd.A), b = aPantalla(v, gd.B);
    out.push(`<path class="guia" d="M${pt(a)}L${pt(b)}"/>`);
  }
  if (t.snap) {
    const s = aPantalla(v, t.snap);
    const cls = 'snap snap-' + t.snap.tipo;
    out.push(t.snap.tipo === 'nodo' ? `<rect class="${cls}" x="${f(s.x - 6)}" y="${f(s.y - 6)}" width="12" height="12"/>`
      : t.snap.tipo === 'muro' ? `<path class="${cls}" d="M${f(s.x - 6)} ${f(s.y - 6)}L${f(s.x + 6)} ${f(s.y + 6)}M${f(s.x + 6)} ${f(s.y - 6)}L${f(s.x - 6)} ${f(s.y + 6)}"/>`
        : `<circle class="${cls}" cx="${f(s.x)}" cy="${f(s.y)}" r="4"/>`);
  }
  out.push(escala(v, h));
  g.innerHTML = out.join('');
}

export function aplicarVista(gMundo, v) {
  gMundo.setAttribute('transform', `matrix(${v.z} 0 0 ${v.z} ${v.x} ${v.y})`);
}

/** Caja que abarca la planta (modelo y calco). */
export function caja(planta) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const n of Object.values(planta.nodos)) ext(n);
  for (const e of Object.values(planta.espacios)) ext(e);
  if (!Number.isFinite(x0) && planta.calco?.capas?.arquitectura) {
    for (const t of planta.calco.capas.arquitectura) {
      const nums = t.d.match(/-?\d+(\.\d+)?/g) || [];
      for (let i = 0; i + 1 < nums.length; i += 2) ext({ x: +nums[i], y: +nums[i + 1] });
    }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 20, y1: 15 };
  return { x0, y0, x1, y1 };
}

export { NS };
