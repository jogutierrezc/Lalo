/**
 * AlertCard.tsx
 *
 * Tarjeta de alerta TTS en sus cuatro estilos: Cabina, Bocadillo, Subtítulo y
 * Sticker. Solo dibuja; el movimiento vive en utils/alertMotion.ts y actúa sobre
 * los atributos data-al. La usan el widget de OBS y la vista previa del panel.
 */

import React, { forwardRef } from 'react';
import { AlertPosition, AlertStyle, inkFor, normalizeAccent, stickerDataUri } from '../utils/appearance';

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

function sizeFor(length: number): 's' | 'm' | 'l' | 'xl' {
  if (length > 650) return 'xl';
  if (length > 350) return 'l';
  if (length > 150) return 'm';
  return 's';
}

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
  const rootStyle = { fontSize, '--acc': safeAccent, '--acc-ink': inkFor(safeAccent) } as React.CSSProperties;

  const message = (
    <div className="al-text" data-al="text">
      <p className="al-msg">{renderMessageContent(text)}</p>
    </div>
  );
  const status = loading ? <span className="al-status">Preparando voz</span> : null;

  return (
    <div
      ref={ref}
      className={`al al-${alertStyle}`}
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
    </div>
  );
});
