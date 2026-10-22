// Modo 3D: los muros se levantan con sus puertas y ventanas, las plantas se apilan y
// el suelo es la foto aérea. Usa Three.js (incluido en vendor/, funciona sin conexión).
// Se carga solo al entrar en el modo 3D.

import { salas } from './espacios.js';
import { geometriaMuro, indicePorNodo, COLOR_USO } from './vista.js';
import { aSitio } from './modelo.js';
import { mosaicoSitio } from './satelite.js';
import * as R from './red.js';

let T = null;
let Orbitar = null;

async function cargarThree() {
  if (T) return;
  T = await import('../vendor/three.module.min.js');
  Orbitar = (await import('../vendor/OrbitControls.js')).OrbitControls;
}

const COLOR_3D = {
  aula: '#cfdcf3', despacho: '#e2d6ef', aseo: '#cbe7df', almacen: '#e9e2d2', comedor: '#f6dcc0',
  deporte: '#d3e8c8', instalaciones: '#f2cfd1', paso: '#ebe9e3', otro: '#e3e1db',
};
const LOSA = 0.25;
const HUECO = { ventana: [0.9, 2.2], puerta: [0, 2.1], 'puerta-doble': [0, 2.1], paso: [0, 2.35] };

/** Acumula prismas (planta de 4 puntos, de y0 a y1) en un solo BufferGeometry. */
class Prismas {
  constructor() { this.pos = []; this.nor = []; }
  cara(a, b, c, d, n) {
    // dos triángulos a-b-c, a-c-d
    for (const p of [a, b, c, a, c, d]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); }
  }
  prisma(q, y0, y1) {
    // q: 4 puntos {x, y} en el sitio (y del plano -> z de Three)
    const ab = q.map((p) => [p.x, y0, p.y]);
    const ar = q.map((p) => [p.x, y1, p.y]);
    // orientación: que las normales salgan hacia fuera
    const s = (q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[1].y - q[0].y) * (q[2].x - q[0].x);
    const o = s > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
    const B = o.map((i) => ab[i]), A = o.map((i) => ar[i]);
    this.cara(A[0], A[3], A[2], A[1], [0, 1, 0]);
    this.cara(B[0], B[1], B[2], B[3], [0, -1, 0]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const dx = B[j][0] - B[i][0], dz = B[j][2] - B[i][2];
      const L = Math.hypot(dx, dz) || 1;
      this.cara(B[i], A[i], A[j], B[j], [dz / L, 0, -dx / L]);
    }
  }
  geometria() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.nor, 3));
    return g;
  }
}

export class Vista3D {
  constructor(app, contenedor) {
    this.app = app;
    this.cont = contenedor;
    this.op = { hasta: 99, separar: false, foto: true, nombres: true, red: true };
    this.activo = false;
    this.suelos = [];
    this.fotoCache = null;
  }

  async abrir() {
    await cargarThree();
    if (!this.renderer) this.iniciar();
    this.activo = true;
    this.redimensionar();
    await this.construir(true);
    this.bucle();
  }

  cerrar() {
    this.activo = false;
  }

  iniciar() {
    const r = this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = T.PCFSoftShadowMap;
    r.outputColorSpace = T.SRGBColorSpace;
    this.cont.appendChild(r.domElement);
    this.escena = new T.Scene();
    this.escena.background = new T.Color('#dfe6ec');
    this.camara = new T.PerspectiveCamera(40, 1, 0.5, 3000);
    this.controles = new Orbitar(this.camara, r.domElement);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    this.controles.maxPolarAngle = Math.PI * 0.495;
    this.controles.screenSpacePanning = true;
    this.escena.add(new T.HemisphereLight(0xffffff, 0xb8b2a2, 1.7));
    const sol = this.sol = new T.DirectionalLight(0xffffff, 2.3);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    sol.shadow.bias = -0.0004;
    this.escena.add(sol, sol.target);
    new ResizeObserver(() => this.redimensionar()).observe(this.cont);
    // tocar una sala la selecciona
    let ini = null;
    r.domElement.addEventListener('pointerdown', (e) => { ini = { x: e.clientX, y: e.clientY }; });
    r.domElement.addEventListener('pointerup', (e) => {
      if (!ini || Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 6) return;
      this.tocar(e);
    });
  }

