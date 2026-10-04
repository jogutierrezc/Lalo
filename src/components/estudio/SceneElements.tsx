/**
 * src/components/estudio/SceneElements.tsx
 *
 * Elementos básicos de una escena: texto, forma, marco de cámara, temporizador
 * e imagen o vídeo. Solo dibujan dentro de la caja de su capa. Las medidas
 * guardadas están en píxeles del lienzo (1920 de ancho) y aquí pasan a em: en
 * el lienzo, 1em son 32 de esos píxeles.
 */

import React, { useEffect, useState } from 'react';
import { CHAT_FONTS } from '../../types/chat';
import {
  DEFAULT_CAM,
  DEFAULT_MEDIA,
  DEFAULT_SHAPE,
  DEFAULT_TEXT,
  DEFAULT_TIMER,
  StudioLayer,
  formatClock,
  timerDisplay,
} from '../../types/studio';

export type SceneMode = 'edit' | 'live';

const em = (px: number) => `${Math.round((px / 32) * 1000) / 1000}em`;
const fontStack = (id: string) => CHAT_FONTS.find((font) => font.id === id)?.stack || CHAT_FONTS[0].stack;
const ALIGN = { l: 'left', c: 'center', r: 'right' } as const;

const TextEl: React.FC<{ layer: StudioLayer }> = ({ layer }) => {
  const t = layer.text || DEFAULT_TEXT;
  return (
    <div className="es-el es-text" data-align={t.align} data-leg={t.legibility} data-font={t.font}>
      <p
        style={{
          fontFamily: fontStack(t.font),
          fontWeight: t.weight,
          fontSize: em(t.size),
          textAlign: ALIGN[t.align],
          color: t.color,
          textTransform: t.upper ? 'uppercase' : 'none',
        }}
      >
        {t.content}
      </p>
    </div>
  );
};

const ShapeEl: React.FC<{ layer: StudioLayer }> = ({ layer }) => {
  const s = layer.shape || DEFAULT_SHAPE;
  return (
    <div
      className="es-el"
      style={{
        background: s.filled ? s.fill : 'transparent',
        border: s.borderWidth > 0 ? `${em(s.borderWidth)} solid ${s.border}` : undefined,
        borderRadius: em(s.radius),
      }}
    />
  );
};

const CamEl: React.FC<{ layer: StudioLayer }> = ({ layer }) => {
  const c = layer.cam || DEFAULT_CAM;
  return (
    <div className="es-el es-cam" style={{ border: `${em(c.thickness)} solid ${c.color}`, borderRadius: em(c.radius) }}>
      {c.label && c.labelText && <span style={{ background: c.color }}>{c.labelText}</span>}
    </div>
  );
};

const TimerEl: React.FC<{ layer: StudioLayer; mode: SceneMode }> = ({ layer, mode }) => {
  const t = layer.timer || DEFAULT_TIMER;
  const [elapsed, setElapsed] = useState(0);

  // En OBS el reloj arranca al cargar la escena. En el editor se queda en su valor inicial
  useEffect(() => {
    if (mode !== 'live') return;
    const started = Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [mode, t.mode, t.minutes]);

  const shown = timerDisplay(t, mode === 'live' ? elapsed : 0);
  if (shown.hidden) return null;
  // El tamaño de letra sale de la caja: se reserva sitio para el texto más largo posible
  const widest = Math.max(shown.text.length, formatClock(0, t.format).length);
  return (
    <div
      className="es-el es-timer"
      data-plate={t.plate ? '' : undefined}
      data-words={shown.done && t.atZero === 'text' ? '' : undefined}
      style={{ color: t.color, '--es-n': widest } as React.CSSProperties}
    >
      <span>{shown.text}</span>
    </div>
  );
};

const MediaEl: React.FC<{ layer: StudioLayer; mode: SceneMode }> = ({ layer, mode }) => {
  const m = layer.media || DEFAULT_MEDIA;
  if (!m.url) {
    // Sin archivo elegido, en OBS no se pinta nada
    return mode === 'edit' ? <div className="es-el es-empty">Tu imagen o vídeo</div> : null;
  }
  const style: React.CSSProperties = { objectFit: m.fit };
  return m.kind === 'video' ? (
    <video className="es-el es-media" src={m.url} style={style} autoPlay playsInline loop={m.loop} muted={m.muted || mode === 'edit'} />
  ) : (
    <img className="es-el es-media" src={m.url} style={style} alt="" decoding="async" draggable={false} />
  );
};

/** Dibuja un elemento básico. Devuelve null si la capa es de Lalo (ver LaloBoxes). */
export const BasicElement: React.FC<{ layer: StudioLayer; mode: SceneMode }> = ({ layer, mode }) => {
  switch (layer.type) {
    case 'text':
      return <TextEl layer={layer} />;
    case 'shape':
      return <ShapeEl layer={layer} />;
    case 'cam':
      return <CamEl layer={layer} />;
    case 'timer':
      return <TimerEl layer={layer} mode={mode} />;
    case 'image':
      return <MediaEl layer={layer} mode={mode} />;
    default:
      return null;
  }
};
