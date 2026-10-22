#!/usr/bin/env python3
"""
Importa los planos del Plan de Autoprotección (PDF vectorial exportado de AutoCAD,
con capas) y genera un archivo de plano para la app «Plano del cole».

    python importar_pau.py PLANOS.pdf SALIDA.plano.json [--depurar CARPETA]

Qué hace, hoja por hoja:
  - Copia todo el dibujo como «calco» (fondo de referencia), separado en capas:
    arquitectura, medios contra incendios, evacuación y sectores.
  - Detecta los muros del edificio principal (trazo de 0,48 en la capa 0): busca
    pares de líneas paralelas, las convierte en muros con grosor, une las
    esquinas y rellena los huecos de puertas y ventanas.
  - Convierte los rótulos de las salas en espacios con nombre.

El resultado es un punto de partida: se revisa y corrige en la app.

Requiere PyMuPDF (pip install pymupdf). Probado con PyMuPDF 1.28 y Python 3.14.
"""
import argparse
import json
import math
import re
import sys
from collections import defaultdict
from datetime import date

import fitz  # PyMuPDF

PT = 0.0254 / 72  # metros de papel por punto PDF

# Hojas del PDF de Securitec 2026. «recorte» en puntos PDF (x0, y0, x1, y1):
# solo se importa lo que cae dentro (fuera quedan cajetín, leyenda y minimapa).
# Las tres plantas del edificio principal comparten recorte y origen, así que
# salen superpuestas exactamente.
HOJAS = [
    dict(pag=2, escala=150, edificio='principal', planta='Planta baja', nivel=0,
         recorte=(230, 15, 1060, 705), muros=True),
    dict(pag=3, escala=150, edificio='principal', planta='Planta primera', nivel=1,
         recorte=(230, 15, 1060, 705), muros=True),
    dict(pag=4, escala=150, edificio='principal', planta='Planta segunda', nivel=2,
         recorte=(230, 15, 1060, 705), muros=True),
    dict(pag=5, escala=100, edificio='gimnasio', planta='Planta baja', nivel=0,
         recorte=(60, 110, 600, 590), muros=False),
    dict(pag=5, escala=100, edificio='gimnasio', planta='Planta primera', nivel=1,
         recorte=(640, 110, 1150, 680), muros=False, origen=(640, 110)),
    dict(pag=6, escala=50, edificio='conserje', planta='Planta baja', nivel=0,
         recorte=(215, 20, 1030, 772), muros=False),
    dict(pag=1, escala=1000, edificio='exterior', planta='Emplazamiento', nivel=0,
         recorte=(40, 10, 1191, 712), muros=False),
]

EDIFICIOS = {
    'principal': 'Edificio principal',
    'gimnasio': 'Gimnasio',
    'conserje': 'Casa conserje / AMPA',
    'exterior': 'Exterior',
}

# Capas OCG del PDF -> capas de calco de la app
def capa_calco(nombre):
    if nombre == '0' or nombre.startswith('PDF11_'):
        return 'arquitectura'
    if nombre.startswith(('3.7.', '3.9.Cuadros', '3.3.', '2.1.', '2.9.')):
        return 'pci'
    if nombre.startswith(('3.9a', '3.2.', 'Evacuacion', '2.6.', '2.7.', '2.8.', '1.8.')):
        return 'evacuacion'
    if nombre.startswith(('3.4.', '3.5.', '3.6.', '2.3.', '1.9-2.4')):
        return 'sectores'
    return None  # cajetín, logotipo, márgenes, norte, leyenda…


# Rótulos que no son nombres de sala
NO_SALA = re.compile(
    r'^(E\d|AE\d|AG\d|N|\d+|GAS|CORTE|C\.E\.G\.|Calle|C\. ?STA\..*|PLANTA .*|.*pers\.|'
    r'Ocupaci.*|NOTA.*|de emergencia.*|Sector de incendios|Otros locales.*|V.as de evacuaci.n)$')


def r2(v):
    return round(v, 2)


# ---------------------------------------------------------------------------
# Calco: el dibujo original convertido a trazados SVG en metros
# ---------------------------------------------------------------------------

def color_hex(c):
    if not c:
        return None
    return '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in c[:3])


def path_d(items, tr, close):
    out = []
    last = None

    def pt(p):
        x, y = tr(p.x, p.y)
        return f'{x:.2f} {y:.2f}'

    def move(p):
        nonlocal last
        s = pt(p)
        if s != last:
            out.append('M' + s)
        last = s

    for it in items:
        k = it[0]
        if k == 'l':
            move(it[1])
            last = pt(it[2])
            out.append('L' + last)
        elif k == 'c':
            move(it[1])
            last = pt(it[4])
            out.append('C' + pt(it[2]) + ' ' + pt(it[3]) + ' ' + last)
        elif k == 're':
            r = it[1]
            out.append('M' + pt(r.tl) + 'L' + pt(r.tr) + 'L' + pt(r.br) + 'L' + pt(r.bl) + 'Z')
            last = None
        elif k == 'qu':
            q = it[1]
            out.append('M' + pt(q.ul) + 'L' + pt(q.ur) + 'L' + pt(q.lr) + 'L' + pt(q.ll) + 'Z')
            last = None
    if close and out and not out[-1].endswith('Z'):
        out.append('Z')
    return ''.join(out)


def calcos(page, rec, tr):
    capas = defaultdict(lambda: defaultdict(list))
    for x in page.get_drawings():
        capa = capa_calco(x.get('layer') or '0')
        if not capa or not rec.contains(x['rect']):
            continue
        typ = x['type']
        stroke = color_hex(x.get('color')) if 's' in typ else None
        fill = color_hex(x.get('fill')) if 'f' in typ else None
        w = r2(max(0.5, (x.get('width') or 0) * 1.6)) if stroke else 0
        dash = (x.get('dashes') or '').strip()
        dash = '' if dash in ('', '[] 0', '[] 0.0') else 'd'
        d = path_d(x['items'], tr, x.get('closePath'))
        if d:
            capas[capa][(stroke, fill, w, dash, bool(x.get('even_odd')))].append(d)
    res = {}
    for capa, estilos in capas.items():
        res[capa] = [dict(trazo=k[0], relleno=k[1], ancho=k[2], discontinuo=k[3] == 'd',
                          parImpar=k[4], d=''.join(v)) for k, v in estilos.items()]
    return res


