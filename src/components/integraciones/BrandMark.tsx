/**
 * src/components/integraciones/BrandMark.tsx
 *
 * Sitio de la marca del servicio (Spotify o Ko-fi) dentro de una capa.
 *
 * Lalo no dibuja ni imita logotipos ajenos. Mientras no exista el archivo
 * oficial, el sitio muestra el nombre en texto dentro de un recuadro punteado.
 * Cuando quien administra Lalo añada el archivo oficial en
 *   public/marcas/spotify.svg   y   public/marcas/kofi.svg
 * el sitio lo carga solo y lo muestra tal cual, sin recortarlo ni recolorearlo.
 *
 * Normas de Spotify a tener en cuenta al elegir el archivo: el logotipo completo,
 * en un solo color (blanco) porque el fondo de las capas no es blanco ni negro
 * puros, y con 70 px de ancho como mínimo en pantalla.
 */

import React, { useEffect, useState } from 'react';

export type Brand = 'spotify' | 'kofi';

const BRANDS: Record<Brand, { name: string; src: string; title: string }> = {
  spotify: { name: 'Spotify', src: '/marcas/spotify.svg', title: 'Sitio del logotipo oficial de Spotify' },
  kofi: { name: 'Ko-fi', src: '/marcas/kofi.svg', title: 'Sitio de la marca de Ko-fi' },
};

// Se comprueba una vez por página si el archivo existe: sin él, el servidor devuelve otra cosa y la imagen falla
const probes = new Map<Brand, Promise<boolean>>();
function probe(brand: Brand): Promise<boolean> {
  let found = probes.get(brand);
  if (!found) {
    found = new Promise<boolean>((resolve) => {
      if (typeof Image === 'undefined') return resolve(false);
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0 || image.width > 0);
      image.onerror = () => resolve(false);
      image.src = BRANDS[brand].src;
    });
    probes.set(brand, found);
  }
  return found;
}

export const BrandMark: React.FC<{ brand: Brand; className: string }> = ({ brand, className }) => {
  const [hasFile, setHasFile] = useState(false);
  useEffect(() => {
    let alive = true;
    probe(brand).then((ok) => {
      if (alive) setHasFile(ok);
    });
    return () => {
      alive = false;
    };
  }, [brand]);

  const info = BRANDS[brand];
  return (
    <span className={className} data-file={hasFile ? '' : undefined} title={info.title}>
      {hasFile ? <img src={info.src} alt={info.name} /> : info.name}
    </span>
  );
};
