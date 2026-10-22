// Panel de la red: ficha de un equipo (con su mapa de puertos), de un cable (con su recorrido y
// su longitud), resumen de la planta, y la pestaña «Esquema» con el árbol de toda la red, lo que
// conviene revisar y los listados para Excel.

import * as R from './red.js';
import { iconoEquipo } from './redvista.js';
import { dist, leerNum, num } from './geo.js';
import { descargar } from './archivo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const m1 = (v) => nf1.format(v) + ' m';
const nombre = (v) => (typeof v === 'string' ? v : v.nombre);
const opciones = (obj, actual) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === actual ? ' selected' : ''}>${esc(nombre(v))}</option>`).join('');
const campo = (etq, html) => `<label class="campo"><span>${etq}</span>${html}</label>`;
const ico = (tipo, tam = 22) => `<svg class="eq-ic" viewBox="-12.5 -12.5 25 25" width="${tam}" height="${tam}" aria-hidden="true">${iconoEquipo(tipo)}</svg>`;
const colorCable = (c) => (c.estado === 'averia' ? '#dc2626' : R.TIPOS_CABLE[c.tipo].color);
const muestra = (c) => `<i class="muestra-cable${c.estado === 'proyecto' ? ' proyecto' : ''}" style="--c:${colorCable(c)}"></i>`;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const EN_ARMARIO = ['switch', 'router', 'panel'];

function nombrePlanta(ip, pl) {
  const r = ip.get(pl);
  return r ? `${r.ed.nombre} · ${r.p.nombre}` : '?';
}

export function panelRed(app, sel) {
  const ctx = R.contexto(app.doc);
  if (sel?.tipo === 'equipo' && ctx.red.equipos[sel.id]) return panelEquipo(app, ctx, sel.id);
  if (sel?.tipo === 'cable' && ctx.red.cables[sel.id]) return panelCable(app, ctx, sel.id);
  return panelPlantaRed(app, ctx);
}

// ---------------------------------------------------------------------------- equipo

function panelEquipo(app, ctx, id) {
  const { red } = ctx;
  const est = app.est;
  const e = red.equipos[id];
  const u = R.ubicacion(ctx, id);
  const armario = e.en ? red.equipos[e.en] : null;
  const donde = [armario && `dentro de ${armario.nombre}`, u.edificio, u.planta, u.sala].filter(Boolean).join(' · ');
  const armarios = Object.entries(red.equipos).filter(([, o]) => o.tipo === 'armario');
  const tipos = Object.fromEntries(Object.entries(R.TIPOS_EQUIPO).map(([k, v]) => [k, v.nombre]));
  let h = `
    <div class="p-cab">${ico(e.tipo, 26)}<h2>${esc(e.nombre)}</h2><span class="chip">${esc(R.nombreTipo(e))}</span></div>
    <p class="ubic">${esc(donde) || '—'}</p>
    ${campo('Nombre', `<input data-k="r-nombre" value="${esc(e.nombre)}">`)}
    ${campo('Tipo', `<select data-k="r-tipo">${opciones(tipos, e.tipo)}</select>`)}
    ${e.tipo === 'equipo' ? campo('Clase', `<select data-k="r-subtipo">${opciones(R.SUBTIPOS, e.subtipo || 'otro')}</select>`) : ''}
    ${campo('Marca y modelo', `<input data-k="r-modelo" value="${esc(e.modelo)}">`)}
    ${['router', 'switch', 'ap', 'equipo'].includes(e.tipo) ? campo('IP', `<input data-k="r-ip" value="${esc(e.ip)}" inputmode="decimal" spellcheck="false" autocomplete="off">`) : ''}
    ${e.tipo !== 'armario' ? campo(e.tipo === 'toma' ? 'Bocas' : 'Puertos', `<input data-k="r-puertos" value="${e.puertos}" inputmode="numeric">`) : ''}
    ${e.tipo === 'switch' ? `<div class="campo"><span>Tiene</span><div class="checks">
      <label class="interruptor"><input type="checkbox" data-k="r-gestionable" ${e.gestionable ? 'checked' : ''}> Gestión</label>
      <label class="interruptor"><input type="checkbox" data-k="r-poe" ${e.poe ? 'checked' : ''}> PoE</label></div></div>` : ''}
    ${e.tipo === 'ap' ? campo('Alcance', `<div class="con-ud"><input data-k="r-alcance" value="${num(e.alcance || 15)}" inputmode="decimal"><em>m</em></div>`) : ''}
    ${EN_ARMARIO.includes(e.tipo) && (armarios.length || e.en) ? campo('Armario', `<select data-k="r-en"><option value="">— ninguno —</option>${armarios.map(([aid, a]) => `<option value="${aid}"${e.en === aid ? ' selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select>`) : ''}
    ${!e.en ? campo('Altura', `<div class="con-ud"><input data-k="r-h" value="${e.h != null ? num(e.h) : ''}" placeholder="${num(R.alturaEquipo(red, id, u.p))}" inputmode="decimal"><em>m</em></div>`) : ''}
    ${campo('Notas', `<textarea data-k="r-notas">${esc(e.notas)}</textarea>`)}`;
  if (e.puertos > 0) h += mapaPuertos(app, ctx, id);
  h += conexiones(ctx, id);
  if (e.tipo === 'armario') h += contenidoArmario(ctx, id);

  // rastrear y dependientes
  const arb = R.arbol(red);
  const ver = est.redVer?.id === id ? est.redVer.modo : null;
  const raiz = (() => { let r = id; while (arb.padre.get(r)) r = arb.padre.get(r); return r; })();
  h += '<div class="botonera">';
  if (arb.padre.get(id)) h += `<button class="btn${ver === 'rastreo' ? ' activo' : ''}" data-acc="red-rastrear" data-id="${id}">Rastrear hasta ${esc(red.equipos[raiz].nombre)}</button>`;
  if (arb.hijos.get(id)?.length) h += `<button class="btn${ver === 'depende' ? ' activo' : ''}" data-acc="red-depende" data-id="${id}">Qué depende de ${esc(e.nombre)}</button>`;
  if (e.tipo !== 'armario') h += `<button class="btn solo-ed" data-acc="red-tender" data-id="${id}">Tender un cable desde aquí</button>`;
  h += '<button class="btn peligro solo-ed" data-acc="red-borrar">Borrar</button></div>';
  if (ver === 'rastreo') h += caminoHtml(ctx, arb, id);
  if (ver === 'depende') h += dependientesHtml(ctx, arb, id);
  h += '<p class="ayuda solo-ed">Arrastra el icono para moverlo; sus cables le siguen. Mejor no apuntar contraseñas: el archivo no va cifrado.</p>';
  return h;
}

/** Puertos como en el frontal: impares arriba y pares abajo, en bloques de 24. */
function mapaPuertos(app, ctx, id) {
  const { red } = ctx;
  const e = red.equipos[id];
  const n = e.puertos;
  const { usados, sinPuerto } = R.puertosDe(red, id);
  const selP = app.est.redPuerto;
  const boton = (k) => {
    const l = usados.get(k) || [];
    const c = l[0] && red.cables[l[0].cid];
    const cls = ['puerto', l.length && 'usado', l.length > 1 && 'conflicto', e.notasPuertos?.[k] && 'con-nota', selP === k && 'activo',
      c?.estado === 'proyecto' && 'proyecto'].filter(Boolean).join(' ');
    const titulo = l.length ? l.map(({ cid, lado }) => `${red.cables[cid].etiqueta} → ${R.textoExtremo(red, red.cables[cid][lado === 'a' ? 'b' : 'a'])}`).join(' / ') : 'Libre';
    return `<button class="${cls}" data-acc="red-puerto" data-pto="${k}"${c ? ` style="--c:${colorCable(c)}"` : ''} title="${esc(titulo)}">${k}</button>`;
  };
  let filas = '';
  if (n <= 8) filas = `<div class="puertos" style="--cols:${n}">${Array.from({ length: n }, (_, i) => boton(i + 1)).join('')}</div>`;
  else {
    for (let b = 0; b < n; b += 24) {
      const fin = Math.min(n, b + 24), cols = Math.ceil((fin - b) / 2);
      let arriba = '', abajo = '';
      for (let k = b + 1; k <= fin; k += 2) arriba += boton(k);
      for (let k = b + 2; k <= fin; k += 2) abajo += boton(k);
      filas += `<div class="puertos" style="--cols:${cols}">${arriba}${abajo}</div>`;
    }
  }
  const ocupados = [...usados.keys()].filter((k) => k <= n).length;
  let h = `<div class="p-sub">${e.tipo === 'toma' ? 'Bocas' : 'Puertos'} · ${ocupados} de ${n} ocupados</div>${filas}`;
  if (selP && selP <= n) {
    const l = usados.get(selP) || [];
    h += `<div class="puerto-det"><b>${e.tipo === 'toma' ? 'Boca' : 'Puerto'} ${selP}</b>${l.length ? '' : ' · libre'}`;
    for (const { cid, lado } of l) {
      const c = red.cables[cid];
      const otro = c[lado === 'a' ? 'b' : 'a'];
      h += `<div class="conex">${muestra(c)}<button class="enlace" data-acc="red-ir-cable" data-id="${cid}">${esc(c.etiqueta || 'cable')}</button> →
        ${otro ? `<button class="enlace" data-acc="red-ir-eq" data-id="${otro.eq}">${esc(red.equipos[otro.eq]?.nombre)}</button>${otro.pto ? ' · p' + otro.pto : ''}
        <small>${esc(R.textoUbicacion(ctx, otro.eq, false))}</small>` : '<small>extremo suelto</small>'}</div>`;
    }
    if (l.length > 1) h += `<p class="aviso-txt">Hay ${l.length} cables en este puerto: revisa cuál es el bueno.</p>`;
    h += campo('Nota', `<input data-k="r-nota-puerto" data-pto="${selP}" value="${esc(e.notasPuertos?.[selP])}">`);
    if (!l.length) h += `<div class="botonera solo-ed"><button class="btn" data-acc="red-tender" data-id="${id}" data-pto="${selP}">Tender un cable desde aquí</button></div>`;
    h += '</div>';
  } else h += '<p class="ayuda">Toca un puerto para ver adónde va.</p>';
  if (sinPuerto.length) h += `<p class="ayuda">${plural(sinPuerto.length, 'cable llega', 'cables llegan')} sin puerto apuntado.</p>`;
  return h;
}

function conexiones(ctx, id) {
  const { red } = ctx;
  const l = [];
  for (const [cid, c] of Object.entries(red.cables)) {
    for (const lado of ['a', 'b']) {
      if (c[lado]?.eq !== id) continue;
      const otro = c[lado === 'a' ? 'b' : 'a'];
      l.push({ cid, c, pto: c[lado].pto, otro });
    }
  }
  if (!l.length) return '<div class="p-sub">Conexiones</div><p class="ayuda">Sin cables.</p>';
  l.sort((x, y) => (x.pto ?? 999) - (y.pto ?? 999));
  const items = l.map(({ cid, c, pto, otro }) => `<li><button data-acc="red-ir-cable" data-id="${cid}">${muestra(c)}
    <span>${pto ? `<b>p${pto}</b> · ` : ''}${esc(c.etiqueta)} → ${esc(R.textoExtremo(red, otro))}</span>
    <small>${otro ? esc(R.ubicacion(ctx, otro.eq).sala) : ''} ${m1(R.longitud(ctx, c).total)}</small></button></li>`).join('');
  const lista = `<ul class="lista">${items}</ul>`;
  return `<div class="p-sub">Conexiones (${l.length})</div>` + (l.length > 8 ? `<details class="mas"><summary>Ver la lista</summary>${lista}</details>` : lista);
}

function contenidoArmario(ctx, id) {
  const { red } = ctx;
  const dentro = Object.keys(red.equipos).filter((o) => red.equipos[o].en === id).sort(R.porTipoYNombre(red));
  let h = `<div class="p-sub">Dentro del armario (${dentro.length})</div>`;
  h += dentro.length ? `<ul class="lista">${dentro.map((o) => {
    const q = red.equipos[o];
    return `<li><button data-acc="red-ir-eq" data-id="${o}">${ico(q.tipo, 18)}<span>${esc(q.nombre)}</span><small>${esc(R.nombreTipo(q))}${q.puertos ? ` · ${R.puertosDe(red, o).usados.size}/${q.puertos}` : ''}</small></button></li>`;
  }).join('')}</ul>` : '<p class="ayuda">Vacío.</p>';
  h += `<div class="botonera solo-ed"><button class="btn" data-acc="red-meter" data-tipo="switch" data-id="${id}">+ Switch</button>
    <button class="btn" data-acc="red-meter" data-tipo="panel" data-id="${id}">+ Panel de parcheo</button>
    <button class="btn" data-acc="red-meter" data-tipo="router" data-id="${id}">+ Router</button></div>`;
  return h;
}

function caminoHtml(ctx, arb, id) {
  const { red } = ctx;
  const cam = R.camino(arb, id);
  let h = `<div class="p-sub">Camino hasta ${esc(red.equipos[cam.equipos[cam.equipos.length - 1]].nombre)}</div><ol class="camino">`;
  cam.equipos.forEach((eid, k) => {
    const o = red.equipos[eid];
    h += `<li><button data-acc="red-ir-eq" data-id="${eid}">${ico(o.tipo, 18)}<b>${esc(o.nombre)}</b><small>${esc(R.textoUbicacion(ctx, eid))}</small></button>`;
    if (k < cam.cables.length) {
      const c = red.cables[cam.cables[k]];
      const de = c.a?.eq === eid ? c.a : c.b, a = c.a?.eq === eid ? c.b : c.a;
      h += `<div class="salto">${muestra(c)}<button class="enlace" data-acc="red-ir-cable" data-id="${cam.cables[k]}">${esc(c.etiqueta)}</button>
        <span>${de?.pto ? 'p' + de.pto : ''}${de?.pto || a?.pto ? ' → ' : ''}${a?.pto ? 'p' + a.pto : ''} · ${esc(R.TIPOS_CABLE[c.tipo].nombre)} · ${m1(R.longitud(ctx, c).total)}</span></div>`;
    }
    h += '</li>';
  });
  return h + '</ol>';
}

function dependientesHtml(ctx, arb, id) {
  const { red } = ctx;
  const d = R.descendientes(arb, id);
  const n = (t) => d.equipos.filter((x) => red.equipos[x].tipo === t).length;
  const partes = [[n('switch'), 'switch', 'switches'], [n('ap'), 'punto WiFi', 'puntos WiFi'], [n('toma'), 'toma', 'tomas'],
    [n('equipo'), 'equipo', 'equipos'], [n('panel') + n('router'), 'panel o router', 'paneles o routers']].filter(([k]) => k).map(([k, a, b]) => plural(k, a, b));
  const importantes = d.equipos.filter((x) => ['switch', 'ap', 'router'].includes(red.equipos[x].tipo)).sort(R.porTipoYNombre(red));
  return `<div class="p-sub">Si falla ${esc(red.equipos[id].nombre)}</div>
    <p class="ayuda" style="margin-top:0">Se quedan sin red: ${partes.join(', ') || 'nada'}.</p>
    ${importantes.length ? `<ul class="lista">${importantes.map((x) => `<li><button data-acc="red-ir-eq" data-id="${x}">${ico(red.equipos[x].tipo, 18)}<span>${esc(red.equipos[x].nombre)}</span><small>${esc(R.textoUbicacion(ctx, x, false))}</small></button></li>`).join('')}</ul>` : ''}`;
}

// ---------------------------------------------------------------------------- cable

function panelCable(app, ctx, id) {
  const { red, ip } = ctx;
  const c = red.cables[id];
  const L = R.longitud(ctx, c);
  const pls = R.plantasDe(red, ip, c);
  const extremo = (lado) => {
    const x = c[lado];
    const etq = `<small>${lado === 'a' ? 'Desde' : 'Hasta'}</small>`;
    if (!x) {
      return `<div class="extremo"><div class="ext-cab">${etq}<b class="suelto">Extremo suelto</b></div>
        <div class="ext-pie"><small class="solo-ed">Arrastra su punto rojo encima de un equipo para conectarlo.</small></div></div>`;
    }
    const o = red.equipos[x.eq];
    const ocupados = R.puertosDe(red, x.eq).usados;
    const ptos = o.puertos ? `<label class="pto">p <select data-k="r-pto-${lado}" aria-label="Puerto"><option value="">—</option>${Array.from({ length: o.puertos }, (_, i) => i + 1)
      .map((k) => `<option value="${k}"${x.pto === k ? ' selected' : ''}>${k}${k !== x.pto && ocupados.has(k) ? ' ·' : ''}</option>`).join('')}</select></label>` : '';
    return `<div class="extremo"><div class="ext-cab">${etq}<button class="enlace" data-acc="red-ir-eq" data-id="${x.eq}">${ico(o.tipo, 18)}${esc(o.nombre)}</button>${ptos}</div>
      <div class="ext-pie"><small>${esc(R.textoUbicacion(ctx, x.eq))}</small><button class="btn mini solo-ed" data-acc="red-soltar" data-lado="${lado}">Soltar</button></div></div>`;
  };
  return `
    <div class="p-cab"><i class="muestra-cable grande${c.estado === 'proyecto' ? ' proyecto' : ''}" style="--c:${colorCable(c)}"></i><h2>${esc(c.etiqueta || 'Cable')}</h2>
      <span class="chip estado-${c.estado}">${esc(R.ESTADOS_CABLE[c.estado])}</span></div>
    <div class="extremos">${extremo('a')}${extremo('b')}</div>
    <div class="largo-cable${L.largo ? ' mal' : ''}"><b>unos ${m1(L.total)}</b>
      <span>${m1(L.horizontal)} en horizontal + ${m1(L.vertical)} de subidas y bajadas + 10 % de holgura</span>
      ${L.largo ? '<p>En cobre, un enlace no debería pasar de 90 m (100 m con los latiguillos): hace falta un switch por el camino, o fibra.</p>' : ''}</div>
    ${pls.length > 1 ? `<div class="p-sub">Pasa por</div><div class="plantas-cable">${pls.map((pl) => `<button class="chip-pl${pl === app.est.plId ? ' activo' : ''}" data-acc="red-ir-pl" data-pl="${pl}">${esc(nombrePlanta(ip, pl))}</button>`).join('<span>›</span>')}</div>` : ''}
    ${campo('Etiqueta', `<input data-k="r-etiqueta" value="${esc(c.etiqueta)}">`)}
    ${campo('Cable', `<select data-k="r-ctipo">${opciones(R.TIPOS_CABLE, c.tipo)}</select>`)}
    ${campo('Va por', `<select data-k="r-canal">${opciones(R.CANALES, c.canal)}</select>`)}
    ${campo('Estado', `<select data-k="r-estado">${opciones(R.ESTADOS_CABLE, c.estado)}</select>`)}
    ${campo('Notas', `<textarea data-k="r-notas">${esc(c.notas)}</textarea>`)}
    <div class="botonera solo-ed">
      <button class="btn" data-acc="red-invertir">Cambiar el sentido</button>
      <button class="btn peligro" data-acc="red-borrar">Borrar cable</button></div>
    <p class="ayuda solo-ed">Arrastra los puntos blancos para cambiar el recorrido; el + que hay en medio de cada tramo añade un punto.
      Para quitar uno, tócalo y pulsa «Quitar punto». Los pasos a otra planta se mueven, pero no se quitan.</p>`;
}

// ---------------------------------------------------------------------------- resumen de la planta

function leyenda() {
  return '<div class="p-sub">Leyenda</div><div class="leyenda-red">' +
    Object.values(R.TIPOS_CABLE).map((t) => `<span><i class="muestra-cable" style="--c:${t.color}"></i>${esc(t.nombre)}</span>`).join('') +
    '<span><i class="muestra-cable proyecto" style="--c:#475569"></i>Proyectado</span><span><i class="muestra-cable" style="--c:#dc2626"></i>Averiado</span>' +
    Object.entries(R.TIPOS_EQUIPO).map(([k, t]) => `<span>${ico(k, 17)}${esc(t.nombre)}</span>`).join('') + '</div>';
}

function itemEquipo(ctx, id) {
  const e = ctx.red.equipos[id];
  const u = R.ubicacion(ctx, id);
  const usados = e.puertos ? R.puertosDe(ctx.red, id).usados.size : 0;
  return `<li><button data-acc="red-ir-eq" data-id="${id}">${ico(e.tipo, 18)}<span>${esc(e.nombre)}</span><small>${esc(u.sala)}${e.puertos > 2 ? ` · ${usados}/${e.puertos}` : ''}</small></button></li>`;
}

function panelPlantaRed(app, ctx) {
  const { red, ip } = ctx;
  const p = app.planta(), ed = app.edificio();
  const aqui = Object.keys(red.equipos).filter((id) => R.lugar(red, id)?.pl === p.id).sort(R.porTipoYNombre(red));
  const cuenta = (...t) => aqui.filter((id) => t.includes(red.equipos[id].tipo)).length;
  let cables = 0, metros = 0;
  for (const c of Object.values(red.cables)) {
    let pasa = false;
    for (const t of R.recorrido(red, ip, c).tramos) {
      if (t.pl !== p.id) continue;
      pasa = true;
      for (let i = 1; i < t.pts.length; i++) metros += dist(t.pts[i - 1], t.pts[i]);
    }
    if (pasa) cables++;
  }
  let h = `
    <div class="p-cab"><h2>Red · ${esc(p.nombre)}</h2><span class="chip">${esc(ed?.nombre)}</span></div>
    <div class="cifras">
      <div class="cifra"><b>${cuenta('switch', 'router')}</b><span>switches y routers</span></div>
      <div class="cifra"><b>${cuenta('ap')}</b><span>puntos WiFi</span></div>
      <div class="cifra"><b>${cuenta('toma')}</b><span>tomas</span></div>
      <div class="cifra"><b>${cables}</b><span>cables · ${m1(metros)} en planta</span></div>
    </div>`;
  if (!Object.keys(red.equipos).length) {
    h += `<p class="ayuda">Aún no hay nada de red. Un orden que funciona: primero el armario (o el switch) principal y el router;
      después los demás switches y los puntos WiFi; y al final los cables entre ellos, con la herramienta <b>Cable</b>.</p>`;
  }
  const grandes = aqui.filter((id) => !['toma', 'equipo'].includes(red.equipos[id].tipo));
  const peques = aqui.filter((id) => ['toma', 'equipo'].includes(red.equipos[id].tipo));
  if (grandes.length) h += `<div class="p-sub">En esta planta</div><ul class="lista">${grandes.map((id) => itemEquipo(ctx, id)).join('')}</ul>`;
  if (peques.length) h += `<details class="mas"><summary>${plural(peques.length, 'toma o equipo', 'tomas y equipos')}</summary><ul class="lista">${peques.map((id) => itemEquipo(ctx, id)).join('')}</ul></details>`;
  h += leyenda();
  h += `<p class="ayuda">A la izquierda: <b>Cable</b> para tenderlos y los equipos para colocarlos. Toca un equipo o un cable para ver su ficha.
    En la pestaña <b>Esquema</b> está el árbol de toda la red y los listados para Excel.</p>`;
  return h;
}

// ---------------------------------------------------------------------------- esquema

export function pintarEsquema(app) {
  const cont = document.getElementById('pest-esquema');
  if (!app.doc) { cont.innerHTML = ''; return; }
  const ctx = R.contexto(app.doc);
  const { red } = ctx;
  const ids = Object.keys(red.equipos);
  if (!ids.length) {
    cont.innerHTML = '<p class="ayuda" style="margin-top:0">Aún no hay equipos de red. En el modo <b>Red</b> se ponen el router, los switches y los puntos WiFi, y se unen con cables: aquí saldrá el árbol de la red.</p>';
    return;
  }
  const arb = R.arbol(red);
  const pr = R.problemas(ctx);
  const n = (t) => ids.filter((id) => red.equipos[id].tipo === t).length;
  let metros = 0;
  for (const c of Object.values(red.cables)) metros += R.longitud(ctx, c).total;
  let h = `<div class="cifras">
    <div class="cifra"><b>${n('switch') + n('router')}</b><span>switches y routers</span></div>
    <div class="cifra"><b>${n('ap')}</b><span>puntos WiFi</span></div>
    <div class="cifra"><b>${n('toma')}</b><span>tomas</span></div>
    <div class="cifra"><b>${Object.keys(red.cables).length}</b><span>cables · unos ${Math.round(metros)} m</span></div></div>`;

  const revisar = [];
  const eq = (id, txt) => `<li><button data-acc="red-ir-eq" data-id="${id}"><i class="punto-aviso"></i><span>${txt}</span></button></li>`;
  const cab = (cid, txt) => `<li><button data-acc="red-ir-cable" data-id="${cid}"><i class="punto-aviso"></i><span>${txt}</span></button></li>`;
  for (const { id, pto } of pr.dobles) revisar.push(eq(id, `${esc(red.equipos[id].nombre)}: dos cables en el puerto ${pto}`));
  for (const { id, pto } of pr.fuera) revisar.push(eq(id, `${esc(red.equipos[id].nombre)}: puerto ${pto}, pero tiene ${red.equipos[id].puertos}`));
  for (const cid of pr.largos) revisar.push(cab(cid, `${esc(red.cables[cid].etiqueta)}: más de 90 m en cobre`));
  for (const cid of pr.sueltos) revisar.push(cab(cid, `${esc(red.cables[cid].etiqueta)}: con un extremo suelto`));
  if (revisar.length) {
    h += `<div class="p-sub">Para revisar (${revisar.length})</div><ul class="lista revisar">${revisar.slice(0, 12).join('')}</ul>`;
    if (revisar.length > 12) h += `<p class="ayuda">Y ${revisar.length - 12} más.</p>`;
  }

  const HOJAS = ['toma', 'equipo', 'ap'];
  const enlace = (id) => {
    const v = arb.via.get(id);
    if (!v) return '';
    const c = red.cables[v.cid];
    const ptos = `${v.mio ? 'p' + v.mio : ''}${v.mio || v.suyo ? ' → ' : ''}${v.suyo ? 'p' + v.suyo : ''}`;
    return `<span class="enl" style="--c:${colorCable(c)}">${ptos}${ptos ? ' · ' : ''}${esc(R.TIPOS_CABLE[c.tipo].nombre)}${c.estado !== 'servicio' ? ' · ' + esc(R.ESTADOS_CABLE[c.estado]).toLowerCase() : ''}</span>`;
  };
  const boton = (id) => `<button class="nodo" data-acc="red-ir-eq" data-id="${id}">${ico(red.equipos[id].tipo, 18)}<b>${esc(red.equipos[id].nombre)}</b><small>${esc(R.textoUbicacion(ctx, id, false))}</small></button>`;
  const nodo = (id) => {
    const hijos = [...(arb.hijos.get(id) || [])].sort(R.porTipoYNombre(red));
    const ramas = hijos.filter((x) => !HOJAS.includes(red.equipos[x].tipo) || arb.hijos.get(x)?.length);
    const hojas = hijos.filter((x) => !ramas.includes(x));
    let s = `<li>${boton(id)}${enlace(id)}`;
    if (hijos.length) {
      s += '<ul>' + ramas.map(nodo).join('');
      if (hojas.length) {
        const k = (t) => hojas.filter((x) => red.equipos[x].tipo === t).length;
        const resumen = [[k('ap'), 'punto WiFi', 'puntos WiFi'], [k('toma'), 'toma', 'tomas'], [k('equipo'), 'equipo', 'equipos']]
          .filter(([m]) => m).map(([m, a, b]) => plural(m, a, b)).join(', ');
        s += `<li class="hojas"><details><summary>${resumen}</summary><ul>${hojas.map((x) => `<li>${boton(x)}${enlace(x)}</li>`).join('')}</ul></details></li>`;
      }
      s += '</ul>';
    }
    return s + '</li>';
  };
  h += '<div class="p-sub">Esquema</div>';
  arb.raices.forEach((r, k) => {
    if (k === 1) h += `<div class="p-sub">Sin conexión con ${esc(red.equipos[arb.raices[0]].nombre)}</div>`;
    h += `<ul class="arbol">${nodo(r)}</ul>`;
  });
  if (arb.sueltos.length) {
    h += `<div class="p-sub">Sin cables (${arb.sueltos.length})</div><ul class="lista">${[...arb.sueltos].sort(R.porTipoYNombre(red)).slice(0, 40).map((id) => itemEquipo(ctx, id)).join('')}</ul>`;
  }
  h += `<div class="p-sub">Listados para Excel</div>
    <div class="botonera" style="margin-top:0"><button class="btn" data-acc="red-csv" data-que="equipos">Equipos</button>
    <button class="btn" data-acc="red-csv" data-que="cables">Cables</button><button class="btn" data-acc="red-csv" data-que="puertos">Puertos</button></div>
    <p class="ayuda">Archivos CSV: se abren con Excel o LibreOffice. El de puertos lista, switch a switch, qué hay en cada puerto.</p>`;
  cont.innerHTML = h;
}

// ---------------------------------------------------------------------------- acciones

/** Lleva la vista a un punto de una planta (cambiando de planta si hace falta) y selecciona. */
function irA(app, r, pt, sel) {
  const est = app.est;
  // su ficha está en «Detalles»
  const pd = document.querySelector('.pestanas [data-pest="props"]');
  if (!pd.classList.contains('activa')) pd.click();
  if (est.modo === '3d') app.modo('ver');
  else if (est.modo === 'editar' || est.modo === 'anotar') app.modo('red');
  if (est.modo === 'ver' && !est.capas.red) { est.capas.red = true; app.guardarPreferencias(); }
  if (r.p.id !== est.plId) app.irAPlanta(r.ed.id, r.p.id, false, true);
  const v = est.vista, w = app.svg.clientWidth, alto = app.svg.clientHeight - (innerWidth <= 820 && !document.body.classList.contains('sin-panel') ? document.getElementById('panel').offsetHeight : 0);
  const s = { x: pt.x * v.z + v.x, y: pt.y * v.z + v.y };
  if (s.x < 50 || s.y < 50 || s.x > w - 80 || s.y > alto - 50) {
    v.z = Math.max(v.z, 12);
    v.x = w / 2 - pt.x * v.z;
    v.y = alto / 2 - pt.y * v.z;
    app.pintarVista();
  }
  app.seleccionar(sel);
}

export function irAEquipo(app, id) {
  const l = R.lugar(app.doc.red, id);
  const r = l && R.indicePlantas(app.doc).get(l.pl);
  if (r) irA(app, r, l, { tipo: 'equipo', id });
}

export function irACable(app, id) {
  const red = app.doc.red, c = red.cables[id];
  if (!c) return;
  const ip = R.indicePlantas(app.doc);
  const rec = R.recorrido(red, ip, c);
  // en la planta actual si pasa por ella; si no, en la primera
  const t = rec.tramos.find((x) => x.pl === app.est.plId && x.pts.length) || rec.tramos.find((x) => x.pts.length);
  if (!t) return;
  const q = t.pts[Math.floor((t.pts.length - 1) / 2)];
  const r = ip.get(t.pl);
  if (r) irA(app, r, q, { tipo: 'cable', id });
}

function exportarCsv(app, que) {
  const ctx = R.contexto(app.doc);
  const filas = que === 'equipos' ? R.filasInventario(ctx) : que === 'cables' ? R.filasCables(ctx) : R.filasPuertos(ctx);
  const archivo = `${app.doc.centro?.nombre || 'Centro'} - red - ${que}.csv`.replace(/[\\/:*?"<>|]/g, '');
  descargar(new Blob([R.csv(filas)], { type: 'text/csv;charset=utf-8' }), archivo);
}

export function accionRed(app, acc, b) {
  const est = app.est, red = app.doc.red;
  const id = b.dataset.id;
  switch (acc) {
    case 'red-ir-eq': irAEquipo(app, id); return;
    case 'red-ir-cable': irACable(app, id); return;
    case 'red-ir-pl': {
      const r = R.indicePlantas(app.doc).get(b.dataset.pl);
      if (r) app.irAPlanta(r.ed.id, r.p.id, r.ed.id !== est.edId, true);
      return;
    }
    case 'red-puerto': {
      const k = +b.dataset.pto;
      est.redPuerto = est.redPuerto === k ? null : k;
      app.panel();
      return;
    }
    case 'red-rastrear':
    case 'red-depende': {
      const modo = acc === 'red-rastrear' ? 'rastreo' : 'depende';
      est.redVer = est.redVer?.modo === modo && est.redVer.id === id ? null : { modo, id };
      app.focoRed();
      app.pintar();
      app.panel();
      return;
    }
    case 'red-tender': {
      irAEquipo(app, id);
      if (est.modo !== 'red') return;
      app.herramienta('cable');
      app.redHerr.empezarDesde(id, b.dataset.pto ? +b.dataset.pto : null);
      app.aviso('Ve tocando el recorrido y acaba en otro equipo (o con doble toque).');
      return;
    }
    case 'red-meter': {
      app.antesRed();
      const nid = R.crearEquipo(red, b.dataset.tipo, { en: id });
      app.cambio();
      app.seleccionar({ tipo: 'equipo', id: nid });
      return;
    }
    case 'red-borrar': app.borrarSeleccion(); return;
    case 'red-soltar': {
      const c = red.cables[est.sel?.id];
      if (!c) return;
      app.antesRed();
      R.soltarExtremo(red, R.indicePlantas(app.doc), c, b.dataset.lado);
      app.cambio();
      return;
    }
    case 'red-invertir': {
      const c = red.cables[est.sel?.id];
      if (!c) return;
      app.antesRed();
      R.invertirCable(c);
      est.redVert = null;
      app.cambio();
      return;
    }
    case 'red-csv': exportarCsv(app, b.dataset.que); return;
  }
}

/** Cambio de un campo de la ficha de un equipo o de un cable. */
export function aplicarRed(app, k, el) {
  const est = app.est, red = app.doc.red, sel = est.sel;
  const valor = el.value;
  const mal = (txt) => { app.aviso(txt); app.panel(); };
  if (sel?.tipo === 'equipo' && red.equipos[sel.id]) {
    const e = red.equipos[sel.id];
    switch (k) {
      case 'r-nombre':
        if (!valor.trim()) { app.panel(); return; }
        app.antesRed(); e.nombre = valor.trim(); break;
      case 'r-tipo':
        if (e.tipo === 'armario' && Object.values(red.equipos).some((o) => o.en === sel.id)) { mal('El armario tiene equipos dentro: sácalos o bórralos antes.'); return; }
        app.antesRed();
        if (e.en && !EN_ARMARIO.includes(valor)) R.sacarDeArmario(red, sel.id);
        e.tipo = valor;
        if (valor === 'armario') e.puertos = 0;
        else if (!e.puertos) e.puertos = R.TIPOS_EQUIPO[valor].puertos;
        break;
      case 'r-subtipo': app.antesRed(); e.subtipo = valor; break;
      case 'r-modelo': app.antesRed(); e.modelo = valor.trim(); break;
      case 'r-ip': app.antesRed(); e.ip = valor.trim(); break;
      case 'r-puertos': {
        const n = Number(valor.trim());
        if (!Number.isInteger(n) || n < 0 || n > 192) { mal('Escribe un número de puertos entre 0 y 192.'); return; }
        const max = Math.max(0, ...R.puertosDe(red, sel.id).usados.keys());
        if (n < max) { mal(`El puerto ${max} tiene un cable: no pueden quedar menos de ${max}.`); return; }
        app.antesRed(); e.puertos = n;
        if (est.redPuerto > n) est.redPuerto = null;
        break;
      }
      case 'r-gestionable': app.antesRed(); e.gestionable = el.checked; break;
      case 'r-poe': app.antesRed(); e.poe = el.checked; break;
      case 'r-alcance': {
        const n = leerNum(valor);
        if (!(n > 0 && n <= 100)) { mal('Escribe el alcance en metros, por ejemplo 15.'); return; }
        app.antesRed(); e.alcance = n; break;
      }
      case 'r-en':
        app.antesRed();
        if (valor) R.meterEnArmario(red, sel.id, valor); else if (e.en) R.sacarDeArmario(red, sel.id);
        break;
      case 'r-h': {
        if (!valor.trim()) { app.antesRed(); delete e.h; break; }
        const n = leerNum(valor);
        if (n === null || n < 0 || n > 15) { mal('Escribe la altura en metros sobre el suelo, por ejemplo 2,40.'); return; }
        app.antesRed(); e.h = n; break;
      }
      case 'r-notas': app.antesRed(); e.notas = valor; break;
      case 'r-nota-puerto': {
        app.antesRed();
        e.notasPuertos ||= {};
        if (valor.trim()) e.notasPuertos[el.dataset.pto] = valor.trim(); else delete e.notasPuertos[el.dataset.pto];
        break;
      }
      default: return;
    }
  } else if (sel?.tipo === 'cable' && red.cables[sel.id]) {
    const c = red.cables[sel.id];
    switch (k) {
      case 'r-etiqueta': app.antesRed(); c.etiqueta = valor.trim(); break;
      case 'r-ctipo': app.antesRed(); c.tipo = valor; break;
      case 'r-canal': app.antesRed(); c.canal = valor; break;
      case 'r-estado': app.antesRed(); c.estado = valor; break;
      case 'r-notas': app.antesRed(); c.notas = valor; break;
      case 'r-pto-a':
      case 'r-pto-b': {
        const lado = k.slice(-1);
        if (!c[lado]) return;
        app.antesRed(); c[lado].pto = valor ? +valor : null; break;
      }
      default: return;
    }
  } else return;
  app.cambio();
}
