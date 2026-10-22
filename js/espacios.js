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