  redimensionar() {
    if (!this.renderer) return;
    const w = this.cont.clientWidth, h = this.cont.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
  }

  bucle() {
    if (!this.activo) return;
    requestAnimationFrame(() => this.bucle());
    this.controles.update();
    this.renderer.render(this.escena, this.camara);
  }

  limpiar() {
    if (!this.grupo) return;
    this.grupo.traverse((o) => {
      o.geometry?.dispose();
      if (o.material && o.userData.propio) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    this.escena.remove(this.grupo);
    this.grupo = null;
  }

  material(color, extra = {}) {
    this.mats ||= new Map();
    const k = color + JSON.stringify(extra);
    if (!this.mats.has(k)) this.mats.set(k, new T.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra }));
    return this.mats.get(k);
  }

  /** Niveles presentes (para el selector «hasta»). */
  niveles() {
    const s = new Set();
    for (const ed of this.app.doc.edificios) if (!ed.exterior) for (const p of ed.plantas) s.add(p.nivel);
    return [...s].sort((a, b) => a - b);
  }

  async construir(encuadrar = false) {
    const app = this.app;
    this.limpiar();
    const grupo = this.grupo = new T.Group();
    this.escena.add(grupo);
    this.suelos = [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, yMax = 0;
    const ext = (p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.y); z1 = Math.max(z1, p.y); };
    const y0s = new Map(); // altura del suelo de cada planta dibujada (para la red)

    for (const ed of app.doc.edificios) {
      if (ed.exterior) continue;
      const pls = [...ed.plantas].sort((a, b) => a.nivel - b.nivel);
      // altura de cada planta: la baja en 0, las de arriba sobre la anterior
      let base = 0;
      const bases = new Map();
      const i0 = Math.max(0, pls.findIndex((p) => p.nivel >= 0));
      for (let i = i0; i < pls.length; i++) { bases.set(pls[i].id, base); base += pls[i].altura || 3.2; }
      base = 0;
      for (let i = i0 - 1; i >= 0; i--) { base -= pls[i].altura || 3.2; bases.set(pls[i].id, base); }

      for (const p of pls) {
        if (p.nivel > this.op.hasta) continue;
        const y0 = bases.get(p.id) + (this.op.separar ? Math.max(0, p.nivel) * 3.5 : 0);
        y0s.set(p.id, y0);
        const alto = (p.altura || 3.2) - LOSA;
        const S = (q) => aSitio(p, q);
        const info = salas(p);
        const muros = new Prismas(), vidrios = new Prismas(), pilares = new Prismas();
        const porNodo = indicePorNodo(p);
        for (const mid of Object.keys(p.muros)) {
          const G = geometriaMuro(p, mid, porNodo);
          const tramo = (a, b, d = G.h) => [G.P(a, -d), G.P(b, -d), G.P(b, d), G.P(a, d)].map(S);
          for (const [a, b] of G.libres) muros.prisma(tramo(a, b), y0, y0 + alto);
          for (const o of G.huecos) {
            const a = o.pos - o.ancho / 2, b = o.pos + o.ancho / 2;
            const [h0, h1] = HUECO[o.tipo] || [0, 2.1];
            if (h0 > 0) muros.prisma(tramo(a, b), y0, y0 + h0);
            if (h1 < alto) muros.prisma(tramo(a, b), y0 + h1, y0 + alto);
            if (o.tipo === 'ventana') vidrios.prisma(tramo(a, b, 0.015), y0 + h0, y0 + Math.min(h1, alto));
          }
          ext(S(G.A)); ext(S(G.B));
        }
        for (const pl of p.pilares) {
          pilares.prisma([{ x: pl.x, y: pl.y }, { x: pl.x + pl.an, y: pl.y }, { x: pl.x + pl.an, y: pl.y + pl.al }, { x: pl.x, y: pl.y + pl.al }].map(S), y0, y0 + alto);
        }
        const malla = (pr, mat) => {
          if (!pr.pos.length) return;
          const m = new T.Mesh(pr.geometria(), mat);
          m.castShadow = true;
          m.receiveShadow = true;
          grupo.add(m);
        };
        malla(muros, this.material('#f4f2ec'));
        malla(pilares, this.material('#d9d5cb'));
        if (vidrios.pos.length) {
          const m = new T.Mesh(vidrios.geometria(), this.material('#8fc0e8', { transparent: true, opacity: 0.4, roughness: 0.1 }));
          grupo.add(m);
        }

        // suelos: la huella del edificio y encima cada sala con el color de su uso
        const espDeCara = new Map();
        for (const [id, s] of Object.entries(info.salas)) if (s) espDeCara.set(s.cara, id);
        const plano = (pts, y, color, datos) => {
          const forma = new T.Shape(pts.map((q) => { const s = S(q); return new T.Vector2(s.x, -s.y); }));
          const g = new T.ShapeGeometry(forma);
          g.rotateX(-Math.PI / 2);
          g.translate(0, y, 0);
          const m = new T.Mesh(g, this.material(color));
          m.receiveShadow = true;
          if (datos) { m.userData = { ...datos }; this.suelos.push(m); }
          grupo.add(m);
          return m;
        };
        for (const c of info.caras.exteriores || []) plano(c.pts, y0 + 0.005, '#d6d2c6');
        for (const c of info.caras) {
          const esp = espDeCara.get(c);
          const uso = esp ? p.espacios[esp].uso : null;
          plano(c.pts, y0 + 0.02, uso ? COLOR_3D[uso] || COLOR_3D.otro : '#e9e6de', { edId: ed.id, plId: p.id, esp: esp || null });
        }
        // rótulos
        if (this.op.nombres) {
          for (const [id, e] of Object.entries(p.espacios)) {
            if (!info.salas[id]) continue;
            const s = S(e);
            const spr = this.rotulo(e.nombre, e.grupo);
            spr.position.set(s.x, y0 + 1.7, s.y);
            grupo.add(spr);
          }
        }
        // anotaciones a mano: líneas sobre el suelo
        const visibles = new Set(app.doc.capasAnotacion.filter((c) => c.visible).map((c) => c.id));
        for (const a of p.anotaciones || []) {
          if (!visibles.has(a.capa) || a.tipo === 'texto') continue;
          const paso = a.tipo === 'flecha' ? 2 : 3;
          const pts = [];
          for (let i = 0; i < a.puntos.length; i += paso) { const s = S({ x: a.puntos[i], y: a.puntos[i + 1] }); pts.push(new T.Vector3(s.x, y0 + 0.08, s.y)); }
          if (pts.length < 2) continue;
          const lm = new T.LineBasicMaterial({ color: a.color, transparent: a.herr === 'rotulador', opacity: a.herr === 'rotulador' ? 0.5 : 1 });
          const l = new T.Line(new T.BufferGeometry().setFromPoints(pts), lm);
          l.userData.propio = true;
          grupo.add(l);
        }
        yMax = Math.max(yMax, y0 + alto);
      }
    }
    if (this.op.red && app.doc.red) this.red3D(grupo, y0s);
    if (!Number.isFinite(x0)) { x0 = z0 = -10; x1 = z1 = 10; }
    this.caja = { x0, x1, z0, z1, yMax };

    // suelo: foto aérea o gris
    await this.suelo();

    // sol y sombras ajustados al conjunto
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, R = Math.max(x1 - x0, z1 - z0) * 0.75 + 10;
    this.sol.position.set(cx - R * 0.6, R * 1.2, cz + R * 0.9);
    this.sol.target.position.set(cx, 0, cz);
    Object.assign(this.sol.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: R * 4 });
    this.sol.shadow.camera.updateProjectionMatrix();
    if (encuadrar || !this.yaEncuadrado) { this.encuadrar(); this.yaEncuadrado = true; }
  }

  /** La red: cada cable, un tubo fino a la altura por la que va, con sus subidas entre plantas
   *  y sus bajadas a los equipos; cada equipo, una caja de su color. */
  red3D(grupo, y0s) {
    const red = this.app.doc.red;
    const ip = R.indicePlantas(this.app.doc);
    const porColor = new Map();
    const pr = (color) => { if (!porColor.has(color)) porColor.set(color, new Prismas()); return porColor.get(color); };
    // el «Exterior» no se levanta en 3D, pero sus cables van a ras de suelo
    const base = (pl) => (y0s.has(pl) ? y0s.get(pl) : ip.get(pl)?.ed.exterior ? 0 : null);
    const S = (pl, q) => aSitio(ip.get(pl).p, q);
    const G = 0.035; // medio grosor del tubo
    const tubo = (P, A, B, y) => {
      const L = Math.hypot(B.x - A.x, B.y - A.y);
      if (L < 1e-6) return;
      const n = { x: (-(B.y - A.y) / L) * G, y: ((B.x - A.x) / L) * G };
      P.prisma([{ x: A.x - n.x, y: A.y - n.y }, { x: B.x - n.x, y: B.y - n.y }, { x: B.x + n.x, y: B.y + n.y }, { x: A.x + n.x, y: A.y + n.y }], y - G, y + G);
    };
    const vertical = (P, A, ya, yb) => {
      if (Math.abs(ya - yb) < 0.01) return;
      P.prisma([{ x: A.x - G, y: A.y - G }, { x: A.x + G, y: A.y - G }, { x: A.x + G, y: A.y + G }, { x: A.x - G, y: A.y + G }],
        Math.min(ya, yb) - G, Math.max(ya, yb) + G);
    };
    for (const c of Object.values(red.cables)) {
      const rec = R.recorrido(red, ip, c);
      const P = pr(c.estado === 'averia' ? '#dc2626' : R.TIPOS_CABLE[c.tipo].color);
      const h = (pl) => base(pl) + R.alturaCanal(c.canal, ip.get(pl)?.p);
      for (const t of rec.tramos) {
        if (base(t.pl) == null) continue;
        for (let i = 1; i < t.pts.length; i++) tubo(P, S(t.pl, t.pts[i - 1]), S(t.pl, t.pts[i]), h(t.pl));
      }
      for (const k of rec.cambios) if (base(k.de) != null && base(k.a) != null) vertical(P, S(k.de, k.pDe), h(k.de), h(k.a));
      for (const [l, x] of [[rec.la, c.a], [rec.lb, c.b]]) {
        if (l && base(l.pl) != null) vertical(P, S(l.pl, l), h(l.pl), base(l.pl) + R.alturaEquipo(red, x.eq, ip.get(l.pl).p));
      }
    }
    // equipos: [ancho, fondo, alto] en metros
    const TAM = { armario: [0.6, 0.6, 0], router: [0.42, 0.3, 0.12], switch: [0.5, 0.32, 0.1], panel: [0.5, 0.2, 0.1], ap: [0.32, 0.32, 0.06], toma: [0.16, 0.16, 0.14], equipo: [0.45, 0.4, 0.4] };
    for (const [id, e] of Object.entries(red.equipos)) {
      if (e.en || base(e.pl) == null) continue;
      const A = S(e.pl, e);
      const [an, fo, al] = TAM[e.tipo];
      const q = [{ x: A.x - an / 2, y: A.y - fo / 2 }, { x: A.x + an / 2, y: A.y - fo / 2 }, { x: A.x + an / 2, y: A.y + fo / 2 }, { x: A.x - an / 2, y: A.y + fo / 2 }];
      const y = base(e.pl);
      const P = pr(R.TIPOS_EQUIPO[e.tipo].color);
      // un armario va del suelo a 1,9 m; los demás, centrados en su altura
      if (e.tipo === 'armario') P.prisma(q, y, y + (e.h != null ? e.h + 0.6 : 1.9));
      else { const hc = y + R.alturaEquipo(red, id, ip.get(e.pl).p); P.prisma(q, hc - al / 2, hc + al / 2); }
    }
    for (const [color, P] of porColor) {
      if (!P.pos.length) continue;
      const m = new T.Mesh(P.geometria(), this.material(color));
      m.castShadow = true;
      grupo.add(m);
    }
  }

  async suelo() {
    const app = this.app;
    const { x0, x1, z0, z1 } = this.caja;
    const m = 45;
    const caja = { x0: x0 - m, y0: z0 - m, x1: x1 + m, y1: z1 + m };
    let malla;
    if (this.op.foto && app.doc.sitio) {
      const clave = JSON.stringify([app.doc.sitio, caja.x0.toFixed(0), caja.y0.toFixed(0), caja.x1.toFixed(0), caja.y1.toFixed(0)]);
      if (this.fotoCache?.clave !== clave) {
        const mos = await mosaicoSitio(app.doc.sitio, caja, 19).catch(() => null);
        this.fotoCache = mos ? { clave, mos } : null;
      }
      if (this.fotoCache) {
        const { canvas, esquinas } = this.fotoCache.mos;
        const tex = new T.CanvasTexture(canvas);
        tex.colorSpace = T.SRGBColorSpace;
        tex.anisotropy = 8;
        const g = new T.BufferGeometry();
        const [a, b, c, d] = esquinas;
        g.setAttribute('position', new T.Float32BufferAttribute([a.x, -0.05, a.y, b.x, -0.05, b.y, c.x, -0.05, c.y, d.x, -0.05, d.y], 3));
        g.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
        g.setAttribute('normal', new T.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
        g.setIndex([0, 2, 1, 0, 3, 2]);
        malla = new T.Mesh(g, new T.MeshStandardMaterial({ map: tex, roughness: 1 }));
        malla.userData.propio = true;
      }
    }
    if (!malla) {
      const g = new T.PlaneGeometry(caja.x1 - caja.x0 + 200, caja.y1 - caja.y0 + 200);
      g.rotateX(-Math.PI / 2);
      g.translate((caja.x0 + caja.x1) / 2, -0.05, (caja.y0 + caja.y1) / 2);
      malla = new T.Mesh(g, this.material('#cfcbbd'));
    }
    malla.receiveShadow = true;
    this.grupo.add(malla);
  }

  rotulo(nombre, grupo) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const f1 = '600 46px system-ui, -apple-system, "Segoe UI", sans-serif', f2 = '500 36px system-ui, sans-serif';
    g.font = f1;
    const w = Math.max(g.measureText(nombre).width, grupo ? (g.font = f2, g.measureText(grupo).width) : 0) + 40;
    const h = grupo ? 120 : 76;
    c.width = Math.ceil(w); c.height = h;
    g.fillStyle = 'rgba(255,255,255,0.88)';
    g.beginPath();
    g.roundRect(0, 0, c.width, h, 22);
    g.fill();
    g.fillStyle = '#1d2330';
    g.font = f1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(nombre, c.width / 2, grupo ? 40 : h / 2 + 2);
    if (grupo) { g.font = f2; g.fillStyle = '#2457d6'; g.fillText(grupo, c.width / 2, 88); }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const mat = new T.SpriteMaterial({ map: tex, depthWrite: false });
    const s = new T.Sprite(mat);
    s.userData.propio = true;
    const alto = grupo ? 1.25 : 0.8;
    s.scale.set((alto * c.width) / h, alto, 1);
    s.renderOrder = 2;
    return s;
  }

  encuadrar(cenital = false) {
    const { x0, x1, z0, z1, yMax } = this.caja;
    const c = new T.Vector3((x0 + x1) / 2, yMax * 0.35, (z0 + z1) / 2);
    const R = Math.max(x1 - x0, z1 - z0, 20);
    this.controles.target.copy(c);
    if (cenital) this.camara.position.set(c.x, R * 1.9, c.z + 0.01);
    else this.camara.position.set(c.x + R * 0.7, R * 0.95, c.z + R * 1.25);
    this.camara.near = 0.5;
    this.camara.far = R * 30;
    this.camara.updateProjectionMatrix();
    this.controles.update();
  }

  tocar(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camara);
    const hit = ray.intersectObjects(this.suelos, false)[0];
    if (this.resaltado) { this.resaltado.material = this.resaltado.userData.matOriginal; this.resaltado = null; }
    if (!hit) { this.app.seleccionar(null); return; }
    const m = hit.object;
    m.userData.matOriginal = m.material;
    m.material = this.material('#ffd166', { emissive: '#7a5b00', emissiveIntensity: 0.25 });
    this.resaltado = m;
    const { edId, plId, esp } = m.userData;
    this.app.seleccionarDesde3D(edId, plId, esp);
  }

  captura() {
    return this.renderer?.domElement.toDataURL('image/png');
  }
}
