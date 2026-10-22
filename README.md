# Plano del cole

App web instalable (PWA) para mantener el plano de un centro educativo: muros que se pueden
mover, puertas, ventanas, espacios con superficie calculada, capas del Plan de Autoprotección
y versiones por obra. Funciona sin conexión en Windows (Edge/Chrome) y en iPad (Safari).

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
sw.js, manifest…        instalación y funcionamiento sin conexión
herramientas/importar_pau.py   importa los planos del PAU (PDF vectorial con capas)
```

Sin dependencias ni compilación: HTML, CSS y módulos JavaScript tal cual.

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
      elementos: { id: {tipo: "nota", x, y, texto} },
      calco:     { origen, capas: {arquitectura, pci, evacuacion, sectores} } } ] } ],
  versiones: [ {id, nombre, fecha, plantas: {plantaId: contenido}} ] }
```

- Los muros comparten nodos: mover un nodo arrastra todos los muros que llegan a él.
- `pos` de una abertura = distancia de su centro al nodo `a` del muro.
- Las salas no se guardan como polígono: se calculan a partir de los muros.

## Importar el Plan de Autoprotección

Requiere PyMuPDF (`pip install pymupdf`, probado con 1.28 y Python 3.14):

```
python herramientas/importar_pau.py "Planos_FILOSOFO SENECA_2026.pdf" seneca.plano.json
```

Las hojas, escalas y recortes están en la tabla `HOJAS` del propio script.
