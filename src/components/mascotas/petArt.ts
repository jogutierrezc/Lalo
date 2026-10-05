/**
 * src/components/mascotas/petArt.ts
 *
 * El dibujo de los personajes de Lalo, como texto SVG. Todo es contenido fijo
 * de este archivo: aquí no entra nada del chat, de Twitch ni de los ajustes.
 *
 * - Lienzo de 200 × 200. Tinta gruesa, color plano, una sombra y una luz: las
 *   clases (.b, .bs, .bl, .o...) están en styles/mascotas.css, bajo .pt-svg.
 * - El color sale de --pt-c; la sombra y la luz se mezclan a partir de él.
 * - Las partes que la capa anima llevan data-p (body, arm, tail, antenna...).
 * - La cara va aparte, en <g data-p="face">: son los mismos trazos en los cinco
 *   personajes y cambian con la emoción. `.pt-e` son los ojos (parpadean) y
 *   `.pt-m` la boca (se mueve con la voz).
 */

import type { PetEmotion, PetKind } from '../../types/pets';

export type PetArtKind = Exclude<PetKind, 'custom'>;

const star = (x: number, y: number, s: number): string =>
  `<path class="bl" style="stroke:var(--pt-ink);stroke-width:2.5;stroke-linejoin:round" d="M${x} ${y - s}l${s * 0.3} ${s * 0.7} ${s * 0.7} ${s * 0.3}-${s * 0.7} ${s * 0.3}-${s * 0.3} ${s * 0.7}-${s * 0.3}-${s * 0.7}-${s * 0.7}-${s * 0.3} ${s * 0.7}-${s * 0.3}z"/>`;

