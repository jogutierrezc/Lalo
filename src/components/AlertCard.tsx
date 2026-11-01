/**
 * AlertCard.tsx
 *
 * Tarjeta de alerta TTS en sus siete estilos: Cabina, Bocadillo, Subtítulo,
 * Sticker y los tres pixel art (Arcade, Aventura y Diálogo). Solo dibuja; el movimiento vive en utils/alertMotion.ts y actúa sobre
 * los atributos data-al. La usan el widget de OBS y la vista previa del panel.
 */

import React, { forwardRef } from 'react';
import { AlertPosition, AlertStyle, inkFor, normalizeAccent, stickerDataUri } from '../utils/appearance';
import {
  ARROW,
  GEM,
  GEM_STOPS,
  GROUND,
  HERO_A,
  HERO_B,
  HILLS_FAR,
  HILLS_NEAR,
  INV_A,
  INV_B,
  PAL_ARROW,
  PAL_GEM,
  PAL_HERO,
  PAL_INVADER,
  PAL_ROBOT,
  PAL_STAR,
  PINES,
  PixelPalette,
  PixelRect,
  ROBOT_C,
  ROBOT_O,
  SKYLINE_H,
  SKYLINE_W,
  STAR,
  skyStars,
  skylineRects,
  spriteRects,
  spriteSize,
} from '../utils/pixelSprites';

export interface AlertCardProps {
  alertStyle: AlertStyle;
  position: AlertPosition;
  accent: string;
  name: string;
  text: string;
  emotionLabel?: string | null;
  emotionTag?: string | null;
  userColor?: string;
  stickerSvg?: string;
  loading?: boolean;
  fontSize: string; // tamaño base; todo lo demás está en em
}

/**
 * Descompone el mensaje en palabras y etiquetas [expresión] preparadas para la
 * animación escalonada de GSAP (.msg-word).
 */
function renderMessageContent(text: string) {
  const tokens = text.split(/(\[[a-zA-ZáéíóúÁÉÍÓÚñÑ\s-_]{2,30}\]|\s+)/g);
  return tokens.map((token, index) => {
    if (!token) return null;
    if (/^\s+$/.test(token)) return token;
    const isTag = token.startsWith('[') && token.endsWith(']');
    return (
      <span key={index} className={isTag ? 'msg-word al-tagword' : 'msg-word'}>
        {token}
      </span>
    );
  });
}

/**
 * Igual que renderMessageContent pero por carácter, para la máquina de escribir
 * del estilo Diálogo. Cada palabra es un .wd (no se parte al saltar de línea) y
 * cada carácter un .ch; una etiqueta [expresión] es un único .ch.
 */
function renderTypedContent(text: string) {
  const tokens = text.split(/(\[[a-zA-ZáéíóúÁÉÍÓÚñÑ\s-_]{2,30}\]|\s+)/g);
  return tokens.map((token, index) => {
    if (!token) return null;
    if (/^\s+$/.test(token)) return token;
    if (token.startsWith('[') && token.endsWith(']')) {
      return (
        <span key={index} className="wd">
          <span className="ch al-tagword" data-al="ch">
            {token}
          </span>
        </span>
      );
    }
    return (
      <span key={index} className="wd">
        {Array.from(token).map((char, i) => (
          <span key={i} className="ch" data-al="ch">
            {char}
          </span>
        ))}
      </span>
    );
  });
}

function sizeFor(length: number): 's' | 'm' | 'l' | 'xl' {
  if (length > 650) return 'xl';
  if (length > 350) return 'l';
  if (length > 150) return 'm';
  return 's';
}

// ---------- Piezas de los estilos pixel ----------
// Las medidas van en var(--u), que vale 1/16 del tamaño base de la tarjeta: así el
// diseño pixel (pensado a 16 px) crece con la escala del widget.
const px = (n: number) => `calc(${n} * var(--u))`;

function PixelRects({ rects }: { rects: PixelRect[] }) {
  return (
    <>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} style={{ fill: r.fill }} />
      ))}
    </>
  );
}

/** Sprite de píxeles: cada celda de la cuadrícula mide `size` píxeles del diseño. */
function Sprite({ rows, palette, size, className, dataAl }: { rows: string[]; palette: PixelPalette; size: number; className?: string; dataAl?: string }) {
  const { w, h } = spriteSize(rows);
  return (
    <svg
      className={className ? `sp ${className}` : 'sp'}
      data-al={dataAl}
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: px(w * size), height: px(h * size) }}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <PixelRects rects={spriteRects(rows, palette)} />
    </svg>
  );
}

/** Capa de escenario (colinas, pinos, suelo) pegada al borde inferior de la escena. */
function Layer({ w, h, rects, bottom }: { w: number; h: number; rects: PixelRect[]; bottom: number }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ left: 0, bottom: px(bottom), width: px(w), height: px(h) }} shapeRendering="crispEdges" aria-hidden="true">
      <PixelRects rects={rects} />
    </svg>
  );
}