# ---------------------------------------------------------------------------
# Rótulos de sala
# ---------------------------------------------------------------------------

def rotulos(page, rec, tr, k):
    spans = []
    for b in page.get_text('dict')['blocks']:
        for line in b.get('lines', []):
            for s in line['spans']:
                t = ' '.join(s['text'].split())
                if not t or s['color'] != 0 or s['size'] < 4.5:
                    continue
                bb = fitz.Rect(s['bbox'])
                if not rec.contains(bb) or NO_SALA.match(t):
                    continue
                spans.append(dict(t=t, bb=bb, size=s['size'], vertical=line['dir'][0] < 0.5))
    # junta rótulos de dos líneas («ASEO» + «PMR», «MÚSICA» + «AULA 26»…)
    spans.sort(key=lambda s: (s['bb'].y0, s['bb'].x0))
    grupos = []
    for s in spans:
        for g in grupos:
            u = g['bb']
            if (not s['vertical'] and not g['vertical']
                    and 0 <= s['bb'].y0 - u.y1 < s['size'] * 0.6
                    and min(u.x1, s['bb'].x1) - max(u.x0, s['bb'].x0) > -2):
                g['t'] += ' ' + s['t']
                g['bb'] = u | s['bb']
                break
        else:
            grupos.append(dict(s))
    out = []
    for g in grupos:
        c = g['bb'].tl + (g['bb'].br - g['bb'].tl) * 0.5
        x, y = tr(c.x, c.y)
        out.append(dict(nombre=g['t'], x=r2(x), y=r2(y)))
    return out


# ---------------------------------------------------------------------------
# Detección de muros
# ---------------------------------------------------------------------------

TMIN, TMAX = 0.05, 0.62     # grosores de muro admitidos (m)
SOLAPE_MIN = 0.08


def segmentos(drawings, rec, tr, filtro):
    """Segmentos horizontales y verticales (en metros) de los trazados que pasan el filtro."""
    H, V = [], []
    for x in drawings:
        if not filtro(x) or not rec.intersects(x['rect']):
            continue
        for it in x['items']:
            if it[0] == 'l':
                pares = [(it[1], it[2])]
            elif it[0] == 're':
                r = it[1]
                pares = [(r.tl, r.tr), (r.tr, r.br), (r.br, r.bl), (r.bl, r.tl)]
            elif it[0] == 'qu':
                q = it[1]
                pares = [(q.ul, q.ur), (q.ur, q.lr), (q.lr, q.ll), (q.ll, q.ul)]
            else:
                continue
            for a, b in pares:
                ax, ay = tr(a.x, a.y)
                bx, by = tr(b.x, b.y)
                if abs(ay - by) < 0.01 and abs(ax - bx) > 0.03:
                    H.append(((ay + by) / 2, min(ax, bx), max(ax, bx)))
                elif abs(ax - bx) < 0.01 and abs(ay - by) > 0.03:
                    V.append(((ax + bx) / 2, min(ay, by), max(ay, by)))
    return H, V


def restar(intervalos, a, b):
    out = []
    for x0, x1 in intervalos:
        if b <= x0 or a >= x1:
            out.append((x0, x1))
            continue
        if a > x0:
            out.append((x0, a))
        if b < x1:
            out.append((b, x1))
    return [i for i in out if i[1] - i[0] > 1e-3]


def cortar(intervalos, a, b):
    return [(max(x0, a), min(x1, b)) for x0, x1 in intervalos if min(x1, b) - max(x0, a) > 1e-3]


def losas(segs):
    """Empareja caras paralelas: cada cara «de abajo» con la más cercana por encima.
    Una cara que ya hizo de «tapa» en un tramo no puede hacer de «base» en ese tramo
    (regla de paridad), así no se cuela el aire entre dos muros como si fuera muro."""
    segs = sorted(segs)
    usado_tapa = defaultdict(list)
    out = []
    for i, (c, a, b) in enumerate(segs):
        libres = [(a, b)]
        for u0, u1 in usado_tapa[i]:
            libres = restar(libres, u0, u1)
        cands = []
        for j in range(i + 1, len(segs)):
            c2, a2, b2 = segs[j]
            dc = c2 - c
            if dc < TMIN:
                continue
            if dc > TMAX:
                break
            if min(b, b2) - max(a, a2) > SOLAPE_MIN:
                cands.append(j)
        for j in cands:
            if not libres:
                break
            c2, a2, b2 = segs[j]
            trozos = cortar(libres, a2, b2)
            for x0, x1 in trozos:
                if x1 - x0 < SOLAPE_MIN:
                    continue
                out.append(dict(c=(c + c2) / 2, t=c2 - c, a=x0, b=x1))
                usado_tapa[j].append((x0, x1))
                libres = restar(libres, x0, x1)
    return out


def fusionar(ls, tol_c=0.03, tol_t=0.04, hueco=0.03):
    """Une losas colineales contiguas de grosor parecido."""
    ls = sorted(ls, key=lambda l: (round(l['c'] / tol_c), l['a']))
    hecho = True
    while hecho:
        hecho = False
        ls.sort(key=lambda l: (l['c'], l['a']))
        res = []
        for l in ls:
            for m in res:
                if (abs(m['c'] - l['c']) <= tol_c and abs(m['t'] - l['t']) <= tol_t
                        and l['a'] <= m['b'] + hueco and l['b'] >= m['a'] - hueco):
                    lm, ll = m['b'] - m['a'], l['b'] - l['a']
                    m['c'] = (m['c'] * lm + l['c'] * ll) / (lm + ll)
                    m['t'] = max(m['t'], l['t']) if abs(m['t'] - l['t']) < 0.01 else (m['t'] if lm >= ll else l['t'])
                    m['a'], m['b'] = min(m['a'], l['a']), max(m['b'], l['b'])
                    hecho = True
                    break
            else:
                res.append(dict(l))
        ls = res
    return ls


