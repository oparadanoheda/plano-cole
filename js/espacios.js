// Detección de salas: caras cerradas del grafo de muros.
// Las aberturas forman parte del muro, así que una sala se cierra aunque tenga puertas.

import { area, dentro, dist, sub, unit, cross } from './geo.js';

/** Caras interiores del grafo de muros de la planta. */
export function caras(p) {
  const ady = new Map();
  const pon = (n, e) => { if (!ady.has(n)) ady.set(n, []); ady.get(n).push(e); };
  for (const [mid, m] of Object.entries(p.muros)) {
    const A = p.nodos[m.a], B = p.nodos[m.b];
    if (!A || !B) continue;
    pon(m.a, { de: m.a, a: m.b, mid, ang: Math.atan2(B.y - A.y, B.x - A.x) });
    pon(m.b, { de: m.b, a: m.a, mid, ang: Math.atan2(A.y - B.y, A.x - B.x) });
  }
  for (const l of ady.values()) l.sort((x, y) => x.ang - y.ang);

  const visto = new Set();
  const clave = (e) => e.de + '>' + e.a + '|' + e.mid;
  const res = [];
  const exteriores = [];
  for (const lista of ady.values()) {
    for (const ini of lista) {
      if (visto.has(clave(ini))) continue;
      const nodos = [], muros = [];
      let e = ini, pasos = 0;
      do {
        visto.add(clave(e));
        nodos.push(e.de);
        muros.push(e.mid);
        const sal = ady.get(e.a);
        const i = sal.findIndex((x) => x.a === e.de && x.mid === e.mid);
        e = sal[(i - 1 + sal.length) % sal.length];
      } while (clave(e) !== clave(ini) && ++pasos < 5000);
      const pts = nodos.map((n) => p.nodos[n]);
      const A = area(pts);
      if (A > 1e-4) res.push({ nodos, muros, pts, area: A });
      else if (A < -1) exteriores.push({ nodos, muros, pts, area: -A });
    }
  }
  res.exteriores = exteriores; // contornos exteriores de cada grupo de muros (huella del edificio)
  return res;
}

/** Superficie útil aproximada: área por ejes menos la mitad del grosor de cada muro. */
function superficieUtil(p, cara) {
  let s = cara.area;
  const n = cara.nodos.length;
  for (let i = 0; i < n; i++) {
    const m = p.muros[cara.muros[i]];
    const P = p.nodos[cara.nodos[i]], Q = p.nodos[cara.nodos[(i + 1) % n]];
    s -= (dist(P, Q) * m.grosor) / 2;
    const m2 = p.muros[cara.muros[(i + 1) % n]];
    const R = p.nodos[cara.nodos[(i + 2) % n]];
    const c = cross(unit(sub(Q, P)), unit(sub(R, Q)));
    if (Math.abs(c) > 0.2) s += (Math.sign(c) * m.grosor * m2.grosor) / 4;
  }
  return Math.max(s, 0);
}

/** Asigna a cada espacio su cara (la más pequeña que contiene su punto). */
export function salas(p) {
  const cs = caras(p);
  const r = {};
  for (const [id, e] of Object.entries(p.espacios)) {
    let mejor = null;
    for (const c of cs) if ((!mejor || c.area < mejor.area) && dentro(e, c.pts)) mejor = c;
    r[id] = mejor ? { cara: mejor, util: superficieUtil(p, mejor) } : null;
  }
  return { caras: cs, salas: r };
}

/** Cara que contiene un punto (para crear un espacio con un toque). */
export function caraEn(cs, pt) {
  let mejor = null;
  for (const c of cs) if ((!mejor || c.area < mejor.area) && dentro(pt, c.pts)) mejor = c;
  return mejor;
}

// ---------------------------------------------------------------------------
// Huella de cada planta (para los forjados del 3D)
// ---------------------------------------------------------------------------