// Dibujos de fondo calculados una sola vez
const SKYLINE = skylineRects();
const SKY_STARS = skyStars();

const SoundArcs = () => (
  <svg className="alb-arcs" viewBox="0 0 24 24" aria-hidden="true">
    {['M4 16a6 6 0 0 0 0-8', 'M10 20a12 12 0 0 0 0-16', 'M16 24a18 18 0 0 0 0-24'].map((d) => (
      <g key={d} data-al="arc">
        <path className="alb-arc-ink" d={d} />
        <path d={d} />
      </g>
    ))}
  </svg>
);

const Wave = () => (
  <span className="al-wave" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((i) => (
      <i key={i} data-al="wave" />
    ))}
  </span>
);

export const AlertCard = forwardRef<HTMLDivElement, AlertCardProps>(function AlertCard(
  { alertStyle, position, accent, name, text, emotionLabel, emotionTag, userColor, stickerSvg, loading, fontSize },
  ref
) {
  const safeAccent = normalizeAccent(accent) || '#9146ff';
  const avatarColor = normalizeAccent(userColor) || safeAccent;
  const avatarStyle: React.CSSProperties = { backgroundColor: avatarColor, color: inkFor(avatarColor) };
  const initial = (name || 'U').charAt(0).toUpperCase();
  const rootStyle = { fontSize, '--u': `calc(${fontSize} / 16)`, '--acc': safeAccent, '--acc-ink': inkFor(safeAccent) } as React.CSSProperties;
  const extra = loading ? 'Preparando voz' : emotionLabel || '';

  // Los estilos con diálogo escriben el mensaje carácter a carácter; los demás lo muestran por palabras.
  const typed = alertStyle === 'dialogo' || alertStyle === 'arcadeDialogo' || alertStyle === 'aventuraDialogo';
  const look = alertStyle === 'arcadeDialogo' ? 'arcade' : alertStyle === 'aventuraDialogo' ? 'aventura' : alertStyle;
  const msgClass = look === 'arcade' ? ' ax-msg' : look === 'aventura' ? ' av-msg' : look === 'dialogo' ? ' rp-msg' : '';
  const message = (
    <div className="al-text" data-al="text">
      <p className={`al-msg${msgClass}`}>{typed ? renderTypedContent(text) : renderMessageContent(text)}</p>
    </div>
  );
  const status = loading ? <span className="al-status">Preparando voz</span> : null;

  return (
    <div
      ref={ref}
      className={look === alertStyle ? `al al-${alertStyle}` : `al al-${alertStyle} al-${look}`}
      data-pos={position}
      data-size={sizeFor(text.length)}
      data-emo={emotionTag || undefined}
      style={rootStyle}
    >
      {alertStyle === 'cabina' && (
        <>
          <div className="alc-top">
            <span className="alc-tally">
              <i data-al="tally" />
              Al aire
            </span>
            {status}
            {emotionLabel && <span className="alc-emo">{emotionLabel}</span>}
          </div>
          <div className="alc-body">
            <div className="alc-avatar" data-al="avatar" style={avatarStyle}>
              {initial}
            </div>
            <div className="alc-main">
              <p className="alc-name">{name}</p>
              {message}
            </div>
            <div className="alc-vu" aria-hidden="true">
              <span>
                <b data-al="vu" />
              </span>
              <span>
                <b data-al="vu" />
              </span>
            </div>
          </div>
          <div className="alc-prog">
            <i data-al="prog" />
          </div>
        </>
      )}

      {alertStyle === 'bocadillo' && (
        <>
          <div className="alb-avatar" data-al="avatar" style={avatarStyle}>
            {initial}
            <SoundArcs />
          </div>
          <div className="alb-balloon" data-al="balloon">
            <svg className="alb-tail" viewBox="0 0 20 22" aria-hidden="true">
              <path d="M20 2C12 6 6 14 1.5 20 9 20 15 18 20 14" fill="#fff" stroke="#1d1a3a" strokeWidth="3.2" strokeLinejoin="round" />
            </svg>
            <span className="alb-tag alb-name" data-al="tag">
              {name}
            </span>
            {(emotionLabel || loading) && (
              <span className="alb-tag alb-emo" data-al="tag">
                {loading ? 'Preparando voz' : emotionLabel}
              </span>
            )}
            {message}
          </div>
        </>
      )}

      {alertStyle === 'subtitulo' && (
        <>
          <div className="als-chip" data-al="chip">
            <span className="als-dot" style={avatarStyle}>
              {initial}
            </span>
            <span className="als-name">{name}</span>
            {emotionLabel && <span className="als-emo">{emotionLabel}</span>}
            {status}
            <Wave />
          </div>
          {message}
        </>
      )}

      {alertStyle === 'sticker' && (
        <>
          <div className="alk-sticker" data-al="sticker">
            {stickerSvg ? <img src={stickerDataUri(stickerSvg)} alt="" /> : <span style={avatarStyle}>{initial}</span>}
          </div>
          <div className="alk-plate" data-al="plate">
            <div className="alk-top">
              <span className="alk-name">{name}</span>
              {emotionLabel && <span className="alk-emo">{emotionLabel}</span>}
              {status}
              <Wave />
            </div>
            {message}
          </div>
        </>
      )}

      {look === 'arcade' && (
        <div className="ax-frame">
          <div className="ax-pl" data-al="deco">
            <i />
            <i />
          </div>
          <div className="ax-chip" data-al="deco" />
          <div className="ax-yel" data-al="deco" />
          <div className="ax-head">
            <div className="ax-inv" data-al="inv">
              <Sprite rows={INV_A} palette={PAL_INVADER} size={5} className="fa" dataAl="fa" />
              <Sprite rows={INV_B} palette={PAL_INVADER} size={5} className="fb" dataAl="fb" />
            </div>
            <p className="ax-tag" data-al="tag">
              {extra ? `NUEVO MENSAJE · ${extra}` : 'NUEVO MENSAJE'}
            </p>
          </div>
          <div className="ax-bar" data-al="bar">
            <div className="ax-bks">
              {['tl', 'tr', 'bl', 'br'].map((c) => (
                <i key={c} className={c} data-al="bk" />
              ))}
            </div>
            <div className="ax-sky">
              <svg viewBox={`0 0 ${SKYLINE_W} ${SKYLINE_H}`} style={{ width: px(SKYLINE_W), height: px(SKYLINE_H) }} shapeRendering="crispEdges" aria-hidden="true">
                <PixelRects rects={SKYLINE} />
              </svg>
            </div>
            {['a', 'b', 'c', 'd'].map((c) => (
              <i key={c} className={`ax-pip ${c}`} data-al="pip" />
            ))}
            <p className="ax-name" data-al="name">
              {name}
            </p>
            {message}
            {typed && (
              <span className="rp-next" data-al="next">
                <Sprite rows={ARROW} palette={PAL_ARROW} size={3} />
              </span>
            )}
            <div className="ax-star" data-al="star2">
              <Sprite rows={STAR} palette={PAL_STAR} size={4} />
            </div>
          </div>
        </div>
      )}

      {look === 'aventura' && (
        <div className="av-frame">
          <div className="av-sky" aria-hidden="true">
            {SKY_STARS.map((star, i) => (
              <i key={i} data-al="star" className={star.small ? 's' : undefined} style={{ left: `${star.left}%`, top: `${star.top}%` }} />
            ))}
          </div>
          <div className="av-top">
            <div className="av-chip" data-al="chip">
              {extra ? `${name} · ${extra}` : name}
            </div>
            {message}
          </div>
          <div className="av-scene" data-al="scene">
            <Layer {...HILLS_FAR} bottom={24} />
            <Layer {...HILLS_NEAR} bottom={24} />
            <Layer {...PINES} bottom={24} />
            <Layer {...GROUND} bottom={0} />
            <div className="av-blk" data-al="blk" style={{ '--f': 0.5 } as React.CSSProperties} />
            {GEM_STOPS.map((f) => (
              <div key={f} className="av-gem" data-al="gem" style={{ '--f': f } as React.CSSProperties}>
                <Sprite rows={GEM} palette={PAL_GEM} size={4} dataAl="gemsp" />
                <em data-al="plus">+100</em>
              </div>
            ))}
            <div className="av-run" data-al="run">
              <div className="av-hero" data-al="hero">
                <Sprite rows={HERO_A} palette={PAL_HERO} size={4} className="fa" dataAl="fa" />
                <Sprite rows={HERO_B} palette={PAL_HERO} size={4} className="fb" dataAl="fb" />
              </div>
            </div>
          </div>
        </div>
      )}

      {look === 'dialogo' && (
        <div className="rp-box">
          <div className="rp-tab" data-al="tab">
            {extra ? `${name} · ${extra}` : name}
          </div>
          <div className="rp-port" data-al="port">
            <Sprite rows={ROBOT_C} palette={PAL_ROBOT} size={5} className="fa" dataAl="fa" />
            <Sprite rows={ROBOT_O} palette={PAL_ROBOT} size={5} className="fb" dataAl="fb" />
          </div>
          {message}
          <span className="rp-next" data-al="next">
            <Sprite rows={ARROW} palette={PAL_ARROW} size={4} />
          </span>
        </div>
      )}
    </div>
  );
});