def absorber_resaltes(ls):
    """Los pilares embebidos dejan losas cortas y más gruesas pegadas a un muro:
    se absorben en el muro vecino."""
    ls = sorted(ls, key=lambda l: -(l['b'] - l['a']))
    out = []
    for l in ls:
        largo = l['b'] - l['a']
        if largo < 0.75:
            for m in out:
                if (abs(m['c'] - l['c']) <= 0.16 and l['a'] <= m['b'] + 0.03 and l['b'] >= m['a'] - 0.03):
                    m['a'], m['b'] = min(m['a'], l['a']), max(m['b'], l['b'])
                    break
            else:
                out.append(l)
        else:
            out.append(l)
    return out


def pilares_y_muros(Hl, Vl):
    """Separa los pilares exentos (cuadrados pequeños) de los muros."""
    def rect(l, horizontal):
        if horizontal:
            return (l['a'], l['c'] - l['t'] / 2, l['b'], l['c'] + l['t'] / 2)
        return (l['c'] - l['t'] / 2, l['a'], l['c'] + l['t'] / 2, l['b'])

    pilares = []
    def es_pilar(l):
        largo = l['b'] - l['a']
        return largo < 0.8 and l['t'] > 0.2 and largo / l['t'] < 1.7

    for horizontal, ls in ((True, Hl), (False, Vl)):
        for l in ls:
            if es_pilar(l):
                x0, y0, x1, y1 = rect(l, horizontal)
                if not any(abs(p[0] - x0) < 0.06 and abs(p[1] - y0) < 0.06 for p in pilares):
                    pilares.append((x0, y0, x1, y1))

    def dentro_de_pilar(l, horizontal):
        x0, y0, x1, y1 = rect(l, horizontal)
        return any(x0 >= p[0] - 0.03 and y0 >= p[1] - 0.03 and x1 <= p[2] + 0.03 and y1 <= p[3] + 0.03
                   for p in pilares)

    Hm = [l for l in Hl if not dentro_de_pilar(l, True) and (l['b'] - l['a']) >= max(0.2, l['t'] * 0.9)]
    Vm = [l for l in Vl if not dentro_de_pilar(l, False) and (l['b'] - l['a']) >= max(0.2, l['t'] * 0.9)]
    return pilares, Hm, Vm


