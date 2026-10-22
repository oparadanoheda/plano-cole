# Plano del cole

App web instalable (PWA) para mantener el plano de un centro educativo. Tiene cuatro modos:
**Ver** (fichas de sala, búsqueda), **Editar** (muros que se mueven, puertas, ventanas, salas con
superficie calculada, versiones por obra), **Anotar** (tinta con presión para el Apple Pencil, rotulador,
textos, flechas y notas, por capas) y **3D**. Debajo puede ir la ortofoto PNOA, y también las capas del
Plan de Autoprotección. Funciona sin conexión en Windows (Edge/Chrome) y en iPad (Safari).

**El programa no lleva datos.** El plano vive en un archivo `.plano.json` que guarda cada
usuario en su equipo; la app solo lo abre y lo guarda en local (IndexedDB + el archivo).
Por eso este repositorio puede ser público sin exponer el plano del centro.

## Estructura

```
index.html              interfaz
css/app.css             estilos de la interfaz
js/main.js              arranque, estado, archivo, exportar e imprimir
js/modelo.js            documento y operaciones (nodos, muros, aberturas, espacios)
js/espacios.js          detección de salas (caras del grafo de muros) y superficie útil
js/vista.js             dibujo SVG (mundo en metros + capa de pantalla)
js/herramientas.js      ratón, dedo y lápiz: zoom, selección, arrastres, dibujo, ajustes
js/panel.js             panel de propiedades, capas y versiones
js/archivo.js           IndexedDB, abrir/guardar archivo, PNG
js/estilo.js            estilo del plano (también se incrusta en los SVG exportados)
js/satelite.js          ortofoto PNOA: teselas bajo el plano, georreferencia, mosaico para el 3D
js/anotar.js            modo Anotar: trazos con presión, rotulador, texto, flechas, borrador
js/tresd.js             modo 3D con Three.js (se carga solo al entrar en el modo)
vendor/                 Three.js 0.170.0 y OrbitControls (MIT, ver LICENSE-three.txt)
sw.js, manifest…        instalación y funcionamiento sin conexión (también cachea las teselas)
herramientas/importar_pau.py   importa los planos del PAU (PDF vectorial con capas)
```

Sin compilación: HTML, CSS y módulos JavaScript tal cual. La única dependencia es Three.js,
incluida en `vendor/` para que el 3D funcione sin conexión.

Créditos: ortofoto PNOA © Instituto Geográfico Nacional (CC BY 4.0), servida por su WMTS público
(`www.ign.es/wmts/pnoa-ma`). Three.js © autores de Three.js (MIT).

## Probar en local

```
python -m http.server 8931 --bind 127.0.0.1
```

y abrir `http://127.0.0.1:8931/`. (Con `file://` no funciona: los módulos y el service
worker necesitan un servidor.)

## Formato del archivo `.plano.json`

```
{ formato: "plano-cole", version: 1, centro: {nombre, norte},
  edificios: [ { id, nombre, plantas: [ { id, nombre, nivel,
      nodos:     { id: {x, y} },                        metros, y hacia abajo
      muros:     { id: {a, b, grosor, tipo, estado, notas, aberturas: [
                     {id, tipo, pos, ancho, lado, bisagra} ] } },
      pilares:   [ {x, y, an, al} ],
      espacios:  { id: {nombre, x, y, uso, grupo, notas} },   x,y = punto dentro de la sala
      elementos: { id: {tipo: "nota", x, y, texto, capa} },
      anotaciones: [ {id, capa, tipo: "trazo"|"texto"|"flecha", herr, color, ancho, puntos…} ],
      colocacion: {x, y, giro},                 de la planta al marco común del sitio
      altura,                                   de suelo a suelo, para el 3D
      calco:     { origen, capas: {arquitectura, pci, evacuacion, sectores} } } ] } ],
  sitio: { ancla: {x, y, lat, lon}, rumbo },    georreferencia; rumbo = hacia dónde mira el «arriba»
  capasAnotacion: [ {id, nombre, visible} ],
  versiones: [ {id, nombre, fecha, plantas: {plantaId: contenido}} ] }
```

- Los trazos guardan `[x, y, presión, …]` en metros.

- Los muros comparten nodos: mover un nodo arrastra todos los muros que llegan a él.
- `pos` de una abertura = distancia de su centro al nodo `a` del muro.
- Las salas no se guardan como polígono: se calculan a partir de los muros.

## Importar el Plan de Autoprotección

Requiere PyMuPDF (`pip install pymupdf`, probado con 1.28 y Python 3.14):

```
python herramientas/importar_pau.py "Planos_FILOSOFO SENECA_2026.pdf" seneca.plano.json
```

Las hojas, escalas y recortes están en la tabla `HOJAS` del propio script.
