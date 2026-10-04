/**
 * src/components/ObsSyncNotice.tsx
 *
 * Aviso de que los cambios se enviaron a OBS. Es un aviso del panel, no una
 * capa de emisión: discreto, en el lenguaje Cabina, y se va solo.
 *
 * - Entra con un desplazamiento corto y sale más rápido de lo que entra.
 * - La barra inferior marca el tiempo que queda; se detiene mientras el
 *   puntero o el foco están encima, para dar tiempo a copiar la URL.
 */

import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Check, Copy, X } from 'lucide-react';
import { reduced } from '../utils/alertMotion';
import '../styles/aviso.css';

export interface ObsSyncNoticeProps {
  appType: string;
  url: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}

const SOURCE_LABEL: Record<string, string> = {
  ALL: 'todas las capas',
  TTS: 'la voz del chat',
  ALERTS: 'las alertas',
  GOALS: 'las metas',
  ROULETTE: 'la ruleta',
  POLLS: 'las batallas',
  CHAT: 'el chat',
};

export const ObsSyncNotice: React.FC<ObsSyncNoticeProps> = ({ appType, url, onDismiss, autoDismissMs = 5000 }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<gsap.core.Tween | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');

  const leave = () => {
    timerRef.current?.kill();
    const root = rootRef.current;
    if (!root || reduced()) {
      dismissRef.current();
      return;
    }
    gsap.to(root, { opacity: 0, y: -6, duration: 0.18, ease: 'power2.out', onComplete: () => dismissRef.current() });
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!reduced()) {
      gsap.fromTo(root, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3, ease: 'expo.out' });
    }
    // La cuenta atrás es la propia barra: al terminar, el aviso se va
    timerRef.current = gsap.fromTo(
      barRef.current,
      { scaleX: 1 },
      { scaleX: 0, duration: autoDismissMs / 1000, ease: 'none', onComplete: leave }
    );
    return () => {
      timerRef.current?.kill();
      gsap.killTweensOf(root);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDismissMs]);

  const copyAgain = () => {
    navigator.clipboard
      ?.writeText(url)
      .then(() => setCopied('yes'))
      .catch(() => setCopied('failed'));
    setTimeout(() => setCopied('no'), 2000);
  };

  return (
    <div
      ref={rootRef}
      className="obs-aviso"
      role="status"
      onMouseEnter={() => timerRef.current?.pause()}
      onMouseLeave={() => timerRef.current?.resume()}
      onFocus={() => timerRef.current?.pause()}
      onBlur={() => timerRef.current?.resume()}
    >
      <span className="obs-aviso-ok" aria-hidden="true">
        <Check className="h-4 w-4" />
      </span>

      <div className="obs-aviso-body">
        <p className="obs-aviso-title">OBS actualizado</p>
        <p className="cab-hint">
          Se enviaron los cambios de {SOURCE_LABEL[appType] || 'las capas'} y la URL quedó copiada.
        </p>
        <button type="button" className="cab-btn2 cab-btn-sm" onClick={copyAgain}>
          {copied === 'yes' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span>{copied === 'yes' ? 'Copiada' : copied === 'failed' ? 'No se pudo copiar' : 'Copiar la URL otra vez'}</span>
        </button>
      </div>

      <button type="button" className="cab-icon" aria-label="Cerrar aviso" onClick={leave}>
        <X className="h-4 w-4" />
      </button>

      <i ref={barRef} className="obs-aviso-bar" aria-hidden="true" />
    </div>
  );
};
