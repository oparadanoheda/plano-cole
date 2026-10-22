// Guardado: copia automática en el navegador (IndexedDB) y archivo .plano.json elegido por el usuario.
// Nada sale del dispositivo.

const BD = 'plano-cole';
const ALMACEN = 'kv';
let bd = null;

function abrirBD() {
  if (bd) return bd;
  bd = new Promise((ok, mal) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ALMACEN);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return bd;
}

export async function leerLocal(clave) {
  try {
    const db = await abrirBD();
    return await new Promise((ok, mal) => {
      const r = db.transaction(ALMACEN).objectStore(ALMACEN).get(clave);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
  } catch { return undefined; }
}

export async function guardarLocal(clave, valor) {
  const db = await abrirBD();
  await new Promise((ok, mal) => {
    const tx = db.transaction(ALMACEN, 'readwrite');
    tx.objectStore(ALMACEN).put(valor, clave);
    tx.oncomplete = ok;
    tx.onerror = () => mal(tx.error);
  });
}

const TIPOS = [{ description: 'Plano del cole', accept: { 'application/json': ['.json'] } }];
export const puedeGuardarEnSitio = 'showSaveFilePicker' in window;

/** Pide un archivo al usuario. Devuelve {texto, nombre, manejador} o null. */
export async function pedirArchivo() {
  if ('showOpenFilePicker' in window) {
    try {
      const [h] = await window.showOpenFilePicker({ types: TIPOS, multiple: false });
      const f = await h.getFile();
      return { texto: await f.text(), nombre: f.name, manejador: h };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((ok) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.json,application/json';
    i.onchange = async () => {
      const f = i.files[0];
      ok(f ? { texto: await f.text(), nombre: f.name, manejador: null } : null);
    };
    i.click();
  });
}

export async function leerArchivoSoltado(f) {
  return { texto: await f.text(), nombre: f.name, manejador: null };
}

/** Escribe el plano. Con manejador (Edge/Chrome) sobrescribe el mismo archivo;
 *  en el iPad abre «Compartir» para guardarlo en Archivos, OneDrive…, o lo descarga. */
export async function escribirArchivo(texto, nombre, manejador, comoNuevo) {
  if (puedeGuardarEnSitio) {
    let h = comoNuevo ? null : manejador;
    try {
      if (!h) h = await window.showSaveFilePicker({ suggestedName: nombre, types: TIPOS });
      if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return null;
      }
      const w = await h.createWritable();
      await w.write(texto);
      await w.close();
      return { manejador: h, nombre: h.name, modo: 'archivo' };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }
  const blob = new Blob([texto], { type: 'application/json' });
  const file = new File([blob], nombre, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nombre });
      return { manejador: null, nombre, modo: 'compartido' };
    } catch (e) {
      if (e.name === 'AbortError') return null;
    }
  }
  descargar(blob, nombre);
  return { manejador: null, nombre, modo: 'descarga' };
}

export function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/** Convierte un SVG (texto) en PNG. */
export async function svgAPng(svgTexto, ancho, alto) {
  const url = URL.createObjectURL(new Blob([svgTexto], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, mal) => { img.onload = ok; img.onerror = () => mal(new Error('No se pudo dibujar el SVG')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = ancho;
    c.height = alto;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, ancho, alto);
    g.drawImage(img, 0, 0, ancho, alto);
    return await new Promise((ok) => c.toBlob(ok, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