const ART: Record<PetArtKind, (face: string) => string> = {
  chispa: (face) => `
    <ellipse class="sh" cx="100" cy="190" rx="44" ry="7"/>
    <g data-p="sparks">${star(162, 48, 10)}${star(32, 76, 7)}</g>
    <g data-p="body">
      <ellipse class="b o" cx="42" cy="130" rx="11" ry="7.5" transform="rotate(-28 42 130)"/>
      <g data-p="arm"><ellipse class="b o" cx="160" cy="114" rx="11" ry="7.5" transform="rotate(38 160 114)"/></g>
      <path class="b o" d="M100 20C112 46 152 62 152 112c0 42-23 66-52 66s-52-24-52-64c0-24 12-36 20-52 6 14 14 18 18 10 4-14 6-34 14-52z"/>
      <path class="bs" d="M152 112c0 42-23 66-52 66-10 0-19-3-27-8 34 4 62-18 62-56 0-14-3-26-8-36 14 10 25 20 25 34z"/>
      <path class="bl" d="M100 76c13 18 31 30 31 54 0 22-13 36-31 36s-31-14-31-34c0-24 20-36 31-56z"/>
      <ellipse class="blush" cx="72" cy="143" rx="8" ry="5"/><ellipse class="blush" cx="128" cy="143" rx="8" ry="5"/>
      <g data-p="face">${face}</g>
    </g>`,
  eco: (face) => `
    <ellipse class="sh" cx="84" cy="191" rx="34" ry="6"/>
    <g data-p="waves"><g><path class="ln" style="stroke-width:10" d="M170 30q14 8 16 24"/><path class="ln" style="stroke:var(--pt-c);stroke-width:4" d="M170 30q14 8 16 24"/></g><g><path class="ln" style="stroke-width:10" d="M178 14q24 12 22 42"/><path class="ln" style="stroke:var(--pt-c);stroke-width:4" d="M178 14q24 12 22 42"/></g></g>
    <g data-p="body">
      <ellipse class="b o" cx="28" cy="112" rx="10" ry="7" transform="rotate(-24 28 112)"/>
      <g data-p="arm"><ellipse class="b o" cx="172" cy="104" rx="10" ry="7" transform="rotate(32 172 104)"/></g>
      <path class="b o" d="M72 34h56c26 0 42 18 42 44v26c0 26-16 44-42 44h-28l-34 32 6-32c-26 0-42-18-42-44V78c0-26 16-44 42-44z"/>
      <path class="bs" d="M170 78v26c0 26-16 44-42 44h-28l-9 8c40 0 64-16 66-48 1-20-2-40-10-56 14 4 23 14 23 26z"/>
      <ellipse class="w" opacity=".4" cx="64" cy="58" rx="15" ry="8" transform="rotate(-28 64 58)"/>
      <ellipse class="blush" cx="62" cy="108" rx="8" ry="5"/><ellipse class="blush" cx="138" cy="108" rx="8" ry="5"/>
      <g data-p="face">${face}</g>
    </g>`,
  bit: (face) => `
    <ellipse class="sh" cx="100" cy="192" rx="46" ry="7"/>
    <path class="t-o" d="M86 166v10M114 166v10"/><path class="t-s" d="M86 166v10M114 166v10"/>
    <rect class="bs o" x="72" y="178" width="28" height="12" rx="6"/><rect class="bs o" x="100" y="178" width="28" height="12" rx="6"/>
    <g data-p="body">
      <path class="t-o" d="M68 150q-22 2-26 20"/><path class="t-b" d="M68 150q-22 2-26 20"/><circle class="b o" cx="42" cy="172" r="8"/>
      <g data-p="arm"><path class="t-o" d="M132 150q28 2 36-14"/><path class="t-b" d="M132 150q28 2 36-14"/><circle class="b o" cx="168" cy="136" r="8"/></g>
      <rect class="bs o" x="68" y="134" width="64" height="38" rx="13"/>
      <circle class="gl o" cx="100" cy="153" r="6.5"/>
      <g data-p="antenna"><path class="ln" style="stroke-width:11" d="M100 36V18"/><path class="ln" style="stroke:color-mix(in srgb, var(--pt-c) 74%, var(--pt-ink));stroke-width:4" d="M100 36V18"/><circle class="o" style="fill:var(--pt-blush)" cx="100" cy="13" r="8"/></g>
      <rect class="bs o" x="24" y="66" width="14" height="32" rx="6"/><rect class="bs o" x="162" y="66" width="14" height="32" rx="6"/>
      <rect class="b o" x="34" y="34" width="132" height="102" rx="26"/>
      <rect class="scr o" x="50" y="49" width="100" height="72" rx="14"/>
      <path class="w" opacity=".12" d="M64 51h26L70 119H54q-2 0-2-2V64q0-12 12-13z"/>
      <ellipse class="blush" cx="64" cy="103" rx="6" ry="3.5"/><ellipse class="blush" cx="136" cy="103" rx="6" ry="3.5"/>
      <g data-p="face">${face}</g>
    </g>`,
  miso: (face) => `
    <ellipse class="sh" cx="100" cy="190" rx="54" ry="7"/>
    <g data-p="tail"><path class="t-o" d="M150 166c34 2 40-34 20-48"/><path class="t-b" d="M150 166c34 2 40-34 20-48"/></g>
    <g data-p="body">
      <path class="ln" style="stroke-width:15" d="M36 114C36 32 164 32 164 114"/><path fill="none" stroke="var(--pt-paper)" stroke-width="5" stroke-linecap="round" d="M36 114C36 32 164 32 164 114"/>
      <g data-p="ear"><path class="b o" d="M50 88l6-50 34 26z"/><path style="fill:var(--pt-blush)" d="M60 76l3-24 16 13z"/></g>
      <path class="b o" d="M150 88l-6-50-34 26z"/><path style="fill:var(--pt-blush)" d="M140 76l-3-24-16 13z"/>
      <path class="b o" d="M38 122c0-42 28-62 62-62s62 20 62 62c0 38-22 58-62 58s-62-20-62-58z"/>
      <path class="bs" d="M162 122c0 38-22 58-62 58-14 0-26-3-36-8 44 6 80-12 82-52 1-12-2-24-7-34 11 12 21 28 21 36z"/>
      <ellipse class="bl" cx="100" cy="158" rx="28" ry="17"/>
      <rect class="w o" x="22" y="100" width="24" height="42" rx="11"/><rect class="w o" x="154" y="100" width="24" height="42" rx="11"/>
      <path class="ln" d="M34 142c2 12 14 14 28 10"/><circle class="k" cx="66" cy="151" r="5.5"/>
      <path class="ln" style="stroke-width:3" d="M142 124l12-3M142 131l12 4"/>
      <ellipse class="blush" cx="64" cy="130" rx="7" ry="4.5"/><ellipse class="blush" cx="136" cy="130" rx="7" ry="4.5"/>
      <path style="fill:var(--pt-blush)" d="M95 124h10l-5 6z"/>
      <g data-p="face">${face}</g>
      <ellipse class="b o" cx="78" cy="176" rx="15" ry="9"/><ellipse class="b o" cx="122" cy="176" rx="15" ry="9"/>
      <path class="ln" style="stroke-width:3" d="M74 172v6M82 172v6M118 172v6M126 172v6"/>
    </g>`,
  axo: (face) => `
    <ellipse class="sh" cx="104" cy="191" rx="50" ry="6.5"/>
    <g data-p="tail"><path class="t-o" d="M124 168c26 8 46-4 52-26"/><path class="t-b" d="M124 168c26 8 46-4 52-26"/></g>
    <g data-p="body">
      <ellipse class="b o" cx="84" cy="181" rx="12" ry="7"/><ellipse class="b o" cx="116" cy="181" rx="12" ry="7"/>
      <ellipse class="b o" cx="100" cy="158" rx="32" ry="24"/>
      <ellipse class="bl" cx="100" cy="164" rx="18" ry="13"/>
      <ellipse class="b o" cx="66" cy="154" rx="9" ry="6" transform="rotate(-34 66 154)"/>
      <g data-p="arm"><ellipse class="b o" cx="134" cy="154" rx="9" ry="6" transform="rotate(34 134 154)"/></g>
      <g data-p="gl"><path class="t-o" d="M48 82L22 58M42 100H12M48 118l-26 20"/><path class="t-s" d="M48 82L22 58M42 100H12M48 118l-26 20"/></g>
      <g data-p="gr"><path class="t-o" d="M152 82l26-24M158 100h30M152 118l26 20"/><path class="t-s" d="M152 82l26-24M158 100h30M152 118l26 20"/></g>
      <path class="b o" d="M36 102c0-30 28-48 64-48s64 18 64 48-28 46-64 46-64-16-64-46z"/>
      <path class="bs" d="M164 102c0 30-28 46-64 46-13 0-25-2-35-6 42 3 80-10 84-40 1-10-1-20-6-28 11 8 21 18 21 28z"/>
      <ellipse class="w" opacity=".4" cx="68" cy="74" rx="15" ry="7" transform="rotate(-20 68 74)"/>
      <ellipse class="blush" cx="58" cy="116" rx="8" ry="5"/><ellipse class="blush" cx="142" cy="116" rx="8" ry="5"/>
      <g data-p="face">${face}</g>
    </g>`,
};

