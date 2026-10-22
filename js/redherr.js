// Herramientas del modo Red: colocar equipos, tender cables (también de una planta a otra o por
// el exterior), mover equipos y puntos de un cable, y tocar para seleccionar.

import { dist, redondear } from './geo.js';
import { aMundo, aPantalla } from './vista.js';
import * as R from './red.js';
import { cableEn, objetivosRed, iconoEquipo } from './redvista.js';

export const HERR_RED = ['cable', 'armario', 'switch', 'router', 'ap', 'toma', 'equipo'];
const EN_ARMARIO = ['switch', 'router', 'panel'];
const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function crearHerrRed(app) {
  const est = app.est;
  const red = () => app.doc.red;
  const ip = () => R.indicePlantas(app.doc);

  // ------------------------------------------------------------------ qué hay bajo el puntero
  /** Qué hay en ese punto de la pantalla: tiradores del cable seleccionado, equipos, pasos de
   *  planta y cables (por este orden). */
  function tocar(s, { conTiradores = true } = {}) {
    const o = objetivosRed(app);
    if (conTiradores) {
      for (const q of o.vertices) if (dist(q.s, s) < 11) return { tipo: 'vertice', t: q.t, i: q.i };
      for (const q of o.medios) if (dist(q.s, s) < 10) return { tipo: 'medio', t: q.t, i: q.i };
    }
    let mejor = null, md = Infinity;
    for (const q of o.iconos) {
      const d = dist(q.s, s);
      if (d < q.r && d < md) { md = d; mejor = { tipo: 'equipo', id: q.id, ajeno: q.ajeno, pos: q.pos }; }
    }
    if (mejor) return mejor;
    for (const q of o.pasos) {
      if (Math.abs(q.s.x - s.x) < q.ancho / 2 + 3 && Math.abs(q.s.y - s.y) < 12) return { tipo: 'paso', pl: q.pl, ed: q.ed, q: q.q };
    }
    const c = cableEn(app, s, 7);
    return c ? { tipo: 'cable', id: c } : null;
  }

  const irAPaso = (t) => app.irAPlanta(t.ed, t.pl, t.ed !== est.edId, true);

  // ------------------------------------------------------------------ ¿cuál de los del armario?
  let eleccion = null;
  const cerrarEleccion = () => { eleccion?.remove(); eleccion = null; };
  document.addEventListener('pointerdown', (e) => { if (eleccion && !e.target.closest('.elegir')) cerrarEleccion(); }, true);

  /** Un cable va a un equipo, no al armario: si se toca un armario con varios equipos dentro,
   *  se pregunta cuál (con uno solo, ese; vacío, el propio armario). */
  function elegirEquipo(id, s, seguir) {
    const r = red();
    const e = r.equipos[id];
    const dentro = e?.tipo === 'armario' ? Object.keys(r.equipos).filter((x) => r.equipos[x].en === id).sort(R.porTipoYNombre(r)) : [];
    if (dentro.length <= 1) { seguir(dentro[0] || id); return; }
    cerrarEleccion();
    const caja = document.createElement('div');
    caja.className = 'elegir';
    caja.innerHTML = `<div class="elegir-tit">${esc(e.nombre)}: ¿cuál?</div>` + dentro.map((x) => {
      const q = r.equipos[x];
      const libres = q.puertos ? q.puertos - R.puertosDe(r, x).usados.size : 0;
      return `<button data-id="${x}"><svg class="eq-ic" viewBox="-12.5 -12.5 25 25" width="20" height="20">${iconoEquipo(q.tipo)}</svg>` +
        `<span>${esc(q.nombre)}</span><small>${esc(R.nombreTipo(q))}${q.puertos ? ` · ${libres} libres` : ''}</small></button>`;
    }).join('');
    const lienzo = document.getElementById('lienzo');
    lienzo.appendChild(caja);
    const sv = app.svg.getBoundingClientRect(), lz = lienzo.getBoundingClientRect();
    caja.style.left = Math.max(8, Math.min(s.x + sv.left - lz.left + 14, lz.width - caja.offsetWidth - 8)) + 'px';
    caja.style.top = Math.max(8, Math.min(s.y + sv.top - lz.top + 14, lz.height - caja.offsetHeight - 8)) + 'px';
    caja.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-id]');
      if (!b) return;
      cerrarEleccion();
      seguir(b.dataset.id);
    });
    eleccion = caja;
  }

  // ------------------------------------------------------------------ clic
  function clic(pul) {
    const t = pul.toque;
    const w = aMundo(est.vista, pul.s);
    const h = est.herr;
    if (h === 'cable') { clicCable(t, w, pul.s); return; }
    if (t?.tipo === 'paso') { irAPaso(t); return; }
    if (h === 'sel') {
      if (t?.tipo === 'vertice') { est.redVert = { t: t.t, i: t.i }; app.pintarSobre(); return; }
      if (t?.tipo === 'medio') return;
      app.seleccionar(t?.tipo === 'equipo' || t?.tipo === 'cable' ? { tipo: t.tipo, id: t.id } : null);
      return;
    }
    colocar(h, t, w);
  }

  /** Pone un equipo. Un switch, un router o un panel tocando un armario van dentro de él. */
  function colocar(tipo, t, w) {
    const r = red(), p = app.planta();
    if (t?.tipo === 'equipo') {
      const o = r.equipos[t.id];
      if (o?.tipo === 'armario' && EN_ARMARIO.includes(tipo)) {
        app.antesRed();
        const id = R.crearEquipo(r, tipo, { en: t.id });
        app.cambio();
        app.seleccionar({ tipo: 'equipo', id });
        app.aviso(`${r.equipos[id].nombre} va dentro de ${o.nombre}.`);
        return;
      }
      // encima de otro equipo no se pone uno nuevo: se selecciona el que hay
      app.seleccionar({ tipo: 'equipo', id: t.id });
      return;
    }
    app.antesRed();
    const id = R.crearEquipo(r, tipo, { pl: p.id, x: R.r3(redondear(w.x, 0.05)), y: R.r3(redondear(w.y, 0.05)) });
    app.cambio();
    app.seleccionar({ tipo: 'equipo', id });
  }

  // ------------------------------------------------------------------ tender un cable
  /** Último punto del cable que se está tendiendo, en metros de la planta de su último tramo. */
  function ultimo(tc) {
    const t = tc.tramos[tc.tramos.length - 1];
    if (t.pts.length) return { x: t.pts[t.pts.length - 2], y: t.pts[t.pts.length - 1] };
    const l = tc.a && R.lugar(red(), tc.a.eq);
    return l ? R.aPlanta(ip(), l, l.pl, t.pl) : null;
  }
  const puntos = (tc) => tc.tramos.reduce((n, t) => n + t.pts.length / 2, 0);

  /** Empieza un cable en un equipo; si es un armario, preguntando de cuál de los de dentro. */
  function cableDesde(id) {
    const o = objetivosRed(app).iconos.find((q) => q.id === (red().equipos[id]?.en || id));
    elegirEquipo(id, o ? o.s : { x: app.svg.clientWidth / 2, y: app.svg.clientHeight / 2 }, (x) => empezarDesde(x));
  }

  /** Empieza un cable en un equipo (por ejemplo, desde un puerto de su ficha). */
  function empezarDesde(eqId, pto = null) {
    const p = app.planta();
    est.temp = { cable: { a: { eq: eqId, pto }, tramos: [{ pl: p.id, pts: [] }] } };
    app.pintarOpciones();
    app.pintarSobre();
  }

  function clicCable(t, w, s) {
    const p = app.planta();
    const tc = est.temp.cable;
    if (!tc) {
      if (t?.tipo === 'paso') { irAPaso(t); return; }
      if (t?.tipo === 'equipo') { elegirEquipo(t.id, s, (id) => empezarDesde(id)); return; }
      const a = ajustarCable(w, null);
      est.temp = { cable: { a: null, tramos: [{ pl: p.id, pts: [R.r3(a.q.x), R.r3(a.q.y)] }] } };
      app.pintarOpciones();
      app.pintarSobre();
      return;
    }
    if (t?.tipo === 'equipo') {
      elegirEquipo(t.id, s, (id) => {
        const tc2 = est.temp.cable;
        if (!tc2 || (tc2.a?.eq === id && puntos(tc2) === 0)) return; // es el mismo del principio
        terminarCable(id);
      });
      return;
    }
    const tr = tc.tramos[tc.tramos.length - 1];
    if (t?.tipo === 'paso') {
      // por el mismo paso que otros cables: el punto va ahí y se sigue en la otra planta
      tr.pts.push(R.r3(t.q.x), R.r3(t.q.y));
      irAPaso(t);
      return;
    }
    const u = ultimo(tc);
    const a = ajustarCable(w, u);
    // tocar otra vez el último punto (o un doble toque) termina
    if (u && dist(aPantalla(est.vista, u), aPantalla(est.vista, a.q)) < 9) { terminarCable(null, true); return; }
    tr.pts.push(R.r3(a.q.x), R.r3(a.q.y));
    tc.cursor = null;
    app.pintarSobre();
  }

  /** Ajuste de un punto del cable: a un punto de otro cable de esta planta (para que vayan
   *  juntos), en horizontal/vertical desde el anterior, y a la rejilla de 5 cm. */
  function ajustarCable(w, desde, excluir = null) {
    const v = est.vista, p = app.planta();
    const s = aPantalla(v, w);
    let mejor = null, md = 9;
    for (const [cid, c] of Object.entries(red().cables)) {
      c.tramos.forEach((t, ti) => {
        if (t.pl !== p.id) return;
        for (let i = 0; i + 1 < t.pts.length; i += 2) {
          if (excluir && excluir.c === cid && excluir.t === ti && excluir.i === i / 2) continue;
          const q = { x: t.pts[i], y: t.pts[i + 1] };
          const d = dist(aPantalla(v, q), s);
          if (d < md) { md = d; mejor = q; }
        }
      });
    }
    if (mejor) return { q: mejor, tipo: 'nodo' };
    let q = { x: w.x, y: w.y };
    let eje = false;
    if (desde && est.redOp.orto) {
      const dx = q.x - desde.x, dy = q.y - desde.y;
      const ang = Math.atan2(dy, dx), paso = Math.PI / 4;
      const a2 = Math.round(ang / paso) * paso;
      const recto = Math.abs(Math.round(a2 / (Math.PI / 2)) * (Math.PI / 2) - a2) < 1e-6;
      if (recto || Math.abs(a2 - ang) < 0.09) {
        const d = Math.hypot(dx, dy);
        q = { x: desde.x + Math.cos(a2) * d, y: desde.y + Math.sin(a2) * d };
        eje = true;
      }
    }
    if (est.paso > 0) {
      if (eje) {
        const d = Math.hypot(q.x - desde.x, q.y - desde.y);
        const k = d > 0 ? redondear(d, est.paso) / d : 0;
        q = { x: desde.x + (q.x - desde.x) * k, y: desde.y + (q.y - desde.y) * k };
      } else q = { x: redondear(q.x, est.paso), y: redondear(q.y, est.paso) };
    }
    return { q, tipo: eje ? 'eje' : 'libre' };
  }

  /** Se ha cambiado de planta mientras se tendía un cable: sigue en la nueva por el mismo sitio. */
  function cambioDePlanta(de, a) {
    const tc = est.temp.cable;
    if (!tc || de === a) return;
    const indice = ip();
    const t = tc.tramos[tc.tramos.length - 1];
    if (t.pl !== de) return;
    tc.cursor = null;
    tc.snap = null;
    // aún sin puntos: sale del equipo directamente hacia la otra planta
    if (!t.pts.length) { t.pl = a; return; }
    if (tc.tramos.length > 1 && t.pts.length === 2) {
      // en esta planta no se ha dibujado nada: se deshace el paso por ella
      const prev = tc.tramos[tc.tramos.length - 2];
      if (prev.pl === a) { tc.tramos.pop(); return; }
      const q = R.aPlanta(indice, { x: t.pts[0], y: t.pts[1] }, de, a);
      t.pl = a;
      t.pts = [R.r3(q.x), R.r3(q.y)];
      return;
    }
    const q = R.aPlanta(indice, { x: t.pts[t.pts.length - 2], y: t.pts[t.pts.length - 1] }, de, a);
    tc.tramos.push({ pl: a, pts: [R.r3(q.x), R.r3(q.y)] });
  }

  /** Acaba el cable en un equipo, o (con «conOpcion») en el último punto, poniendo ahí una toma,
   *  un WiFi o un equipo si así está elegido en la barra de opciones. */
  function terminarCable(eqFin = null, conOpcion = false) {
    const tc = est.temp.cable;
    if (!tc) return false;
    const r = red();
    const tramos = tc.tramos.map((t) => ({ pl: t.pl, pts: t.pts.slice() }));
    let nuevo = null;
    if (!eqFin && conOpcion && est.redOp.fin !== 'libre') {
      const t = tramos[tramos.length - 1];
      if (t.pts.length >= 2 && (tc.a || puntos(tc) > 1)) {
        nuevo = { tipo: est.redOp.fin, pl: t.pl, x: t.pts[t.pts.length - 2], y: t.pts[t.pts.length - 1] };
        t.pts.length -= 2;
      }
    }
    const n = tramos.reduce((k, t) => k + t.pts.length / 2, 0);
    const extremos = (tc.a ? 1 : 0) + (eqFin || nuevo ? 1 : 0);
    est.temp = {};
    app.pintarOpciones();
    if (n + extremos < 2 || (tc.a && eqFin === tc.a.eq && n === 0)) { app.pintarSobre(); return true; }
    app.antesRed();
    const finId = nuevo ? R.crearEquipo(r, nuevo.tipo, { pl: nuevo.pl, x: nuevo.x, y: nuevo.y }) : eqFin;
    const a = tc.a ? { eq: tc.a.eq, pto: tc.a.pto ?? R.puertoLibre(r, tc.a.eq) } : null;
    const id = R.crearCable(r, { a, b: finId ? { eq: finId, pto: null } : null, tramos, tipo: est.redOp.tipo, estado: est.redOp.estado, canal: est.redOp.canal });
    const c = r.cables[id];
    if (c.b) c.b.pto = R.puertoLibre(r, finId);
    app.cambio();
    app.seleccionar({ tipo: 'cable', id });
    const L = R.longitud(R.contexto(app.doc), c);
    app.aviso(`${c.etiqueta}: ${R.textoExtremo(r, c.a)} → ${R.textoExtremo(r, c.b)} · unos ${nf.format(L.total)} m` +
      (L.largo ? ' (¡más de 90 m!)' : ''), L.largo ? 'error' : 'ok');
    return true;
  }

  /** Termina lo que se esté haciendo; con «cancelar», el cable a medias se descarta. */
  function terminar(cancelar = false) {
    if (!est.temp.cable) return false;
    if (!cancelar) return terminarCable(null, true);
    est.temp = {};
    app.pintarOpciones();
    app.pintarSobre();
    app.aviso('Cable descartado.');
    return true;
  }

  // ------------------------------------------------------------------ ratón sin pulsar
  function flotar(s) {
    const w = aMundo(est.vista, s);
    app.mostrarCursor(w);
    const tc = est.temp.cable;
    if (est.herr === 'cable' && tc) {
      const t = tocar(s, { conTiradores: false });
      if (t?.tipo === 'equipo') {
        tc.cursor = t.pos;
        tc.snap = t.pos;
      } else {
        const a = ajustarCable(w, ultimo(tc));
        tc.cursor = a.q;
        tc.snap = a.tipo === 'nodo' ? a.q : null;
      }
      app.pintarSobre();
      return;
    }
    const t = tocar(s, { conTiradores: est.herr === 'sel' });
    app.svg.dataset.sobre = !t ? '' : t.tipo === 'vertice' || t.tipo === 'medio' ? 'nodo' : t.tipo === 'equipo' && est.herr === 'sel' && !t.ajeno ? 'equipo' : t.tipo;
  }

  // ------------------------------------------------------------------ arrastres
  function extremoSuelto(c, ti, i) {
    if (!c.a && ti === 0 && i === 0) return 'a';
    if (!c.b && ti === c.tramos.length - 1 && i === c.tramos[ti].pts.length / 2 - 1) return 'b';
    return null;
  }

  /** Mueve un punto del cable; si es el paso a otra planta, también su pareja en la otra. */
  function moverVertice(c, ti, i, q, indice) {
    const t = c.tramos[ti];
    t.pts[i * 2] = R.r3(q.x);
    t.pts[i * 2 + 1] = R.r3(q.y);
    const n = t.pts.length / 2;
    if (i === n - 1 && ti + 1 < c.tramos.length && c.tramos[ti + 1].pts.length) {
      const s = c.tramos[ti + 1], q2 = R.aPlanta(indice, q, t.pl, s.pl);
      s.pts[0] = R.r3(q2.x); s.pts[1] = R.r3(q2.y);
    }
    if (i === 0 && ti > 0 && c.tramos[ti - 1].pts.length) {
      const s = c.tramos[ti - 1], q2 = R.aPlanta(indice, q, t.pl, s.pl);
      s.pts[s.pts.length - 2] = R.r3(q2.x); s.pts[s.pts.length - 1] = R.r3(q2.y);
    }
  }

  function arrastre(pul) {
    const t = pul.toque;
    if (est.herr !== 'sel' || !t) return null;
    const r = red();
    const g = { tipo: 'arrastre', cambiado: false };
    if ((t.tipo === 'vertice' || t.tipo === 'medio') && est.sel?.tipo === 'cable') {
      const cid = est.sel.id, c = r.cables[cid];
      if (!c?.tramos[t.t]) return null;
      const ti = t.t, i = t.i;
      const indice = ip();
      let fin = null, ultimaS = pul.s;
      est.arrastrando = true;
      g.mover = (s) => {
        ultimaS = s;
        if (!g.cambiado) {
          app.antesRed();
          g.cambiado = true;
          if (t.tipo === 'medio') c.tramos[ti].pts.splice(i * 2, 0, 0, 0);
        }
        // un extremo suelto se puede soltar encima de un equipo para conectarlo
        fin = null;
        let sobre = null;
        if (extremoSuelto(c, ti, i)) {
          sobre = tocar(s, { conTiradores: false });
          if (sobre?.tipo === 'equipo') fin = sobre.id;
        }
        const q = fin ? sobre.pos : ajustarCable(aMundo(est.vista, s), null, { c: cid, t: ti, i }).q;
        moverVertice(c, ti, i, q, indice);
        est.redVert = { t: ti, i };
        app.cambio(true);
      };
      g.soltar = () => {
        const lado = extremoSuelto(c, ti, i);
        app.cambio();
        if (!fin || !lado) return;
        elegirEquipo(fin, ultimaS, (id) => {
          if (c[lado] || !r.cables[cid]) return;
          R.conectarExtremo(r, c, lado, id);
          est.redVert = null;
          app.cambio();
          app.aviso(`Conectado a ${r.equipos[id].nombre}${c[lado].pto ? ', puerto ' + c[lado].pto : ''}.`, 'ok');
        });
      };
      return g;
    }
    if (t.tipo === 'equipo') {
      const e = r.equipos[t.id];
      const yaSel = est.sel?.tipo === 'equipo' && est.sel.id === t.id;
      // en táctil solo se arrastra lo que ya estaba seleccionado (así no se mueve nada sin querer)
      if (!e || e.en || t.ajeno || (pul.tipoPuntero === 'touch' && !yaSel)) return null;
      app.seleccionar({ tipo: 'equipo', id: t.id });
      const w0 = aMundo(est.vista, pul.s), o0 = { x: e.x, y: e.y };
      est.arrastrando = true;
      g.mover = (s) => {
        if (!g.cambiado) { app.antesRed(); g.cambiado = true; }
        const w = aMundo(est.vista, s);
        e.x = R.r3(redondear(o0.x + w.x - w0.x, 0.05));
        e.y = R.r3(redondear(o0.y + w.y - w0.y, 0.05));
        app.cambio(true);
      };
      g.soltar = () => app.cambio();
      return g;
    }
    return null;
  }

  /** Quita el punto seleccionado del cable (no los pasos de planta ni el único de un extremo). */
  function quitarVertice() {
    const c = red().cables[est.sel?.id];
    const v = est.redVert;
    if (!c || !v || !c.tramos[v.t]) return false;
    const t = c.tramos[v.t];
    const n = t.pts.length / 2;
    if ((v.i === n - 1 && v.t + 1 < c.tramos.length) || (v.i === 0 && v.t > 0)) {
      app.aviso('Ese punto es el paso a otra planta: se puede mover, pero no quitar.');
      return true;
    }
    if (extremoSuelto(c, v.t, v.i) && puntosDe(c) <= 1) { app.aviso('Es el único punto de ese extremo.'); return true; }
    app.antesRed();
    t.pts.splice(v.i * 2, 2);
    est.redVert = null;
    app.cambio();
    return true;
  }
  const puntosDe = (c) => c.tramos.reduce((k, t) => k + t.pts.length / 2, 0);

  return { tocar, clic, flotar, arrastre, terminar, cambioDePlanta, empezarDesde, cableDesde, quitarVertice };
}
