// Estilo del dibujo. Se usa en la app y se incrusta en los SVG exportados,
// para que el plano se vea igual dentro y fuera.

export const CSS_PLANO = `
.muro { stroke: none; }
.muro-fachada { fill: #262b33; }
.muro-carga { fill: #3a404a; }
.muro-tabique { fill: #59616d; }
.muro-provisional { fill: url(#rayado); }
.pilar { fill: #1d2129; }
.aberturas path { fill: none; vector-effect: non-scaling-stroke; stroke-linecap: round; }
.ab-marco { stroke: #262b33; stroke-width: 1; }
.ab-vidrio { stroke: #3b7fc4; stroke-width: 1; }
.ab-hoja { stroke: #262b33; stroke-width: 1.5; }
.ab-arco { stroke: #7d8592; stroke-width: .9; stroke-dasharray: 3 2.5; }
.ab-paso { stroke: #9aa1ab; stroke-width: .9; stroke-dasharray: 4 3; }
.espacios path { stroke: none; }
.sel-muro { fill: rgba(36, 87, 214, .14); stroke: #2457d6; stroke-width: 2; vector-effect: non-scaling-stroke; }
.sel-abertura { fill: rgba(194, 65, 12, .14); stroke: #c2410c; stroke-width: 2; vector-effect: non-scaling-stroke; }
.sel-espacio { fill: rgba(36, 87, 214, .07); stroke: #2457d6; stroke-width: 2; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; }

.rej-menor { stroke: #efede6; stroke-width: 1; fill: none; }
.rej-mayor { stroke: #e2dfd5; stroke-width: 1; fill: none; }
.rotulo text { text-anchor: middle; paint-order: stroke; stroke: rgba(251, 251, 248, .9); stroke-width: 3.5px; stroke-linejoin: round; }
.r-nombre { font: 600 12px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; fill: #1d2330; letter-spacing: .01em; }
.r-sup { font: 11px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; fill: #6b7280; font-variant-numeric: tabular-nums; }
.rotulo.abierto .r-sup { fill: #c2410c; }
.rotulo.sel .r-nombre { fill: #2457d6; }
.nota circle { fill: #e08a0b; stroke: #fff; stroke-width: 2; }
.nota text { font: 700 12px system-ui, sans-serif; fill: #fff; text-anchor: middle; }
.nota .nota-t { fill: #7c3d06; text-anchor: start; font-weight: 600; paint-order: stroke; stroke: rgba(255, 255, 255, .9); stroke-width: 3.5px; }
.nota.sel circle { fill: #2457d6; }
.tirador { fill: #fff; stroke: #2457d6; stroke-width: 2; }
.tirador.activo { fill: #2457d6; }
.cota path { stroke: #2457d6; stroke-width: 1; fill: none; }
.cota text { font: 600 11.5px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #2457d6; text-anchor: middle; paint-order: stroke; stroke: #fff; stroke-width: 3.5px; stroke-linejoin: round; font-variant-numeric: tabular-nums; }
.cota-ab path { stroke: #b45309; }
.cota-ab text { fill: #b45309; }
.cota-viva path { stroke: #1d2330; }
.cota-viva text { fill: #1d2330; font-size: 12.5px; }
.dib-muro { stroke: rgba(36, 87, 214, .28); fill: none; stroke-linejoin: miter; }
.dib-eje { stroke: #2457d6; stroke-width: 1.5; fill: none; stroke-dasharray: 6 4; }
.snap { fill: none; stroke: #c2410c; stroke-width: 2; }
.snap-rejilla, .snap-eje { fill: #2457d6; stroke: #fff; stroke-width: 1.5; }
.snap-guia { fill: #2457d6; stroke: none; }
.guia { stroke: #2457d6; stroke-width: 1; stroke-dasharray: 2 4; fill: none; opacity: .7; }
.medida { stroke: #c2410c; stroke-width: 2; fill: none; }
.medida-p { fill: #fff; stroke: #c2410c; stroke-width: 2; }
.medida-t rect { fill: #1d2330; }
.medida-t text { font: 600 13px system-ui, sans-serif; fill: #fff; text-anchor: middle; font-variant-numeric: tabular-nums; }
.medida-t .medida-xy { font-size: 11px; font-weight: 500; fill: #c9ced8; }
.escala rect { fill: rgba(255, 255, 255, .92); stroke: #e3e1da; }
.escala path { stroke: #374151; stroke-width: 1.5; fill: none; }
.escala text { font: 600 11.5px system-ui, sans-serif; fill: #374151; }
.r-grupo { font: 600 11px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; fill: #2a5bd7; }
.hover-muro { fill: rgba(42, 91, 215, .10); stroke: #2a5bd7; stroke-width: 1.2; stroke-opacity: .55; vector-effect: non-scaling-stroke; pointer-events: none; }
.hover-espacio { fill: rgba(42, 91, 215, .07); stroke: #2a5bd7; stroke-width: 1.2; stroke-opacity: .4; vector-effect: non-scaling-stroke; pointer-events: none; }
.tinta.rotulador { fill: none; stroke-linecap: round; stroke-linejoin: round; mix-blend-mode: multiply; }
.tinta-texto { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-weight: 600; }
.sel-anot { fill: none; stroke: #2a5bd7; stroke-width: 1.5; stroke-dasharray: 5 4; vector-effect: non-scaling-stroke; }
.con-satelite .espacios path { opacity: .55; }
.con-satelite .rej-menor, .con-satelite .rej-mayor { stroke-opacity: .25; }
.contexto { opacity: .9; }
.letra-nodo { font: 700 11px system-ui, sans-serif; fill: #2457d6; text-anchor: middle; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
.suelto { fill: rgba(220, 38, 38, .12); stroke: #dc2626; stroke-width: 1.8; }
`;

/** Estilo para los planos exportados: rótulos en metros (escala de papel). */
export const CSS_EXPORT = CSS_PLANO + `
.ex-nombre { font: 600 0.34px system-ui, Arial, sans-serif; fill: #1d2330; text-anchor: middle; }
.ex-sup { font: 0.26px system-ui, Arial, sans-serif; fill: #6b7280; text-anchor: middle; }
.ex-nota { font: 600 0.3px system-ui, Arial, sans-serif; fill: #7c3d06; }
`;
