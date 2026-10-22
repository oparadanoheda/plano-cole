// Interacción con el plano: zoom, desplazamiento, selección, arrastres y herramientas de dibujo.
// Funciona igual con ratón, con el dedo y con el Apple Pencil (Pointer Events).

import { dist, sub, add, mul, unit, proyectar, distSegmento, redondear, leerNum } from './geo.js';
import { aMundo, aPantalla } from './vista.js';
import * as M from './modelo.js';
import { caraEn } from './espacios.js';

const UMBRAL_ARRASTRE = 5; // px

export function instalarInteraccion(app) {
  const svg = app.svg;
  const punteros = new Map();
  let gesto = null;     // {tipo: 'pellizco'|'pan'|'arrastre', ...}
  let pulsado = null;   // pointerdown pendiente de saber si es clic o arrastre
  let espacioPulsado = false;

  const est = app.est;
  const rect = () => svg.getBoundingClientRect();
  const local = (e) => { const r = rect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const tolM = (px) => px / est.vista.z;

  // ------------------------------------------------------------------ zoom y desplazamiento
  function zoomEn(s, factor) {
    const v = est.vista;
    const z = Math.min(Math.max(v.z * factor, 0.5), 600);
    const w = aMundo(v, s);
    v.z = z;
    v.x = s.x - w.x * z;
    v.y = s.y - w.y * z;
    app.pintarVista();
  }
  app.zoomEn = zoomEn;

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey) {
      est.vista.x -= e.deltaY || e.deltaX;
      app.pintarVista();
      return;
    }
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomEn(local(e), Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  // ------------------------------------------------------------------ ajuste (snap)
  /** Ajusta un punto: a nodos, a muros, a la ortogonal desde «desde» y a la rejilla. */
  function ajustar(pw, { desde = null, excluirNodo = null, conMuros = true } = {}) {
    const p = app.planta();
    const tol = tolM(11);
    const guias = [];
    const n = M.nodoCerca(p, pw, tol, excluirNodo);
    if (n) return { ...p.nodos[n], tipo: 'nodo', nodo: n, guias };
    let q = { ...pw };
    let tipo = 'libre';
    if (desde && est.orto) {
      const d = sub(q, desde);
      const ang = Math.atan2(d.y, d.x);
      const paso = Math.PI / 4;
      const a2 = Math.round(ang / paso) * paso;
      const r = Math.hypot(d.x, d.y);
      const esRecto = Math.abs(Math.round(a2 / (Math.PI / 2)) * (Math.PI / 2) - a2) < 1e-6;
      if (esRecto || Math.abs(a2 - ang) < 0.09) {
        q = add(desde, { x: Math.cos(a2) * r, y: Math.sin(a2) * r });
        tipo = 'eje';
      }
    }
    // alineación con otros nodos (guías)
    let ax = null, ay = null;
    for (const [id, N] of Object.entries(p.nodos)) {
      if (id === excluirNodo) continue;
      if (Math.abs(N.x - q.x) < tol * 0.7 && (ax === null || Math.abs(N.x - q.x) < Math.abs(ax.x - q.x))) ax = N;
      if (Math.abs(N.y - q.y) < tol * 0.7 && (ay === null || Math.abs(N.y - q.y) < Math.abs(ay.y - q.y))) ay = N;
    }
    const vertical = desde && tipo === 'eje' && Math.abs(q.x - desde.x) < 1e-6;
    const horizontal = desde && tipo === 'eje' && Math.abs(q.y - desde.y) < 1e-6;
    if (ax && !vertical) { q.x = ax.x; guias.push({ A: ax, B: { ...q } }); }
    if (ay && !horizontal) { q.y = ay.y; guias.push({ A: ay, B: { ...q } }); }
    if (conMuros) {
      const w = M.muroCerca(p, q, tol, excluirNodo ? M.murosDeNodo(p, excluirNodo) : []);
      if (w) {
        let qq = w.q;
        if (desde && tipo === 'eje') {
          // corta la dirección fijada con el eje del muro
          const m = p.muros[w.id];
          const [A, B] = M.extremos(p, m);
          const u = unit(sub(q, desde)), v = unit(sub(B, A));
          const den = u.x * v.y - u.y * v.x;
          if (Math.abs(den) > 1e-6) {
            const t = ((A.x - desde.x) * v.y - (A.y - desde.y) * v.x) / den;
            qq = add(desde, mul(u, t));
          }
        }
        return { ...qq, tipo: 'muro', muro: w.id, guias };
      }
    }
    if (!guias.length && est.paso > 0) {
      if (desde && tipo === 'eje') {
        // redondea la longitud, no las coordenadas
        const d = sub(q, desde), r = Math.hypot(d.x, d.y);
        if (r > 0) q = add(desde, mul(unit(d), redondear(r, est.paso)));
      } else {
        q = { x: redondear(q.x, est.paso), y: redondear(q.y, est.paso) };
      }
      tipo = tipo === 'eje' ? 'eje' : 'rejilla';
    }
    return { ...q, tipo: guias.length ? 'guia' : tipo, guias };
  }
  app.ajustar = ajustar;

  // ------------------------------------------------------------------ búsqueda bajo el puntero
  function tocar(s) {
    const p = app.planta();
    const v = est.vista;
    const w = aMundo(v, s);
    const sel = est.sel;
    // tiradores del muro seleccionado
    if (sel?.tipo === 'muro' && p.muros[sel.id]) {
      for (const nid of [p.muros[sel.id].a, p.muros[sel.id].b]) {
        if (dist(aPantalla(v, p.nodos[nid]), s) < 12) return { tipo: 'nodo', id: nid };
      }
    }
    for (const [id, n] of Object.entries(p.elementos)) {
      if (dist(aPantalla(v, n), s) < 12) return { tipo: 'nota', id };
    }
    if (est.capas.rotulos && v.z > 3) {
      for (const [id, e] of Object.entries(p.espacios)) {
        const r = aPantalla(v, e);
        const ancho = Math.max(30, e.nombre.length * 7.2) / 2;
        if (Math.abs(s.x - r.x) < ancho && s.y > r.y - 14 && s.y < r.y + (v.z > 9 ? 16 : 8)) return { tipo: 'espacio', id, rotulo: true };
      }
    }
    // aberturas y muros
    let mejor = null;
    for (const [mid, m] of Object.entries(p.muros)) {
      const [A, B] = M.extremos(p, m);
      const r = proyectar(w, A, B);
      if (r.t < -0.05 || r.t > r.L + 0.05) continue;
      const d = Math.abs(r.d);
      if (d > m.grosor / 2 + tolM(6)) continue;
      for (const o of m.aberturas) {
        if (r.t >= o.pos - o.ancho / 2 && r.t <= o.pos + o.ancho / 2) {
          if (!mejor || d < mejor.d) mejor = { tipo: 'abertura', id: o.id, mid, d };
        }
      }
      if (!mejor || (mejor.tipo === 'muro' && d < mejor.d)) mejor = { tipo: 'muro', id: mid, d, t: r.t };
    }
    // un extremo suelto de muro, si está muy cerca, gana al muro
    for (const [nid, N] of Object.entries(p.nodos)) {
      if (dist(aPantalla(v, N), s) < 8) return { tipo: 'nodo', id: nid };
    }
    if (mejor) return mejor;
    for (let i = 0; i < p.pilares.length; i++) {
      const pl = p.pilares[i];
      if (w.x >= pl.x && w.x <= pl.x + pl.an && w.y >= pl.y && w.y <= pl.y + pl.al) return { tipo: 'pilar', id: i };
    }
    for (const [id] of Object.entries(p.espacios)) {
      const s2 = app.info.salas[id];
      if (s2 && caraEn([s2.cara], w)) return { tipo: 'espacio', id };
    }
    return null;
  }
  app.tocar = tocar;

  // ------------------------------------------------------------------ eventos de puntero
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    punteros.set(e.pointerId, local(e));
    if (punteros.size === 2) {
      // pellizco: cancela cualquier arrastre en curso
      if (gesto?.tipo === 'arrastre' && gesto.cambiado) app.deshacer(true);
      pulsado = null;
      const [a, b] = [...punteros.values()];
      gesto = { tipo: 'pellizco', d: dist(a, b), c: mul(add(a, b), 0.5) };
      return;
    }
    if (punteros.size > 2) return;
    const s = local(e);
    if (e.button === 1 || espacioPulsado || (e.button === 2 && est.herr === 'sel')) {
      gesto = { tipo: 'pan', ult: s };
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      // botón derecho: termina la cadena de muros / la medida
      e.preventDefault();
      terminar();
      return;
    }
    pulsado = { s, t0: performance.now(), toque: tocar(s), tipoPuntero: e.pointerType };
  });

  svg.addEventListener('pointermove', (e) => {
    const s = local(e);
    if (punteros.has(e.pointerId)) punteros.set(e.pointerId, s);
    if (gesto?.tipo === 'pellizco' && punteros.size >= 2) {
      const [a, b] = [...punteros.values()];
      const d = dist(a, b), c = mul(add(a, b), 0.5);
      est.vista.x += c.x - gesto.c.x;
      est.vista.y += c.y - gesto.c.y;
      gesto.c = c;
      zoomEn(c, d / gesto.d);
      gesto.d = d;
      return;
    }
    if (gesto?.tipo === 'pan') {
      est.vista.x += s.x - gesto.ult.x;
      est.vista.y += s.y - gesto.ult.y;
      gesto.ult = s;
      app.pintarVista();
      return;
    }
    if (pulsado && dist(s, pulsado.s) > UMBRAL_ARRASTRE) {
      gesto = empezarArrastre(pulsado);
      pulsado = null;
    }
    if (gesto?.tipo === 'arrastre') {
      gesto.mover(s, e);
      return;
    }
    if (!punteros.size || e.pointerType === 'mouse') flotar(s);
  });

  const fin = (e) => {
    punteros.delete(e.pointerId);
    if (gesto?.tipo === 'pellizco') {
      if (punteros.size === 0) gesto = null;
      return;
    }
    if (gesto?.tipo === 'arrastre') gesto.soltar?.();
    else if (pulsado && e.type === 'pointerup') clic(pulsado, e);
    gesto = null;
    pulsado = null;
  };
  svg.addEventListener('pointerup', fin);
  svg.addEventListener('pointercancel', fin);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('dblclick', (e) => {
    if (est.herr === 'muro') { terminar(); return; }
    const t = tocar(local(e));
    if (t?.tipo === 'espacio' || t?.tipo === 'nota') app.enfocarPanel();
  });

  // ------------------------------------------------------------------ teclado
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'Space') { espacioPulsado = true; svg.classList.add('mano'); e.preventDefault(); return; }
    const t = est.temp;
    if (est.herr === 'muro' && t.cadena?.length && /^[\d.,]$/.test(e.key)) {
      t.tecleado = (t.tecleado || '') + e.key; app.pintarSobre(); return;
    }
    if (est.herr === 'muro' && t.tecleado && e.key === 'Backspace') {
      t.tecleado = t.tecleado.slice(0, -1); app.pintarSobre(); return;
    }
    if (est.herr === 'muro' && t.tecleado && e.key === 'Enter') { colocarTecleado(); return; }
    if (e.key === 'Escape') { if (!terminar()) app.seleccionar(null); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && est.sel) { app.borrarSeleccion(); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { app.deshacer(); e.preventDefault(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { app.rehacer(); e.preventDefault(); }
      else if (k === 's') { app.guardar(e.shiftKey); e.preventDefault(); }
      else if (k === 'o') { app.abrir(); e.preventDefault(); }
      else if (k === 'f') { app.enfocarBusqueda(); e.preventDefault(); }
      return;
    }
    const atajos = { v: 'sel', m: 'muro', p: 'puerta', w: 'ventana', h: 'paso', e: 'espacio', d: 'medir', c: 'pilar', n: 'nota' };
    if (atajos[e.key.toLowerCase()] && !e.altKey) { app.herramienta(atajos[e.key.toLowerCase()]); return; }
    if (e.key === 'f' || e.key === 'F') app.encuadrar();
    if (e.key === '+' || e.key === '=') zoomEn({ x: svg.clientWidth / 2, y: svg.clientHeight / 2 }, 1.25);
    if (e.key === '-') zoomEn({ x: svg.clientWidth / 2, y: svg.clientHeight / 2 }, 0.8);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { espacioPulsado = false; svg.classList.remove('mano'); }
  });

  // ------------------------------------------------------------------ flotar (ratón sin pulsar)
  function flotar(s) {
    const w = aMundo(est.vista, s);
    const t = est.temp;
    app.mostrarCursor(w);
    if (est.herr === 'muro' && !est.bloqueado) {
      const desde = t.cadena?.length ? t.cadena[t.cadena.length - 1] : null;
      const a = ajustar(w, { desde });
      t.cursor = desde ? a : null;
      t.snap = a.tipo === 'libre' ? null : a;
      t.guias = a.guias;
      app.pintarSobre();
    } else if (est.herr === 'medir') {
      const a = ajustar(w, { desde: t.medir?.A && !t.medir.B ? t.medir.A : null });
      t.cursor = a;
      t.snap = a.tipo === 'libre' ? null : a;
      t.guias = a.guias;
      app.pintarSobre();
    } else if (['puerta', 'ventana', 'paso'].includes(est.herr) && !est.bloqueado) {
      const m = M.muroCerca(app.planta(), w, tolM(10));
      t.snap = m ? { ...m.q, tipo: 'muro' } : null;
      app.pintarSobre();
    } else {
      const toque = tocar(s);
      svg.dataset.sobre = toque ? toque.tipo : '';
    }
  }

  // ------------------------------------------------------------------ clic
  function clic(pul, e) {
    const s = pul.s;
    const w = aMundo(est.vista, s);
    const p = app.planta();
    const herr = est.bloqueado && est.herr !== 'medir' ? 'sel' : est.herr;
    const t = est.temp;

    if (herr === 'sel') {
      app.seleccionar(pul.toque ? { tipo: pul.toque.tipo, id: pul.toque.id } : null);
      return;
    }
    if (herr === 'muro') {
      const desde = t.cadena?.length ? t.cadena[t.cadena.length - 1] : null;
      const a = ajustar(w, { desde });
      if (!desde) { t.cadena = [a]; t.inicio = a; app.pintarSobre(); return; }
      if (dist(a, desde) < 0.02) { terminar(); return; }
      ponerMuro(desde, a);
      const cerrado = t.inicio && dist(a, t.inicio) < 1e-6;
      if (cerrado) { terminar(); return; }
      t.cadena = [a];
      t.tecleado = '';
      app.pintarSobre();
      return;
    }
    if (['puerta', 'ventana', 'paso'].includes(herr)) {
      const m = M.muroCerca(p, w, tolM(12));
      if (!m) { app.aviso('Toca sobre un muro para poner la ' + (herr === 'ventana' ? 'ventana' : herr === 'paso' ? 'abertura' : 'puerta') + '.'); return; }
      const muro = p.muros[m.id];
      const L = M.largo(p, muro);
      const ancho = Math.min(M.ANCHOS[herr], L);
      const pos = Math.min(Math.max(m.t, ancho / 2), L - ancho / 2);
      if (muro.aberturas.some((o) => Math.abs(o.pos - pos) < (o.ancho + ancho) / 2 - 0.01)) {
        app.aviso('Ya hay una abertura en ese punto del muro.');
        return;
      }
      app.antes();
      const o = M.anadirAbertura(p, m.id, herr, m.t);
      if (o.lado && m.d < 0) o.lado = -1; // abre hacia el lado donde se tocó
      app.cambio();
      app.seleccionar({ tipo: 'abertura', id: o.id });
      return;
    }
    if (herr === 'espacio') {
      const toque = tocar(s);
      if (toque?.tipo === 'espacio') { app.seleccionar({ tipo: 'espacio', id: toque.id }); app.enfocarPanel(); return; }
      const cara = caraEn(app.info.caras, w);
      app.antes();
      const id = M.nuevoId('e');
      p.espacios[id] = { nombre: 'Nuevo espacio', x: w.x, y: w.y, uso: 'aula' };
      app.cambio();
      app.seleccionar({ tipo: 'espacio', id });
      app.enfocarPanel();
      if (!cara) app.aviso('El espacio no está cerrado por muros: no se puede calcular su superficie.');
      return;
    }
    if (herr === 'medir') {
      const a = ajustar(w, { desde: t.medir?.A && !t.medir.B ? t.medir.A : null });
      if (!t.medir || t.medir.B) t.medir = { A: a };
      else t.medir.B = a;
      app.pintarSobre();
      return;
    }
    if (herr === 'pilar') {
      const a = ajustar(w, { conMuros: false });
      app.antes();
      p.pilares.push({ x: a.x - 0.2, y: a.y - 0.2, an: 0.4, al: 0.4 });
      app.cambio();
      app.seleccionar({ tipo: 'pilar', id: p.pilares.length - 1 });
      return;
    }
    if (herr === 'nota') {
      app.antes();
      const id = M.nuevoId('x');
      p.elementos[id] = { tipo: 'nota', x: w.x, y: w.y, texto: 'Nota' };
      app.cambio();
      app.seleccionar({ tipo: 'nota', id });
      app.enfocarPanel();
    }
  }

  /** Crea un muro entre dos puntos ajustados (nodos, puntos sobre muro o libres). */
  function ponerMuro(A, B) {
    const p = app.planta();
    app.antes();
    const tol = 0.005;
    const a = A.nodo && p.nodos[A.nodo] ? A.nodo : M.nodoEn(p, A, tol);
    const b = B.nodo && p.nodos[B.nodo] ? B.nodo : M.nodoEn(p, B, tol);
    if (a === b) return;
    M.insertarMuro(p, a, b, { grosor: est.grosor, tipo: est.tipoMuro, estado: est.estadoNuevo });
    app.cambio();
  }

  function colocarTecleado() {
    const t = est.temp;
    const L = leerNum(t.tecleado);
    t.tecleado = '';
    if (!L || L <= 0 || !t.cadena?.length) { app.pintarSobre(); return; }
    const desde = t.cadena[t.cadena.length - 1];
    const hacia = t.cursor && dist(t.cursor, desde) > 1e-6 ? t.cursor : { x: desde.x + 1, y: desde.y };
    const B = add(desde, mul(unit(sub(hacia, desde)), L));
    const n = M.nodoCerca(app.planta(), B, 0.005);
    const Bn = n ? { ...app.planta().nodos[n], nodo: n } : B;
    ponerMuro(desde, Bn);
    t.cadena = [Bn];
    app.pintarSobre();
  }

  /** Termina la acción en curso. Devuelve true si había algo que terminar. */
  function terminar() {
    const t = est.temp;
    const habia = !!(t.cadena?.length || t.medir);
    est.temp = {};
    app.pintarSobre();
    return habia;
  }
  app.terminar = terminar;

  // ------------------------------------------------------------------ arrastres
  function empezarArrastre(pul) {
    const toque = pul.toque;
    const p = app.planta();
    const editable = !est.bloqueado && est.herr === 'sel';
    const inicio = aMundo(est.vista, pul.s);
    if (!editable || !toque || toque.tipo === 'espacio' && !toque.rotulo) {
      return panDesde(pul.s);
    }
    // en táctil, solo se arrastra lo que ya estaba seleccionado (evita mover muros sin querer)
    const yaSel = est.sel && est.sel.tipo === toque.tipo && est.sel.id === toque.id;
    const seleccionDeMuro = est.sel?.tipo === 'muro' && toque.tipo === 'nodo';
    if (pul.tipoPuntero === 'touch' && !yaSel && !seleccionDeMuro) return panDesde(pul.s);

    let cambiado = false;
    const marcar = () => { if (!cambiado) { app.antes(); cambiado = true; g.cambiado = true; } };
    const g = { tipo: 'arrastre', cambiado: false };

    if (toque.tipo === 'nodo') {
      const nid = toque.id;
      const selPrevia = est.sel;
      g.mover = (s) => {
        marcar();
        const a = ajustar(aMundo(est.vista, s), { excluirNodo: nid });
        Object.assign(p.nodos[nid], { x: a.x, y: a.y });
        for (const mid of M.murosDeNodo(p, nid)) M.ajustarAberturas(p, mid);
        est.temp.snap = a.tipo === 'libre' ? null : a;
        est.temp.guias = a.guias;
        g.ultimo = a;
        app.cambio(true);
      };
      g.soltar = () => {
        const a = g.ultimo;
        if (a?.tipo === 'nodo' && a.nodo !== nid) M.fusionarNodos(p, a.nodo, nid);
        else if (a?.tipo === 'muro' && p.muros[a.muro]) {
          const m = p.muros[a.muro];
          const [A] = M.extremos(p, m);
          M.partirMuro(p, a.muro, dist(A, a), nid);
        }
        est.temp = {};
        app.cambio();
        app.seleccionar(selPrevia?.tipo === 'muro' && p.muros[selPrevia.id] ? selPrevia : null);
      };
      return g;
    }
    if (toque.tipo === 'muro') {
      const m = p.muros[toque.id];
      app.seleccionar({ tipo: 'muro', id: toque.id });
      const A0 = { ...p.nodos[m.a] }, B0 = { ...p.nodos[m.b] };
      const n = unit({ x: -(B0.y - A0.y), y: B0.x - A0.x });
      g.mover = (s) => {
        marcar();
        const w = aMundo(est.vista, s);
        let d = (w.x - inicio.x) * n.x + (w.y - inicio.y) * n.y;
        d = redondear(d, est.paso > 0 ? Math.min(est.paso, 0.01) : 0.001);
        Object.assign(p.nodos[m.a], add(A0, mul(n, d)));
        Object.assign(p.nodos[m.b], add(B0, mul(n, d)));
        for (const nid of [m.a, m.b]) for (const mid of M.murosDeNodo(p, nid)) M.ajustarAberturas(p, mid);
        app.estado(`Desplazado ${Math.abs(d).toFixed(2).replace('.', ',')} m`);
        app.cambio(true);
      };
      g.soltar = () => { app.estado(''); app.cambio(); };
      return g;
    }
    if (toque.tipo === 'abertura') {
      const r = M.buscarAbertura(p, toque.id);
      app.seleccionar({ tipo: 'abertura', id: toque.id });
      const [A, B] = M.extremos(p, r.m);
      const t0 = proyectar(inicio, A, B).t - r.o.pos;
      g.mover = (s) => {
        marcar();
        const t = proyectar(aMundo(est.vista, s), A, B).t - t0;
        const L = dist(A, B);
        r.o.pos = redondear(Math.min(Math.max(t, r.o.ancho / 2), L - r.o.ancho / 2), 0.01);
        app.cambio(true);
      };
      g.soltar = () => app.cambio();
      return g;
    }
    if (toque.tipo === 'espacio' || toque.tipo === 'nota') {
      const obj = toque.tipo === 'espacio' ? p.espacios[toque.id] : p.elementos[toque.id];
      app.seleccionar({ tipo: toque.tipo, id: toque.id });
      const o0 = { x: obj.x, y: obj.y };
      g.mover = (s) => {
        marcar();
        const w = aMundo(est.vista, s);
        obj.x = o0.x + w.x - inicio.x;
        obj.y = o0.y + w.y - inicio.y;
        app.cambio(true);
      };
      g.soltar = () => app.cambio();
      return g;
    }
    if (toque.tipo === 'pilar') {
      const pl = p.pilares[toque.id];
      app.seleccionar({ tipo: 'pilar', id: toque.id });
      const o0 = { x: pl.x, y: pl.y };
      g.mover = (s) => {
        marcar();
        const w = aMundo(est.vista, s);
        pl.x = redondear(o0.x + w.x - inicio.x, 0.01);
        pl.y = redondear(o0.y + w.y - inicio.y, 0.01);
        app.cambio(true);
      };
      g.soltar = () => app.cambio();
      return g;
    }
    return panDesde(pul.s);
  }

  function panDesde(s) {
    return { tipo: 'arrastre', mover: (s2) => {
      est.vista.x += s2.x - s.x;
      est.vista.y += s2.y - s.y;
      s = s2;
      app.pintarVista();
    } };
  }
}