const CELDA = 0.2;   // m
const CIERRE = 1.25; // m: se cierran los huecos entre muros de hasta 2,5 m
const PATIO = 0.6;   // un recinto encerrado y sin salas, con más de esto de su borde en fachada…
const CALLE = 0.2;   // …y con menos de esto de su borde dando a la calle, es un patio de luces

/** Celdas de la rejilla a menos de r de cada muro (r = medio grosor + «extra»). */
function rasterMuros(p, R, extra, valor) {
  const { x0, y0, nx, ny } = R;
  const m = new Uint8Array(nx * ny);
  for (const mu of Object.values(p.muros)) {
    const A = p.nodos[mu.a], B = p.nodos[mu.b];
    if (!A || !B) continue;
    const r = Math.max(mu.grosor / 2 + extra, CELDA * 0.75);
    const i0 = Math.max(0, Math.floor((Math.min(A.x, B.x) - r - x0) / CELDA)), i1 = Math.min(nx - 1, Math.ceil((Math.max(A.x, B.x) + r - x0) / CELDA));
    const j0 = Math.max(0, Math.floor((Math.min(A.y, B.y) - r - y0) / CELDA)), j1 = Math.min(ny - 1, Math.ceil((Math.max(A.y, B.y) + r - y0) / CELDA));
    const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy || 1e-9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * CELDA, py = y0 + (j + 0.5) * CELDA;
      const t = Math.max(0, Math.min(1, ((px - A.x) * dx + (py - A.y) * dy) / L2));
      const ex = A.x + t * dx - px, ey = A.y + t * dy - py;
      if (ex * ex + ey * ey <= r * r) { const k = j * nx + i; m[k] = Math.max(m[k], valor(mu)); }
    }
  }
  return m;
}

/** De una planta: sus muros engordados (2 = de fachada) para cerrar los huecos, y lo que queda
 *  fuera de ellos (relleno desde el borde de la rejilla). */
