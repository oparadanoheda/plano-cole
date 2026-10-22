// Utilidades geométricas. Todo en metros, eje y hacia abajo (como en pantalla).

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const unit = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const perp = (a) => ({ x: -a.y, y: a.x });
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Proyección de p sobre el segmento ab: t en metros desde a, d distancia con signo
 *  (positiva hacia la normal (-uy, ux)), q punto proyectado (sin recortar). */
export function proyectar(p, a, b) {
  const L = dist(a, b);
  if (L < 1e-9) return { t: 0, d: dist(p, a), q: a, L: 0, u: { x: 1, y: 0 } };
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const v = sub(p, a);
  const t = dot(v, u);
  const d = cross(u, v);
  return { t, d, q: add(a, mul(u, t)), L, u };
}

/** Distancia de p al segmento ab. */
export function distSegmento(p, a, b) {
  const r = proyectar(p, a, b);
  if (r.t <= 0) return dist(p, a);
  if (r.t >= r.L) return dist(p, b);
  return Math.abs(r.d);
}

/** Intersección de los segmentos ab y cd. Devuelve {x, y, t, u} (t y u en 0..1) o null. */
export function cruce(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const qp = sub(c, a);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t, t, u };
}

/** Intersección de dos rectas (punto + dirección). */
export function cruceRectas(p, u, q, v) {
  const den = cross(u, v);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q, p), v) / den;
  return add(p, mul(u, t));
}

/** Área con signo (positiva si el polígono va en sentido horario en pantalla). */
export function area(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function dentro(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export function centroide(pts) {
  const A = area(pts);
  if (Math.abs(A) < 1e-9) {
    const s = pts.reduce((m, p) => add(m, p), { x: 0, y: 0 });
    return mul(s, 1 / pts.length);
  }
  let cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** Polo de inaccesibilidad aproximado: un buen punto para poner el rótulo de una sala. */
export function puntoRotulo(pts) {
  const c = centroide(pts);
  if (dentro(c, pts)) return c;
  let xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let mejor = pts[0], md = -1;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const p = { x: x0 + ((x1 - x0) * i) / 12, y: y0 + ((y1 - y0) * j) / 12 };
    if (!dentro(p, pts)) continue;
    let d = Infinity;
    for (let k = 0; k < pts.length; k++) d = Math.min(d, distSegmento(p, pts[k], pts[(k + 1) % pts.length]));
    if (d > md) { md = d; mejor = p; }
  }
  return mejor;
}

export const redondear = (v, paso) => Math.round(v / paso) * paso;

const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtM = (v) => nf2.format(v) + ' m';
export const fmtM2 = (v) => nf1.format(v) + ' m²';
export const num = (v) => nf2.format(v);
/** Lee un número escrito a la española («6,40») o a la inglesa («6.40»). */
export const leerNum = (s) => {
  const v = parseFloat(String(s).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