interface FaceBox {
  /** Centro de cada ojo y su altura. */
  x1: number;
  x2: number;
  ey: number;
  /** Centro de la boca. */
  mx: number;
  my: number;
  /** Tamaño de los rasgos respecto al de serie. */
  k: number;
  /** Cara de luz sobre una pantalla (Bit), en vez de tinta. */
  glow?: boolean;
}

const FACES: Record<PetArtKind, FaceBox> = {
  chispa: { x1: 84, x2: 116, ey: 124, mx: 100, my: 142, k: 1 },
  eco: { x1: 78, x2: 122, ey: 88, mx: 100, my: 110, k: 1.08 },
  bit: { x1: 78, x2: 122, ey: 80, mx: 100, my: 102, k: 1, glow: true },
  miso: { x1: 78, x2: 122, ey: 112, mx: 100, my: 133, k: 1 },
  axo: { x1: 70, x2: 130, ey: 98, mx: 100, my: 110, k: 0.9 },
};

const n = (value: number): number => Math.round(value * 10) / 10;

/** La cara de un personaje con una emoción: cejas (si las hay), ojos y boca. */
export function petFaceMarkup(kind: PetArtKind, emotion: PetEmotion = 'neutral'): string {
  const f = FACES[kind];
  const { x1, x2, ey, mx, my, k } = f;
  const both = (draw: (x: number) => string): string => draw(x1) + draw(x2);
  // Ceja: de fuera hacia dentro; `outer` e `inner` son la altura de cada extremo sobre el ojo
  const brow = (x: number, side: number, outer: number, inner: number, cls: string, width: number): string =>
    `<path class="${cls}" style="stroke-width:${width}" d="M${n(x - side * 11 * k)} ${n(ey - outer * k)}L${n(x + side * 9 * k)} ${n(ey - inner * k)}"/>`;
  const brows = (outer: number, inner: number, cls: string, width: number): string =>
    `<g data-p="brow">${brow(x1, 1, outer, inner, cls, width)}${brow(x2, -1, outer, inner, cls, width)}</g>`;

  if (f.glow) {
    const rect = (x: number, w: number, h: number, dy = 0): string =>
      `<rect class="gl" x="${n(x - w / 2)}" y="${n(ey - h / 2 + dy)}" width="${w}" height="${h}" rx="${n(Math.min(w, h) / 2.4)}"/>`;
    const eyes: Record<PetEmotion, string> = {
      neutral: both((x) => rect(x, 15, 22)),
      feliz: both((x) => `<path class="gls" d="M${x - 9} ${ey + 4}q9 -14 18 0"/>`),
      emocionado: both((x) => rect(x, 19, 27)) + both((x) => `<circle class="scr" cx="${x + 3}" cy="${ey - 6}" r="3"/>`),
      triste: both((x) => rect(x, 15, 14, 5)),
      enojado: both((x) => rect(x, 16, 15, 4)),
      sorprendido: both((x) => `<circle class="gls" style="stroke-width:5" cx="${x}" cy="${ey}" r="9"/>`),
    };
    const extra = emotion === 'triste' ? brows(13, 20, 'gls', 4) : emotion === 'enojado' ? brows(18, 9, 'gls', 5) : '';
    const mouth: Record<PetEmotion, string> = {
      neutral: `<rect class="gl" x="${mx - 13}" y="${my - 4}" width="26" height="8" rx="4"/>`,
      feliz: `<path class="gls" d="M${mx - 13} ${my - 4}q13 13 26 0"/>`,
      emocionado: `<path class="gl" d="M${mx - 13} ${my - 6}h26q0 16-13 16t-13-16z"/>`,
      triste: `<path class="gls" d="M${mx - 11} ${my + 5}q11 -11 22 0"/>`,
      enojado: `<path class="gls" style="stroke-width:5" d="M${mx - 14} ${my + 3}l7-6 7 6 7-6 7 6"/>`,
      sorprendido: `<circle class="gls" style="stroke-width:5" cx="${mx}" cy="${my}" r="6"/>`,
    };
    return `${extra}<g class="pt-e">${eyes[emotion]}</g><g class="pt-m">${mouth[emotion]}</g>`;
  }

  const eye = (x: number, rx: number, ry: number, dy = 0): string =>
    `<ellipse class="k" cx="${x}" cy="${n(ey + dy)}" rx="${n(rx * k)}" ry="${n(ry * k)}"/><circle class="w" cx="${n(x + 3 * k)}" cy="${n(ey + dy - 4 * k)}" r="${n(3.2 * k)}"/>`;
  const eyes: Record<PetEmotion, string> = {
    neutral: both((x) => eye(x, 8.5, 10.5)),
    feliz: both((x) => `<path class="ln" style="stroke-width:5" d="M${n(x - 9 * k)} ${n(ey + 4 * k)}q${n(9 * k)} ${n(-14 * k)} ${n(18 * k)} 0"/>`),
    emocionado: both((x) => eye(x, 10.5, 12.5) + `<circle class="w" cx="${n(x - 4 * k)}" cy="${n(ey + 5 * k)}" r="${n(1.9 * k)}"/>`),
    triste: both((x) => eye(x, 7.5, 9, 2)),
    enojado: both((x) => eye(x, 8.5, 9.5, 1)),
    sorprendido: both(
      (x) => `<circle class="w" style="stroke:var(--pt-ink);stroke-width:4" cx="${x}" cy="${ey}" r="${n(10 * k)}"/><circle class="k" cx="${x}" cy="${ey}" r="${n(4 * k)}"/>`
    ),
  };
  const tear = `<path class="gl" style="stroke:var(--pt-ink);stroke-width:2.5" d="M${n(x2 + 13 * k)} ${n(ey + 8 * k)}q6 9 0 13-6-4 0-13z"/>`;
  const extra = emotion === 'triste' ? brows(13, 20, 'ln', 4.5) + tear : emotion === 'enojado' ? brows(20, 10, 'ln', 5.5) : '';
  const tongue = (dy: number): string => `<path style="fill:var(--pt-blush)" d="M${mx - 6} ${my + dy}q6 5 12 0-6-5-12 0z"/>`;
  const mouth: Record<PetEmotion, string> = {
    neutral: `<path class="k" d="M${mx - 10} ${my}q10 13 20 0z"/>`,
    feliz: `<path class="k" d="M${mx - 13} ${my - 1}q13 20 26 0z"/>${tongue(7)}`,
    emocionado: `<path class="k" d="M${mx - 12} ${my - 3}h24q0 21-12 21t-12-21z"/>${tongue(11)}`,
    triste: `<path class="ln" style="stroke-width:4.5" d="M${mx - 9} ${my + 9}q9 -11 18 0"/>`,
    enojado: `<path class="k" d="M${mx - 11} ${my + 10}q11 -15 22 0z"/>`,
    sorprendido: `<ellipse class="k" cx="${mx}" cy="${my + 5}" rx="6" ry="8"/>`,
  };
  return `${extra}<g class="pt-e">${eyes[emotion]}</g><g class="pt-m">${mouth[emotion]}</g>`;
}

/** El interior del <svg> de un personaje, con la cara de esa emoción. */
export function petMarkup(kind: PetArtKind, emotion: PetEmotion = 'neutral'): string {
  return ART[kind](petFaceMarkup(kind, emotion));
}