function barreraYFuera(p, R) {
  const { nx, ny } = R, N = nx * ny;
  const cola = new Int32Array(N);
  const barrera = rasterMuros(p, R, CIERRE, (mu) => (mu.tipo === 'fachada' ? 2 : 1));
  const fuera = new Uint8Array(N);
  let a = 0, b = 0;
  const pon = (k) => { if (!fuera[k] && !barrera[k]) { fuera[k] = 1; cola[b++] = k; } };
  for (let i = 0; i < nx; i++) { pon(i); pon((ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) { pon(j * nx); pon(j * nx + nx - 1); }
  while (a < b) {
    const k = cola[a++], i = k % nx;
    if (i > 0) pon(k - 1); if (i < nx - 1) pon(k + 1); if (k >= nx) pon(k - nx); if (k < N - nx) pon(k + nx);
  }
  return { barrera, fuera };
}

/** De una planta: qué celdas son edificio y cuáles patio. «calle» es lo que queda fuera en todas
 *  las plantas del edificio (un pasillo que en una planta se sale por un hueco no es calle). */
function huellaDePlanta(p, R, { barrera, fuera }, calle) {
  const { x0, y0, nx, ny } = R, N = nx * ny;
  const cola = new Int32Array(N);
  let a = 0, b = 0;
  // recintos encerrados: patio si su borde es casi todo fachada, al otro lado de esas fachadas
  // hay edificio (no la calle: si no, es una nave o un vestíbulo) y no tiene dentro una sala cerrada.
  // El otro lado es el primer sitio libre en esa dirección, cruzando muros y pasillos estrechos.
  const daALaCalle = (k, v) => {
    const di = (v % nx) - (k % nx), paso = v - k;
    for (let w = v; ;) {
      const i = (w % nx) + di;
      w += paso;
      if (w < 0 || w >= N || i < 0 || i >= nx) return true;
      if (!barrera[w]) return calle[w] === 1;
    }
  };
  const info = salas(p);
  const conSala = new Set();
  for (const [id, s] of Object.entries(info.salas)) {
    if (!s) continue;
    const e = p.espacios[id];
    const i = Math.floor((e.x - x0) / CELDA), j = Math.floor((e.y - y0) / CELDA);
    if (i >= 0 && j >= 0 && i < nx && j < ny) conSala.add(j * nx + i);
  }
  const patio = new Uint8Array(N), visto = new Uint8Array(N);
  for (let k0 = 0; k0 < N; k0++) {
    if (barrera[k0] || fuera[k0] || visto[k0]) continue;
    a = 0; b = 0; cola[b++] = k0; visto[k0] = 1;
    let fachada = 0, otro = 0, calle = 0, sala = false;
    while (a < b) {
      const k = cola[a++], i = k % nx;
      if (conSala.has(k)) sala = true;
      for (const v of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k >= nx ? k - nx : -1, k < N - nx ? k + nx : -1]) {
        if (v < 0) continue;
        if (barrera[v]) {
          if (barrera[v] === 2) fachada++; else otro++;
          if (daALaCalle(k, v)) calle++;
          continue;
        }
        if (!visto[v] && !fuera[v]) { visto[v] = 1; cola[b++] = v; }
      }
    }
    const borde = fachada + otro || 1;
    if (!sala && fachada > PATIO * borde && calle < CALLE * borde && b * CELDA * CELDA > 1) for (let q = 0; q < b; q++) patio[cola[q]] = 1;
  }
  // la franja que los muros engordados quitaron se reparte entre fuera, patio y el interior, a
  // la vez y sin cruzar los muros de verdad: cada celda va con lo que tiene más cerca. Así las
  // esquinas quedan a escuadra y nada se cuela por un hueco del muro.
  const muro = rasterMuros(p, R, 0, () => 1);
  const de = new Uint8Array(N), d = new Uint8Array(N); // 1 fuera, 2 patio, 3 interior
  a = 0; b = 0;
  for (let k = 0; k < N; k++) {
    if (barrera[k]) continue;
    de[k] = fuera[k] ? 1 : patio[k] ? 2 : 3;
    cola[b++] = k;
  }
  const pasos = Math.ceil(CIERRE / CELDA) + 1;
  while (a < b) {
    const k = cola[a++];
    if (d[k] >= pasos) continue;
    const i = k % nx, j = (k / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const v = jj * nx + ii;
      if (de[v] || muro[v]) continue;
      de[v] = de[k]; d[v] = d[k] + 1; cola[b++] = v;
    }
  }
  const edificio = new Uint8Array(N), patioM = new Uint8Array(N);
  for (let k = 0; k < N; k++) { edificio[k] = de[k] === 1 || de[k] === 2 ? 0 : 1; patioM[k] = de[k] === 2 ? 1 : 0; }
  return { edificio, patio: patioM };
}

/** Quita lo que no llega a 3 celdas de ancho (un muro suelto que sobresale de la fachada). */
function quitarFinos(m, nx, ny) {
  const er = new Uint8Array(m.length), res = new Uint8Array(m.length);
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    let todo = 1;
    for (let dj = -1; dj <= 1 && todo; dj++) for (let di = -1; di <= 1; di++) if (!m[(j + dj) * nx + i + di]) { todo = 0; break; }
    er[j * nx + i] = todo;
  }
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    if (!er[j * nx + i]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) res[(j + dj) * nx + i + di] = 1;
  }
  return res;
}

/** Rectángulos que cubren las celdas marcadas: tiras por filas que se alargan mientras coinciden. */
function rectangulos(m, R) {
  const { x0, y0, nx, ny } = R;
  const res = [];
  let abiertos = new Map();
  for (let j = 0; j <= ny; j++) {
    const tiras = new Map();
    for (let i = 0; j < ny && i < nx;) {
      if (!m[j * nx + i]) { i++; continue; }
      const s = i;
      while (i < nx && m[j * nx + i]) i++;
      tiras.set(s + ',' + i, s);
    }
    const siguen = new Map();
    for (const [clave, r] of abiertos) {
      if (tiras.has(clave)) { siguen.set(clave, r); tiras.delete(clave); } else {
        res.push({ x: x0 + r.i0 * CELDA, y: y0 + r.j0 * CELDA, w: (r.i1 - r.i0) * CELDA, h: (j - r.j0) * CELDA });
      }
    }
    for (const [clave, s] of tiras) siguen.set(clave, { i0: s, i1: +clave.split(',')[1], j0: j });
    abiertos = siguen;
  }
  return res;
}

