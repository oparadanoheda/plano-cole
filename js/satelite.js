// Foto aérea bajo el plano: ortofoto PNOA del Instituto Geográfico Nacional (CC BY 4.0).
//
// La georreferencia está en el documento (doc.sitio): un punto del plano («ancla», en
// coordenadas del sitio) con su latitud y longitud, y el «rumbo», hacia dónde mira el
// «arriba» del plano en grados desde el norte. Cada planta tiene su «colocacion» en el sitio.

import { aMundo } from './vista.js';

export const ATRIBUCION = 'Ortofoto PNOA © Instituto Geográfico Nacional · CC BY 4.0';
const TAM = 256;
const ZMIN = 15, ZMAX = 20;
export const urlTesela = (z, x, y) => 'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&version=1.0.0' +
  `&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&format=image/jpeg&tilematrix=${z}&tilerow=${y}&tilecol=${x}`;

const RAD = Math.PI / 180;

export function lonLatAPixel(lat, lon, z) {
  const W = TAM * 2 ** z;
  const s = Math.sin(lat * RAD);
  return { x: ((lon + 180) / 360) * W, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * W };
}

export function pixelALonLat(px, py, z) {
  const W = TAM * 2 ** z;
  return { lon: (px / W) * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / W))) / RAD };
}

/** Metros por píxel de tesela a esa latitud y zoom. */
export const mpp = (lat, z) => (156543.03392 * Math.cos(lat * RAD)) / 2 ** z;

// Matrices afines [a, b, c, d, e, f] como en SVG: x' = a·x + c·y + e, y' = b·x + d·y + f
export const multiplicar = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export function invertir(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
export const aplicar = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** De píxeles de tesela (zoom z) a coordenadas del sitio. */
export function matrizSitio(sitio, z) {
  const { ancla, rumbo } = sitio;
  const P0 = lonLatAPixel(ancla.lat, ancla.lon, z);
  const m = mpp(ancla.lat, z);
  const c = Math.cos(rumbo * RAD), s = Math.sin(rumbo * RAD);
  const M = [c * m, -s * m, s * m, c * m, 0, 0];
  M[4] = ancla.x - (M[0] * P0.x + M[2] * P0.y);
  M[5] = ancla.y - (M[1] * P0.x + M[3] * P0.y);
  return M;
}

/** Del sitio a las coordenadas de una planta. */
export function matrizDeSitio(planta) {
  const c = planta.colocacion || { x: 0, y: 0, giro: 0 };
  const g = (c.giro || 0) * RAD;
  const R = [Math.cos(g), -Math.sin(g), Math.sin(g), Math.cos(g), 0, 0]; // giro inverso
  return multiplicar(R, [1, 0, 0, 1, -c.x, -c.y]);
}

/** De una planta al sitio. */
export function matrizASitio(planta) {
  const c = planta.colocacion || { x: 0, y: 0, giro: 0 };
  const g = (c.giro || 0) * RAD;
  return [Math.cos(g), Math.sin(g), -Math.sin(g), Math.cos(g), c.x, c.y];
}

/** De píxeles de tesela a coordenadas de la planta. */
export const matrizPlanta = (sitio, planta, z) => multiplicar(matrizDeSitio(planta), matrizSitio(sitio, z));

/** Capa SVG de teselas, por debajo del plano. */
export class CapaSatelite {
  constructor(g, app) {
    this.g = g;
    this.app = app;
    this.grupos = new Map(); // z -> {g, imgs: Map}
    this.zActual = null;
    this.limpieza = null;
  }

  vaciar() {
    this.g.innerHTML = '';
    this.grupos.clear();
    this.zActual = null;
  }

  pintar() {
    const { doc, est } = this.app;
    const p = this.app.planta();
    if (!doc?.sitio || !p || !est.capas.satelite || est.modo === '3d') { if (this.grupos.size) this.vaciar(); return; }
    this.g.setAttribute('opacity', est.capas.sateliteOpac ?? 1);
    const v = est.vista;
    const lat = doc.sitio.ancla.lat;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let z = Math.ceil(Math.log2(v.z * dpr * 156543.03392 * Math.cos(lat * RAD)) - 0.3);
    z = Math.min(Math.max(z, ZMIN), ZMAX);
    const w = this.app.svg.clientWidth, h = this.app.svg.clientHeight;
    let M, rango;
    for (;;) {
      M = matrizPlanta(doc.sitio, p, z);
      const Mi = invertir(M);
      const esq = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => aplicar(Mi, aMundo(v, { x, y })));
      const xs = esq.map((q) => q.x / TAM), ys = esq.map((q) => q.y / TAM);
      rango = { x0: Math.floor(Math.min(...xs)), x1: Math.floor(Math.max(...xs)), y0: Math.floor(Math.min(...ys)), y1: Math.floor(Math.max(...ys)) };
      if ((rango.x1 - rango.x0 + 1) * (rango.y1 - rango.y0 + 1) <= 90 || z <= ZMIN) break;
      z--;
    }
    let grupo = this.grupos.get(z);
    if (!grupo) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.g.appendChild(g);
      // origen local cerca del cole: con coordenadas de tesela absolutas (~10⁸) el SVG pierde precisión
      const P0 = lonLatAPixel(doc.sitio.ancla.lat, doc.sitio.ancla.lon, z);
      grupo = { g, imgs: new Map(), ox: Math.floor(P0.x / TAM) * TAM, oy: Math.floor(P0.y / TAM) * TAM };
      this.grupos.set(z, grupo);
    } else if (grupo.g !== this.g.lastChild) {
      this.g.appendChild(grupo.g); // el zoom actual siempre encima
    }
    grupo.g.setAttribute('transform', `matrix(${multiplicar(M, [1, 0, 0, 1, grupo.ox, grupo.oy]).join(' ')})`);
    const n = 2 ** z;
    const quedan = new Set();
    for (let x = rango.x0; x <= rango.x1; x++) {
      for (let y = rango.y0; y <= rango.y1; y++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const k = x + '/' + y;
        quedan.add(k);
        if (grupo.imgs.has(k)) continue;
        const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        img.setAttribute('x', x * TAM - grupo.ox);
        img.setAttribute('y', y * TAM - grupo.oy);
        img.setAttribute('width', TAM + 0.6); // solapa medio píxel: sin rayas entre teselas
        img.setAttribute('height', TAM + 0.6);
        img.setAttribute('preserveAspectRatio', 'none');
        img.setAttribute('href', urlTesela(z, x, y));
        grupo.g.appendChild(img);
        grupo.imgs.set(k, img);
      }
    }
    // las teselas que se salen de la vista se quedan (caché), salvo que haya demasiadas
    if (grupo.imgs.size > 260) {
      for (const [k, img] of grupo.imgs) if (!quedan.has(k)) { img.remove(); grupo.imgs.delete(k); }
    }
    if (z !== this.zActual) {
      this.zActual = z;
      clearTimeout(this.limpieza);
      // los otros zooms se quedan debajo un momento, mientras carga el nuevo
      this.limpieza = setTimeout(() => {
        for (const [zz, gr] of this.grupos) if (zz !== this.zActual) { gr.g.remove(); this.grupos.delete(zz); }
      }, 1800);
    }
  }
}