def acristalamientos(segs, muros, pilares, horizontal):
    """Fachadas de ventanas corridas: tramos de vidrio (líneas finas colineales) entre
    pilares alineados, donde no hay ya un muro. Devuelve muros de fachada con ventanas."""
    segs = sorted(s for s in segs if s[2] - s[1] > 0.4)
    lineas = []
    for c, a, b in segs:
        for L in lineas:
            if abs(L['c'] - c) < 0.02:
                L['tramos'].append((a, b))
                break
        else:
            lineas.append(dict(c=c, tramos=[(a, b)]))
    nuevos = []
    for L in lineas:
        runs = []
        for a, b in sorted(L['tramos']):
            if runs and a <= runs[-1][1] + 2.0:
                runs[-1][1] = max(runs[-1][1], b)
                runs[-1][2].append((a, b))
            else:
                runs.append([a, b, [(a, b)]])
        for a, b, partes in runs:
            if b - a < 0.9:
                continue
            if any(abs(m['c'] - L['c']) < m['t'] / 2 + 0.02 and min(m['b'], b) - max(m['a'], a) > 0.3
                   for m in muros + nuevos):
                continue
            # pilares alineados con el tramo: dan el eje y el grosor de la fachada
            alineados = []
            for p in pilares:
                pc0, pc1 = (p[1], p[3]) if horizontal else (p[0], p[2])
                pa0, pa1 = (p[0], p[2]) if horizontal else (p[1], p[3])
                if pc0 - 0.05 <= L['c'] <= pc1 + 0.05 and pa1 >= a - 1.6 and pa0 <= b + 1.6:
                    alineados.append(((pc0 + pc1) / 2, pc1 - pc0, pa0, pa1))
            if len(alineados) < 2:
                continue  # sin pilares a los lados no es fachada (peldaños, hojas de puerta…)
            alineados.sort(key=lambda x: x[2])
            eje = sorted(x[0] for x in alineados)[len(alineados) // 2]
            grosor = sorted(x[1] for x in alineados)[len(alineados) // 2]
            # de centro de pilar extremo a centro de pilar extremo
            a2 = (alineados[0][2] + alineados[0][3]) / 2 if alineados[0][2] <= a + 0.05 else a
            b2 = (alineados[-1][2] + alineados[-1][3]) / 2 if alineados[-1][3] >= b - 0.05 else b
            # ventanas: vidrios contiguos, recortados por los pilares
            vidrios = []
            for x0, x1 in sorted(partes):
                if vidrios and x0 <= vidrios[-1][1] + 0.35:
                    vidrios[-1][1] = max(vidrios[-1][1], x1)
                else:
                    vidrios.append([x0, x1])
            vent = []
            for x0, x1 in vidrios:
                libres = [(x0, x1)]
                for _, _, p0, p1 in alineados:
                    libres = restar(libres, p0, p1)
                vent += [v for v in libres if v[1] - v[0] > 0.4]
            nuevos.append(dict(c=eje, t=grosor, a=a2, b=b2, tipo='fachada', ventanas=vent))
    return nuevos


def muros_finos(segs, muros):
    nuevos = []
    for l in fusionar(losas(segs)):
        if l['b'] - l['a'] < 1.2 or not 0.12 <= l['t'] <= 0.45:
            continue
        if any(abs(l['c'] - m['c']) < (l['t'] + m['t']) / 2 + 0.05 and min(l['b'], m['b']) - max(l['a'], m['a']) > 0.3
               for m in muros):
            continue
        nuevos.append(l)
    return nuevos


def caras_sueltas(segs, muros, grosor=0.12):
    """Líneas de muro largas sin pareja: se convierten en muros finos sobre la línea."""
    lineas = fusionar([dict(c=c, t=0, a=a, b=b) for c, a, b in segs], tol_c=0.01, tol_t=0.01, hueco=0.05)
    nuevos = []
    for l in lineas:
        largo = l['b'] - l['a']
        if largo < 1.0:
            continue
        cubierto = sum(max(0, min(l['b'], m['b']) - max(l['a'], m['a'])) for m in muros + nuevos
                       if abs(l['c'] - m['c']) <= m['t'] / 2 + 0.03)
        if cubierto < 0.5 * largo:
            nuevos.append(dict(c=l['c'], t=grosor, a=l['a'], b=l['b']))
    return nuevos


def arcos_puerta(drawings, rec, tr):
    """Arcos de giro de puertas: curvas finas sueltas de entre 0,45 y 1,6 m de radio."""
    arcos = []
    for x in drawings:
        if (x.get('layer') or '0') != '0' or not rec.intersects(x['rect']):
            continue
        if abs((x.get('width') or 0) - 0.12) > 0.01:
            continue
        curvas = [it for it in x['items'] if it[0] == 'c']
        if not curvas or len(curvas) != len(x['items']):
            continue
        pts = []
        for it in curvas:
            for tt in (0, 0.25, 0.5, 0.75, 1):
                p = it[1] * (1 - tt) ** 3 + it[2] * 3 * (1 - tt) ** 2 * tt + it[3] * 3 * (1 - tt) * tt ** 2 + it[4] * tt ** 3
                pts.append(tr(p.x, p.y))
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if 0.45 <= max(w, h) <= 1.6 and min(w, h) >= 0.4 and 0.75 <= w / h <= 1.33:
            arcos.append(dict(x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys), pts=pts))
    return arcos


def rellenar_huecos(ls, horizontal, arcos):
    """Une muros colineales separados por un hueco (puerta o paso). Las puertas se
    reconocen después, por su arco; aquí el hueco queda como «paso»."""
    for l in ls:
        l.setdefault('huecos', [])
        l.setdefault('ventanas', [])

    def hay_arco(l, a, b):
        for k in arcos:
            if horizontal:
                sol = min(k['x1'], b) - max(k['x0'], a)
                cerca = min(abs(k['y0'] - l['c']), abs(k['y1'] - l['c'])) < l['t'] / 2 + 0.3
            else:
                sol = min(k['y1'], b) - max(k['y0'], a)
                cerca = min(abs(k['x0'] - l['c']), abs(k['x1'] - l['c'])) < l['t'] / 2 + 0.3
            if sol > 0.4 and cerca:
                return True
        return False

    cambiado = True
    while cambiado:
        cambiado = False
        ls.sort(key=lambda l: (l['c'], l['a']))
        for l in ls:
            mejor = None
            for m in ls:
                if m is l or abs(m['c'] - l['c']) > 0.06 or abs(m['t'] - l['t']) > 0.12:
                    continue
                g = m['a'] - l['b']
                if 0.55 <= g <= 2.6 and (mejor is None or g < mejor[1]):
                    mejor = (m, g)
            if not mejor:
                continue
            m, g = mejor
            a, b = l['b'], m['a']
            if g > 1.6 and not hay_arco(l, a, b):
                continue
            l['huecos'] = l['huecos'] + [dict(a=a, b=b, tipo='paso')] + m['huecos']
            l['ventanas'] = l['ventanas'] + m['ventanas']
            l['b'] = m['b']
            l['tipo'] = l.get('tipo') or m.get('tipo')
            ls.remove(m)
            cambiado = True
            break
    return ls


def detectar_muros(page, rec, tr):
    dr = page.get_drawings()
    es_muro = lambda x: (x.get('layer') or '0') == '0' and 's' in x['type'] and \
        abs((x.get('width') or 0) - 0.48) < 0.01 and color_hex(x.get('color')) == '#000000'
    es_vidrio = lambda x: (x.get('layer') or '0') == '0' and 's' in x['type'] and \
        abs((x.get('width') or 0) - 0.12) < 0.01 and color_hex(x.get('color')) == '#000000'
    H, V = segmentos(dr, rec, tr, es_muro)
    Hl = absorber_resaltes(fusionar(losas(H)))
    Vl = absorber_resaltes(fusionar(losas(V)))
    Hl, Vl = fusionar(Hl), fusionar(Vl)
    pilares, Hm, Vm = pilares_y_muros(Hl, Vl)
    Hv, Vv = segmentos(dr, rec, tr, es_vidrio)
    Hm += acristalamientos(Hv, Hm, pilares, True)
    Vm += acristalamientos(Vv, Vm, pilares, False)
    # Algunas zonas (ampliaciones) dibujan los muros con trazo fino: pares de líneas
    # finas largas y paralelas que no caen dentro de un muro ya detectado.
    Hm += muros_finos(Hv, Hm)
    Vm += muros_finos(Vv, Vm)
    # Y otras dibujan solo una cara del muro (la otra queda bajo la línea de sector)
    Hm += caras_sueltas(H, Hm)
    Vm += caras_sueltas(V, Vm)
    arcos = arcos_puerta(dr, rec, tr)
    Hm = rellenar_huecos(Hm, True, arcos)
    Vm = rellenar_huecos(Vm, False, arcos)
    return pilares, Hm, Vm, arcos, (Hv, Vv)


# ---------------------------------------------------------------------------
# Grafo de muros: nodos compartidos, esquinas y encuentros en T
# ---------------------------------------------------------------------------

def construir_grafo(Hm, Vm):
    muros = []
    for l in Hm:
        muros.append(dict(p=[l['a'], l['c']], q=[l['b'], l['c']], t=l['t'], h=True, src=l))
    for l in Vm:
        muros.append(dict(p=[l['c'], l['a']], q=[l['c'], l['b']], t=l['t'], h=False, src=l))

    # 1) alarga o recorta cada extremo hasta el eje del muro perpendicular más cercano
    for w in muros:
        for end in ('p', 'q'):
            E = w[end]
            sgn = -1 if end == 'p' else 1
            mejor = None
            for u in muros:
                if u is w or u['h'] == w['h']:
                    continue
                if w['h']:
                    X = u['p'][0]
                    lo, hi = sorted((u['p'][1], u['q'][1]))
                    if not (lo - w['t'] / 2 - 0.08 <= E[1] <= hi + w['t'] / 2 + 0.08):
                        continue
                    d = (X - E[0]) * sgn
                else:
                    X = u['p'][1]
                    lo, hi = sorted((u['p'][0], u['q'][0]))
                    if not (lo - w['t'] / 2 - 0.08 <= E[0] <= hi + w['t'] / 2 + 0.08):
                        continue
                    d = (X - E[1]) * sgn
                lim = u['t'] / 2 + 0.12
                if -u['t'] / 2 - 0.05 <= d <= lim and (mejor is None or abs(d) < abs(mejor[1])):
                    mejor = (X, d, u)
            if mejor:
                X, d, u = mejor
                if w['h']:
                    E[0] = X
                else:
                    E[1] = X
                # el otro muro también llega hasta aquí si se quedaba corto (esquina en L)
                if u['h']:
                    lo_end = min(('p', 'q'), key=lambda e: abs(u[e][0] - E[0]))
                    if abs(u[lo_end][0] - E[0]) <= w['t'] / 2 + 0.12:
                        u[lo_end][0] = E[0]
                else:
                    lo_end = min(('p', 'q'), key=lambda e: abs(u[e][1] - E[1]))
                    if abs(u[lo_end][1] - E[1]) <= w['t'] / 2 + 0.12:
                        u[lo_end][1] = E[1]

    # 2) nodos: agrupa extremos cercanos
    nodos = []
    def nodo(P):
        for i, n in enumerate(nodos):
            if abs(n[0] - P[0]) < 0.03 and abs(n[1] - P[1]) < 0.03:
                return i
        nodos.append([P[0], P[1]])
        return len(nodos) - 1

    aristas = []
    for w in muros:
        if math.dist(w['p'], w['q']) < 0.15:
            continue
        aristas.append(dict(a=nodo(w['p']), b=nodo(w['q']), t=w['t'], src=w['src'], h=w['h']))

    # 3) encuentros en T: un nodo sobre el tramo de otro muro lo parte
    hecho = True
    while hecho:
        hecho = False
        for e in aristas:
            A, B = nodos[e['a']], nodos[e['b']]
            for i, N in enumerate(nodos):
                if i in (e['a'], e['b']):
                    continue
                if e['h']:
                    if abs(N[1] - A[1]) < 0.03 and min(A[0], B[0]) + 0.03 < N[0] < max(A[0], B[0]) - 0.03:
                        pass
                    else:
                        continue
                else:
                    if abs(N[0] - A[0]) < 0.03 and min(A[1], B[1]) + 0.03 < N[1] < max(A[1], B[1]) - 0.03:
                        pass
                    else:
                        continue
                # parte e en N
                nuevo = dict(e)
                nuevo['a'] = i
                e2b = e['b']
                e['b'] = i
                nuevo['b'] = e2b
                aristas.append(nuevo)
                hecho = True
                break
            if hecho:
                break
    return nodos, aristas


def aberturas(aristas, nodos):
    """Pasa huecos y ventanas (coordenadas absolutas sobre el eje) a posiciones relativas
    a cada tramo: «pos» es la distancia del centro de la abertura al nodo a."""
    for e in aristas:
        A, B = nodos[e['a']], nodos[e['b']]
        a0, b0 = (A[0], B[0]) if e['h'] else (A[1], B[1])
        lo, hi = min(a0, b0), max(a0, b0)
        src = e['src']
        ab = [dict(hu) for hu in src.get('huecos', []) if hu['a'] >= lo - 0.01 and hu['b'] <= hi + 0.01]
        for v0, v1 in src.get('ventanas', []):
            v0, v1 = max(v0, lo), min(v1, hi)
            if v1 - v0 > 0.4:
                ab.append(dict(a=v0, b=v1, tipo='ventana'))
        e['ab'] = [dict(tipo=x['tipo'], pos=abs((x['a'] + x['b']) / 2 - a0), ancho=x['b'] - x['a']) for x in ab]
    return aristas


def _ejes(e, nodos):
    A, B = nodos[e['a']], nodos[e['b']]
    L = math.dist(A, B)
    if L < 1e-6:
        return A, 0, (1, 0), (0, 1)
    ux, uy = (B[0] - A[0]) / L, (B[1] - A[1]) / L
    return A, L, (ux, uy), (-uy, ux)


def _proyecta(k, e, nodos):
    A, L, (ux, uy), (nx, ny) = _ejes(e, nodos)
    ts = [(p[0] - A[0]) * ux + (p[1] - A[1]) * uy for p in k['pts']]
    ds = [(p[0] - A[0]) * nx + (p[1] - A[1]) * ny for p in k['pts']]
    return L, ts, ds


def _apoya(e, ds):
    """El arco arranca en la cara del muro y queda a un solo lado."""
    d_in = min(ds, key=abs)
    return abs(d_in) <= e['t'] / 2 + 0.2 and not (min(ds) < -e['t'] / 2 - 0.1 and max(ds) > e['t'] / 2 + 0.1)


def _anfitrion(k, aristas, nodos):
    mejor = None
    for e in aristas:
        L, ts, ds = _proyecta(k, e, nodos)
        if L < 0.3 or min(ts) < -0.15 or max(ts) > L + 0.15 or not _apoya(e, ds):
            continue
        d = min(abs(x) for x in ds)
        if mejor is None or d < mejor[0]:
            mejor = (d, e, L, ts, ds)
    return mejor


def _puente(k, aristas, nodos):
    """Puerta junto a una esquina o entre dos muros que no se llegaron a unir:
    tiende un tramo de muro nuevo que salva el hueco, para alojar la puerta."""
    for e in list(aristas):
        L, ts, ds = _proyecta(k, e, nodos)
        if L < 0.3 or not _apoya(e, ds):
            continue
        t0, t1 = min(ts), max(ts)
        if L - 0.15 <= t0 <= L + 0.4:
            ini, lejos, sentido = e['b'], t1, 1
        elif -0.4 <= t1 <= 0.15:
            ini, lejos, sentido = e['a'], t0, -1
        else:
            continue
        A, _, (ux, uy), (nx, ny) = _ejes(e, nodos)
        # al otro lado del hueco: un nodo sobre la línea o un muro que la cruza
        cand = None
        for i, N in enumerate(nodos):
            if i in (e['a'], e['b']):
                continue
            t = (N[0] - A[0]) * ux + (N[1] - A[1]) * uy
            d = (N[0] - A[0]) * nx + (N[1] - A[1]) * ny
            if abs(d) < 0.06 and -0.1 <= (t - lejos) * sentido <= 0.45:
                if cand is None or abs(t - lejos) < abs(cand[0] - lejos):
                    cand = (t, i, None)
        for f in aristas:
            if f is e:
                continue
            P, M, (vx, vy), _ = _ejes(f, nodos)
            den = ux * vy - uy * vx
            if abs(den) < 0.5:
                continue
            # A + u*t = P + v*s
            t = ((P[0] - A[0]) * vy - (P[1] - A[1]) * vx) / den
            s_ = ((P[0] - A[0]) * uy - (P[1] - A[1]) * ux) / den
            if -0.05 <= s_ <= M + 0.05 and -0.1 <= (t - lejos) * sentido <= 0.45:
                if cand is None or abs(t - lejos) < abs(cand[0] - lejos) - 0.02:
                    cand = (t, None, (f, s_))
        if cand is None:
            continue
        t, i, corte = cand
        if corte is not None:
            f, s_ = corte
            P, M, (vx, vy), _ = _ejes(f, nodos)
            # nodo nuevo en el cruce; si cae dentro del otro muro, _partir_en_t lo parte
            nodos.append([P[0] + vx * s_, P[1] + vy * s_])
            i = len(nodos) - 1
        nueva = dict(a=ini, b=i, t=e['t'], h=e['h'], src={}, ab=[])
        aristas.append(nueva)
        return nueva
    return None


def _partir_en_t(aristas, nodos):
    """Si un nodo cae dentro de un tramo, lo parte en dos (repartiendo sus aberturas)."""
    hecho = True
    while hecho:
        hecho = False
        for e in list(aristas):
            A, L, (ux, uy), (nx, ny) = _ejes(e, nodos)
            for i, N in enumerate(nodos):
                if i in (e['a'], e['b']):
                    continue
                t = (N[0] - A[0]) * ux + (N[1] - A[1]) * uy
                d = (N[0] - A[0]) * nx + (N[1] - A[1]) * ny
                if abs(d) < 0.03 and 0.03 < t < L - 0.03:
                    nueva = dict(e, a=i, ab=[dict(o, pos=o['pos'] - t) for o in e['ab'] if o['pos'] > t])
                    e['ab'] = [o for o in e['ab'] if o['pos'] <= t]
                    e['b'] = i
                    aristas.append(nueva)
                    hecho = True
                    break
            if hecho:
                break


def puertas_por_arcos(aristas, nodos, arcos):
    """Cada arco de giro se convierte en una puerta del muro al que se apoya.
    Sustituye los «pasos» que solapa; dos hojas contiguas forman una puerta doble.
    «lado» +1 = la hoja abre hacia la normal (-uy, ux) del tramo a->b."""
    for k in arcos:
        mejor = _anfitrion(k, aristas, nodos)
        if mejor is None and _puente(k, aristas, nodos) is not None:
            _partir_en_t(aristas, nodos)
            mejor = _anfitrion(k, aristas, nodos)
        if mejor is None:
            continue
        _, e, L, ts, ds = mejor
        t0, t1 = max(min(ts), 0), min(max(ts), L)
        lejano = max(range(len(ds)), key=lambda i: abs(ds[i]))
        lado = 1 if sum(ds) > 0 else -1
        bisagra = 'a' if abs(ts[lejano] - t0) < abs(ts[lejano] - t1) else 'b'
        resto, doble, choca = [], None, False
        for o in e['ab']:
            o0, o1 = o['pos'] - o['ancho'] / 2, o['pos'] + o['ancho'] / 2
            sol = min(o1, t1) - max(o0, t0)
            if o['tipo'] == 'paso' and sol > -0.05:
                continue
            if (o['tipo'] == 'puerta' and o.get('bisagra') != bisagra
                    and (abs(o0 - t1) < 0.15 or abs(o1 - t0) < 0.15)):
                doble = o
                continue
            if o['tipo'].startswith('puerta') and sol > 0.2:
                choca = True
            resto.append(o)
        if choca:
            continue
        if doble:
            d0 = min(doble['pos'] - doble['ancho'] / 2, t0)
            d1 = max(doble['pos'] + doble['ancho'] / 2, t1)
            resto.append(dict(tipo='puerta-doble', pos=(d0 + d1) / 2, ancho=d1 - d0, lado=lado, bisagra='a'))
        else:
            resto.append(dict(tipo='puerta', pos=(t0 + t1) / 2, ancho=t1 - t0, lado=lado, bisagra=bisagra))
        e['ab'] = resto
    for e in aristas:
        e['ab'] = [{k: (r2(v) if k in ('pos', 'ancho') else v) for k, v in o.items()} for o in e['ab']]
    return aristas


# ---------------------------------------------------------------------------

def sanear(aristas, nodos):
    """Deja el grafo plano y limpio: parte los muros que se cruzan sin nodo, suelda
    nodos casi coincidentes y quita las puntas que sobresalen de un encuentro."""
    # 1) cruces en X
    hecho = True
    while hecho:
        hecho = False
        for i, e in enumerate(aristas):
            A, B = nodos[e['a']], nodos[e['b']]
            for f in aristas[i + 1:]:
                if {e['a'], e['b']} & {f['a'], f['b']}:
                    continue
                C, D = nodos[f['a']], nodos[f['b']]
                rx, ry, sx, sy = B[0] - A[0], B[1] - A[1], D[0] - C[0], D[1] - C[1]
                den = rx * sy - ry * sx
                if abs(den) < 1e-9:
                    continue
                qx, qy = C[0] - A[0], C[1] - A[1]
                t, u = (qx * sy - qy * sx) / den, (qx * ry - qy * rx) / den
                Le, Lf = math.hypot(rx, ry), math.hypot(sx, sy)
                if 0.02 / Le < t < 1 - 0.02 / Le and 0.02 / Lf < u < 1 - 0.02 / Lf:
                    nodos.append([A[0] + rx * t, A[1] + ry * t])
                    _partir_en_t(aristas, nodos)
                    hecho = True
                    break
            if hecho:
                break
    # 2) nodos casi coincidentes
    usados = sorted({n for e in aristas for n in (e['a'], e['b'])})
    alias = {}
    for i, a in enumerate(usados):
        if a in alias:
            continue
        for b in usados[i + 1:]:
            if b not in alias and math.dist(nodos[a], nodos[b]) < 0.05:
                alias[b] = a
    for e in aristas:
        e['a'], e['b'] = alias.get(e['a'], e['a']), alias.get(e['b'], e['b'])
    aristas[:] = [e for e in aristas if e['a'] != e['b']]
    # 3) puntas: tramo corto con un extremo suelto que sale de un encuentro
    while True:
        grado = defaultdict(int)
        for e in aristas:
            grado[e['a']] += 1
            grado[e['b']] += 1
        puntas = [e for e in aristas
                  if math.dist(nodos[e['a']], nodos[e['b']]) < 0.5 and not e['ab']
                  and sorted((grado[e['a']], grado[e['b']])) [0] == 1 and max(grado[e['a']], grado[e['b']]) >= 3]
        if not puntas:
            break
        aristas.remove(puntas[0])
    _partir_en_t(aristas, nodos)
    return aristas


def _hay_vidrio(N, ux, uy, largo, grosor, vidrios):
    """¿Hay líneas de vidrio a lo largo del hueco? Entonces es una ventana."""
    Hv, Vv = vidrios
    if abs(uy) < 0.01:
        segs, c, a0 = Hv, N[1], N[0]
        x0, x1 = sorted((a0, a0 + ux * largo))
    elif abs(ux) < 0.01:
        segs, c, a0 = Vv, N[0], N[1]
        x0, x1 = sorted((a0, a0 + uy * largo))
    else:
        return False
    tramos = sorted((max(a, x0), min(b, x1)) for cc, a, b in segs
                    if abs(cc - c) <= grosor / 2 + 0.12 and min(b, x1) > max(a, x0))
    cubierto, fin = 0, x0
    for a, b in tramos:
        if b > fin:
            cubierto += b - max(a, fin)
            fin = b
    return cubierto > 0.5 * (x1 - x0)


def cerrar_huecos(aristas, nodos, vidrios, maximo=2.6):
    """Cada muro con un extremo suelto se prolonga en su dirección hasta el primer muro
    (o extremo de muro) que encuentra a menos de «maximo» metros. El tramo nuevo es un
    «paso»; si en él hay un arco de puerta, la segunda pasada de puertas lo convierte.
    Así se cierran las salas para poder calcular su superficie."""
    while True:
        grado = defaultdict(int)
        for e in aristas:
            grado[e['a']] += 1
            grado[e['b']] += 1
        hecho = False
        for n in sorted(i for i, g in grado.items() if g == 1):
            e = next(x for x in aristas if n in (x['a'], x['b']))
            o = e['b'] if e['a'] == n else e['a']
            N, O = nodos[n], nodos[o]
            L = math.dist(N, O)
            if L < 1e-6:
                continue
            ux, uy = (N[0] - O[0]) / L, (N[1] - O[1]) / L
            mejor = None
            for i, P in enumerate(nodos):
                if i in (n, o) or not grado.get(i):
                    continue
                t = (P[0] - N[0]) * ux + (P[1] - N[1]) * uy
                d = (P[0] - N[0]) * -uy + (P[1] - N[1]) * ux
                if abs(d) < 0.15 and 0.01 < t <= maximo and (mejor is None or t < mejor[0]):
                    mejor = (t, i, None)
            for f in aristas:
                if f is e:
                    continue
                A, B = nodos[f['a']], nodos[f['b']]
                vx, vy = B[0] - A[0], B[1] - A[1]
                den = ux * vy - uy * vx
                if abs(den) < 1e-9:
                    continue
                t = ((A[0] - N[0]) * vy - (A[1] - N[1]) * vx) / den
                s = ((A[0] - N[0]) * uy - (A[1] - N[1]) * ux) / den
                if not (0.01 < t <= maximo) or (mejor is not None and t >= mejor[0] - 0.02):
                    continue
                Lf = math.hypot(vx, vy)
                holgura = (f['t'] / 2 + 0.25) / Lf
                if 0.01 / Lf <= s <= 1 - 0.01 / Lf:
                    mejor = (t, None, f)
                elif -holgura <= s < 0.01 / Lf:
                    mejor = (t, f['a'], None)   # pasa rozando el extremo: se une a él
                elif 1 - 0.01 / Lf < s <= 1 + holgura:
                    mejor = (t, f['b'], None)
            if mejor is None:
                continue
            t, i, f = mejor
            fin = 0.0
            if i is None:
                nodos.append([N[0] + ux * t, N[1] + uy * t])
                i = len(nodos) - 1
                fin = f['t'] / 2
            puente = dict(a=n, b=i, t=e['t'], h=e['h'], src={'tipo': e['src'].get('tipo')}, ab=[])
            hueco = t - fin
            if hueco >= 0.6:
                tipo = 'ventana' if _hay_vidrio(N, ux, uy, hueco, e['t'], vidrios) else 'paso'
                puente['ab'].append(dict(tipo=tipo, pos=hueco / 2, ancho=hueco))
            aristas.append(puente)
            _partir_en_t(aristas, nodos)
            hecho = True
            break
        if not hecho:
            return aristas


def importar(pdf, depurar=None):
    doc = fitz.open(pdf)
    edificios = {}
    ids = defaultdict(int)

    def nid(pref):
        ids[pref] += 1
        return f'{pref}{ids[pref]}'

    for H in HOJAS:
        page = doc[H['pag']]
        k = PT * H['escala']
        rec = fitz.Rect(H['recorte'])
        ox, oy = H.get('origen', H['recorte'][:2])
        tr = lambda x, y, ox=ox, oy=oy, k=k: ((x - ox) * k, (y - oy) * k)

        planta = dict(id=nid('p'), nombre=H['planta'], nivel=H['nivel'],
                      nodos={}, muros={}, pilares=[], espacios={}, elementos={},
                      calco=dict(origen=f"PAU 2026, hoja {H['pag'] + 1:02d}, escala 1/{H['escala']}",
                                 capas=calcos(page, rec, tr)))
        if H['muros']:
            pilares, Hm, Vm, arcos, vidrios = detectar_muros(page, rec, tr)
            nodos, aristas = construir_grafo(Hm, Vm)
            aristas = puertas_por_arcos(aberturas(aristas, nodos), nodos, arcos)
            sanear(aristas, nodos)
            cerrar_huecos(aristas, nodos, vidrios)
            sanear(aristas, nodos)
            aristas = puertas_por_arcos(aristas, nodos, arcos)
            mapa = {}
            usados = {i for e in aristas for i in (e['a'], e['b'])}
            for i, n in enumerate(nodos):
                if i in usados:
                    mapa[i] = nid('n')
                    planta['nodos'][mapa[i]] = dict(x=r2(n[0]), y=r2(n[1]))
            for e in aristas:
                planta['muros'][nid('m')] = dict(
                    a=mapa[e['a']], b=mapa[e['b']], grosor=r2(e['t']),
                    tipo=e['src'].get('tipo') or ('fachada' if e['t'] >= 0.25 else 'tabique'),
                    estado='importado',
                    aberturas=[dict(id=nid('h'), **o) for o in e['ab']])
            planta['pilares'] = [dict(x=r2(p[0]), y=r2(p[1]), an=r2(p[2] - p[0]), al=r2(p[3] - p[1]))
                                 for p in pilares]
            if depurar:
                dibujar_depuracion(page, rec, tr, planta, f"{depurar}/muros_p{H['pag']}.png")
        for r in (rotulos(page, rec, tr, k) if H['edificio'] != 'exterior' else []):
            planta['espacios'][nid('e')] = dict(nombre=r['nombre'], x=r['x'], y=r['y'], uso=uso_de(r['nombre']))

        ed = edificios.setdefault(H['edificio'], dict(id=H['edificio'], nombre=EDIFICIOS[H['edificio']], plantas=[]))
        ed['plantas'].append(planta)
        print(f"  hoja {H['pag'] + 1}: {ed['nombre']} · {H['planta']}: "
              f"{len(planta['muros'])} muros, {len(planta['pilares'])} pilares, "
              f"{len(planta['espacios'])} espacios", file=sys.stderr)

    return dict(formato='plano-cole', version=1,
                centro=dict(nombre='CEIPSO Filósofo Séneca', norte=-71),
                creado=date.today().isoformat(),
                edificios=list(edificios.values()))


def uso_de(nombre):
    n = nombre.upper()
    for clave, uso in (('ASEO', 'aseo'), ('ALMAC', 'almacen'), ('AULA', 'aula'), ('MÚSICA', 'aula'),
                       ('PLÁSTICA', 'aula'), ('INFORMÁTICA', 'aula'), ('LABORATORIO', 'aula'),
                       ('RELIGIÓN', 'aula'), ('LOGOPEDIA', 'aula'), ('TUTORIA', 'despacho'),
                       ('DESPACHO', 'despacho'), ('DIRECCI', 'despacho'), ('JEFE', 'despacho'),
                       ('SECRETAR', 'despacho'), ('CONSERJ', 'despacho'), ('TRABAJADOR', 'despacho'),
                       ('ENFERMER', 'despacho'), ('SALA DE PROF', 'despacho'), ('ASCENSOR', 'instalaciones'),
                       ('RACK', 'instalaciones'), ('CALDERAS', 'instalaciones'), ('ELECTR', 'instalaciones'),
                       ('PRESIÓN', 'instalaciones'), ('DEPÓSITO', 'instalaciones'), ('GIMNASIO', 'deporte'),
                       ('COMEDOR', 'comedor'), ('COCINA', 'comedor'), ('OFFICE', 'comedor'),
                       ('VESTUARIO', 'aseo'), ('BIBLIOTECA', 'aula'), ('AMPA', 'despacho')):
        if clave in n:
            return uso
    return 'otro'


def dibujar_depuracion(page, rec, tr, planta, ruta):
    from PIL import Image, ImageDraw
    S = 40  # px por metro
    W = int(rec.width * PT * 150 * S)
    Hh = int(rec.height * PT * 150 * S)
    pix = page.get_pixmap(clip=rec, matrix=fitz.Matrix(W / rec.width, Hh / rec.height))
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples).convert('RGB')
    im = Image.blend(im, Image.new('RGB', im.size, 'white'), 0.6)
    g = ImageDraw.Draw(im, 'RGBA')
    N = planta['nodos']
    for m in planta['muros'].values():
        A, B = N[m['a']], N[m['b']]
        g.line([(A['x'] * S, A['y'] * S), (B['x'] * S, B['y'] * S)], fill=(0, 90, 255, 160),
               width=max(2, int(m['grosor'] * S)))
        L = math.dist((A['x'], A['y']), (B['x'], B['y']))
        if L == 0:
            continue
        ux, uy = (B['x'] - A['x']) / L, (B['y'] - A['y']) / L
        for o in m['aberturas']:
            c0 = o['pos'] - o['ancho'] / 2
            c1 = o['pos'] + o['ancho'] / 2
            col = {'ventana': (0, 200, 220, 255), 'paso': (255, 160, 0, 255)}.get(o['tipo'], (230, 0, 120, 255))
            g.line([((A['x'] + ux * c0) * S, (A['y'] + uy * c0) * S), ((A['x'] + ux * c1) * S, (A['y'] + uy * c1) * S)],
                   fill=col, width=max(3, int(m['grosor'] * S) + 2))
    for n in N.values():
        g.ellipse([n['x'] * S - 3, n['y'] * S - 3, n['x'] * S + 3, n['y'] * S + 3], fill=(255, 0, 0, 255))
    for p in planta['pilares']:
        g.rectangle([p['x'] * S, p['y'] * S, (p['x'] + p['an']) * S, (p['y'] + p['al']) * S], outline=(0, 160, 0, 255), width=2)
    im.save(ruta)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf')
    ap.add_argument('salida')
    ap.add_argument('--depurar', help='carpeta donde dejar imágenes de comprobación')
    args = ap.parse_args()
    datos = importar(args.pdf, args.depurar)
    with open(args.salida, 'w', encoding='utf-8') as f:
        json.dump(datos, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Escrito {args.salida}', file=sys.stderr)


if __name__ == '__main__':
    main()