const cacheHuellas = new WeakMap();
const firma = (p) => {
  let s = Object.keys(p.muros).length + ':' + Object.keys(p.espacios).length + ':' + (p.nivel ?? 0);
  let h = 0;
  for (const n of Object.values(p.nodos)) h = (h * 31 + Math.round(n.x * 100) * 7 + Math.round(n.y * 100)) % 1e9;
  for (const m of Object.values(p.muros)) h = (h * 31 + Math.round(m.grosor * 1000) + (m.tipo === 'fachada' ? 17 : 0)) % 1e9;
  return s + ':' + h;
};

/** Huella de las plantas de un edificio para sus forjados: Map(planta → [rectángulos en metros]).
 *  Los muros no siempre cierran (falta algún tramo, o una cristalera no se importó como muro),
 *  así que se trabaja sobre una rejilla de 20 cm: los muros se engordan para cerrar los huecos,
 *  se rellena desde fuera, y lo que queda es el edificio; los recintos encerrados entre fachadas
 *  y sin salas son patios de luces. El forjado de una planta es su suelo y el techo de la de
 *  debajo, así que cubre las dos huellas (y un hueco en una lo tapa la otra), menos los patios
 *  de esa planta y de las de encima, que quedan abiertos. */
export function huellasEdificio(pls) {
  const res = new Map();
  // solo se juntan las plantas superpuestas (misma colocación)
  const grupos = new Map();
  for (const p of pls) {
    if (!Object.keys(p.muros).length) { res.set(p.id, []); continue; }
    const c = p.colocacion || {};
    const clave = [c.x || 0, c.y || 0, c.giro || 0].join(',');
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(p);
  }
  for (const grupo of grupos.values()) {
    const claveCache = grupo.map(firma).join('|');
    const guardado = cacheHuellas.get(grupo[0]);
    if (guardado?.clave === claveCache) { for (const [id, r] of guardado.res) res.set(id, r); continue; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of grupo) for (const n of Object.values(p.nodos)) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const margen = CIERRE + 4 * CELDA;
    const R = { x0: x0 - margen, y0: y0 - margen, nx: Math.ceil((x1 - x0 + 2 * margen) / CELDA), ny: Math.ceil((y1 - y0 + 2 * margen) / CELDA) };
    const N = R.nx * R.ny;
    const orden = [...grupo].sort((a, b) => a.nivel - b.nivel);
    const bases = orden.map((p) => barreraYFuera(p, R));
    const calle = new Uint8Array(N).fill(1);
    for (const x of bases) for (let k = 0; k < N; k++) calle[k] &= x.fuera[k];
    const por = orden.map((p, i) => ({ p, ...huellaDePlanta(p, R, bases[i], calle) }));
    const deGrupo = new Map();
    const patios = new Uint8Array(N); // patios de esta planta y de las de encima
    for (let i = por.length - 1; i >= 0; i--) {
      const x = por[i], abajo = por[i - 1];
      if (x.p.nivel >= 1) for (let k = 0; k < N; k++) patios[k] |= x.patio[k];
      const m = new Uint8Array(N);
      for (let k = 0; k < N; k++) m[k] = (x.edificio[k] || abajo?.edificio[k]) && !(x.p.nivel >= 1 && patios[k]) ? 1 : 0;
      deGrupo.set(x.p.id, rectangulos(quitarFinos(m, R.nx, R.ny), R));
    }
    cacheHuellas.set(grupo[0], { clave: claveCache, res: deGrupo });
    for (const [id, r] of deGrupo) res.set(id, r);
  }
  return res;
}