/** Mosaico de teselas para un rectángulo del sitio (para el suelo del 3D). Devuelve
 *  {canvas, esquinas: [sitio de (0,0), (W,0), (W,H), (0,H)]} o null si falla. */
export async function mosaicoSitio(sitio, caja, z = 19) {
  const M = matrizSitio(sitio, z);
  const Mi = invertir(M);
  const esq = [[caja.x0, caja.y0], [caja.x1, caja.y0], [caja.x0, caja.y1], [caja.x1, caja.y1]].map(([x, y]) => aplicar(Mi, { x, y }));
  const x0 = Math.floor(Math.min(...esq.map((q) => q.x)) / TAM), x1 = Math.floor(Math.max(...esq.map((q) => q.x)) / TAM);
  const y0 = Math.floor(Math.min(...esq.map((q) => q.y)) / TAM), y1 = Math.floor(Math.max(...esq.map((q) => q.y)) / TAM);
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  if (nx * ny > 144) return null;
  const canvas = document.createElement('canvas');
  canvas.width = nx * TAM;
  canvas.height = ny * TAM;
  const g = canvas.getContext('2d');
  g.fillStyle = '#c9c6bb';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const cargas = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    cargas.push(new Promise((ok) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const espera = setTimeout(() => ok(false), 8000); // sin red, no se queda esperando
      img.onload = () => { clearTimeout(espera); g.drawImage(img, (x - x0) * TAM, (y - y0) * TAM); ok(true); };
      img.onerror = () => { clearTimeout(espera); ok(false); };
      img.src = urlTesela(z, x, y);
    }));
  }
  const res = await Promise.all(cargas);
  if (!res.some(Boolean)) return null;
  const px = (i, j) => aplicar(M, { x: (x0 + i) * TAM, y: (y0 + j) * TAM });
  return { canvas, esquinas: [px(0, 0), px(nx, 0), px(nx, ny), px(0, ny)] };
}
