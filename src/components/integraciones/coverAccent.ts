/**
 * src/components/integraciones/coverAccent.ts
 *
 * Color de acento tomado de la portada: el tono vivo que más pesa en la imagen,
 * aclarado lo justo para leerse sobre el fondo oscuro de la capa.
 *
 * La portada que se ve en pantalla no se toca: aquí se carga una copia aparte y
 * pequeña solo para leer sus colores. Si el servidor de imágenes no deja leerla
 * (sin permiso CORS) o algo falla, devuelve null y la capa usa el color fijo.
 */

const cache = new Map<string, Promise<string | null>>();

/** Elige el color a partir de los píxeles (r, g, b, a seguidos). */
export function pickAccent(pixels: ArrayLike<number>): string | null {
  // Doce franjas de tono; gana la que suma más saturación
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (pixels[i + 3] < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (max < 60 || delta < 40) continue;
    let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    if (hue < 0) hue += 6;
    const bin = bins[Math.min(11, Math.floor(hue * 2))];
    const weight = delta / 255;
    bin.weight += weight;
    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
  }
  const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (best.weight <= 0) return null;
  let [r, g, b] = [best.r / best.weight, best.g / best.weight, best.b / best.weight];
  // Sobre fondo casi negro hace falta un color claro: se sube hasta que el canal mayor llegue a 235
  const lift = 235 / Math.max(r, g, b);
  if (lift > 1) [r, g, b] = [r * lift, g * lift, b * lift];
  const hex = (value: number) => Math.round(Math.min(255, value)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function coverAccent(url: string): Promise<string | null> {
  let found = cache.get(url);
  if (found) return found;
  found = new Promise<string | null>((resolve) => {
    try {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onerror = () => resolve(null);
      image.onload = () => {
        try {
          const size = 24;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve(null);
          ctx.drawImage(image, 0, 0, size, size);
          resolve(pickAccent(ctx.getImageData(0, 0, size, size).data));
        } catch {
          resolve(null);
        }
      };
      image.src = url;
    } catch {
      resolve(null);
    }
  });
  cache.set(url, found);
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  return found;
}
