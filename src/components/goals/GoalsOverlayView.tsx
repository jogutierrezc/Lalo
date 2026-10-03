/**
 * src/components/goals/GoalsOverlayView.tsx
 *
 * Vista de Metas Comunitarias & Marcadores. La usan el monitor de GoalsStudio
 * y la fuente de navegador de OBS (Widget.tsx).
 *
 * - Hasta 4 metas en fila; con 5 o más (o forzado) pasa a carrusel.
 * - Cada meta es una placa medida en em: la cifra manda, el título es etiqueta.
 * - Un aporte se lee solo: aparece «+N», el número rueda y la punta de la barra
 *   destella una vez. Nada late en bucle.
 * - En el carrusel la placa no se mueve: sale el contenido y entra el siguiente.
 *   Los controles manuales solo existen en el estudio, nunca en la emisión.
 * - El estilo de cada meta (cabina, neon, cyber, minimal) solo cambia tokens.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  CommunityGoalItem,
  GoalsDisplayMode,
  calculateGoalProgress,
  shouldDisplayAsSlideshow,
} from '../../types/goals';
import { inkFor } from '../../utils/appearance';
import { reduced } from '../../utils/alertMotion';

const EASE = 'expo.out';
const fmt = (n: number) => Math.round(n).toLocaleString('es');

interface GoalsOverlayViewProps {
  goals: CommunityGoalItem[];
  activeGoalId: string;
  displayMode: GoalsDisplayMode;
  slideshowIntervalSec: number;
  recentProgressGoalId?: string | null;
  onSelectGoal?: (goalId: string) => void;
  isStudio?: boolean;
}

export const GoalsOverlayView: React.FC<GoalsOverlayViewProps> = ({
  goals,
  activeGoalId,
  displayMode,
  slideshowIntervalSec,
  recentProgressGoalId,
  onSelectGoal,
  isStudio = false,
}) => {
  const enabledGoals = goals.filter((g) => g.enabled);
  const totalEnabled = enabledGoals.length;
  const isSlideshow =
    displayMode !== 'single_active' && shouldDisplayAsSlideshow(totalEnabled, displayMode);

  // slideIndex es la meta a la que vamos; shownIndex, la que está pintada.
  const [slideIndex, setSlideIndex] = useState(0);
  const [shownIndex, setShownIndex] = useState(0);
  const innerRef = useRef<HTMLDivElement>(null);
  const segsRef = useRef<HTMLDivElement>(null);
  const firstSlide = useRef(true);

  // Mantener el índice dentro del rango si cambia el total de metas
  useEffect(() => {
    if (totalEnabled > 0 && slideIndex >= totalEnabled) {
      setSlideIndex(0);
    }
  }, [totalEnabled, slideIndex]);

  // Si llega progreso a una meta, el carrusel salta a ella
  useEffect(() => {
    if (!recentProgressGoalId) return;
    const idx = goals.filter((g) => g.enabled).findIndex((g) => g.id === recentProgressGoalId);
    if (idx !== -1) setSlideIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentProgressGoalId]);

  // Salida del contenido actual antes de pintar la meta siguiente
  useEffect(() => {
    if (slideIndex === shownIndex) return;
    const inner = innerRef.current;
    if (!inner || reduced()) {
      setShownIndex(slideIndex);
      return;
    }
    const tween = gsap.to(inner, {
      y: '-0.4em',
      opacity: 0,
      duration: 0.16,
      ease: 'power2.out',
      onComplete: () => setShownIndex(slideIndex),
    });
    return () => {
      tween.kill();
    };
  }, [slideIndex, shownIndex]);

  // Entrada del contenido nuevo
  useLayoutEffect(() => {
    if (firstSlide.current) {
      firstSlide.current = false;
      return;
    }
    const inner = innerRef.current;
    if (!inner) return;
    if (reduced()) {
      gsap.set(inner, { y: 0, opacity: 1 });
      return;
    }
    gsap.fromTo(inner, { y: '0.5em', opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: EASE });
  }, [shownIndex]);

  // Reloj del carrusel: la marca de la meta activa se llena con el tiempo
  useEffect(() => {
    if (!isSlideshow || totalEnabled <= 1) return;
    const duration = Math.max(3, slideshowIntervalSec);
    const next = () => setSlideIndex((prev) => (prev + 1) % totalEnabled);
    const bars = segsRef.current ? Array.from(segsRef.current.querySelectorAll('b')) : [];
    const active = bars[slideIndex];
    if (!active) {
      const call = gsap.delayedCall(duration, next);
      return () => {
        call.kill();
      };
    }
    bars.forEach((bar, i) => gsap.set(bar, { scaleX: i < slideIndex ? 1 : 0 }));
    const tween = gsap.to(active, { scaleX: 1, duration, ease: 'none', onComplete: next });
    return () => {
      tween.kill();
    };
  }, [isSlideshow, slideIndex, totalEnabled, slideshowIntervalSec]);

  if (totalEnabled === 0) {
    // En la emisión una capa sin metas no dibuja nada
    if (!isStudio) return null;
    return (
      <div className="ovl-fit">
        <div className="ovl gl-empty" data-studio="">
          No hay metas activas. Habilita una en el panel.
        </div>
      </div>
    );
  }

  const studioAttr = isStudio ? '' : undefined;

  if (displayMode === 'single_active') {
    const singleGoal = enabledGoals.find((g) => g.id === activeGoalId) || enabledGoals[0];
    return (
      <div className="ovl-fit">
        <div className="ovl gl-row" data-n="1" data-studio={studioAttr}>
          <GoalPlate
            goal={singleGoal}
            isSelected={isStudio && singleGoal.id === activeGoalId}
            onSelect={onSelectGoal}
          />
        </div>
      </div>
    );
  }

  if (isSlideshow) {
    const slideGoal = enabledGoals[shownIndex] || enabledGoals[0];
    return (
      <div className="ovl-fit">
        <div className="ovl gl-row" data-n="1" data-studio={studioAttr}>
          <div>
            <GoalPlate
              goal={slideGoal}
              isSelected={isStudio && slideGoal.id === activeGoalId}
              onSelect={onSelectGoal}
              innerRef={innerRef}
            />
            <div ref={segsRef} className="gl-segs" aria-hidden="true">
              {enabledGoals.map((g) => (
                <i key={g.id}>
                  <b />
                </i>
              ))}
            </div>

            {isStudio && (
              <div className="gl-ctl">
                <button
                  type="button"
                  className="cab-icon"
                  aria-label="Meta anterior"
                  onClick={() => setSlideIndex((prev) => (prev - 1 + totalEnabled) % totalEnabled)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="cab-mono">
                  Meta {Math.min(slideIndex, totalEnabled - 1) + 1} de {totalEnabled}
                </span>
                <button
                  type="button"
                  className="cab-icon"
                  aria-label="Meta siguiente"
                  onClick={() => setSlideIndex((prev) => (prev + 1) % totalEnabled)}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const visible = enabledGoals.slice(0, 4);
  return (
    <div className="ovl-fit">
      <div
        className="ovl gl-row"
        data-n={visible.length}
        data-studio={studioAttr}
        style={{ '--n': visible.length } as React.CSSProperties}
      >
        {visible.map((goal) => (
          <GoalPlate
            key={goal.id}
            goal={goal}
            isSelected={isStudio && goal.id === activeGoalId}
            onSelect={onSelectGoal}
          />
        ))}
      </div>
    </div>
  );
};

// ==============================================================
// Placa de una meta
// ==============================================================
interface GoalPlateProps {
  goal: CommunityGoalItem;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  innerRef?: React.Ref<HTMLDivElement>;
}

const GoalPlate: React.FC<GoalPlateProps> = ({ goal, isSelected, onSelect, innerRef }) => {
  const pct = calculateGoalProgress(goal.current, goal.target);
  const done = goal.current >= goal.target;
  // La cifra grande es el valor actual; si los números están ocultos, el porcentaje
  const showFigure = goal.showNumbers || goal.showPercentage;
  const figure = goal.showNumbers ? goal.current : pct;
  const suffix = goal.showNumbers ? '' : '%';

  const fillRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const numRef = useRef<HTMLElement>(null);
  const plusRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  const rolling = useRef({ v: figure });
  const prev = useRef<{ id: string; current: number; done: boolean } | null>(null);

  useLayoutEffect(() => {
    const fill = fillRef.current;
    const before = prev.current;
    prev.current = { id: goal.id, current: goal.current, done };
    if (!fill) return;

    const write = (value: number) => {
      if (numRef.current) numRef.current.textContent = fmt(value) + suffix;
    };
    const still = reduced();

    // Primera pintura, cambio de meta (carrusel) o movimiento reducido: sin rodar
    if (!before || before.id !== goal.id || still) {
      gsap.killTweensOf([fill, rolling.current]);
      rolling.current.v = figure;
      write(figure);
      if (before && before.id !== goal.id && !still) {
        gsap.fromTo(fill, { xPercent: -100 }, { xPercent: pct - 100, duration: 0.8, ease: EASE });
      } else {
        gsap.set(fill, { xPercent: pct - 100 });
      }
      return;
    }

    gsap.to(fill, { xPercent: pct - 100, duration: 0.7, ease: EASE, overwrite: true });
    gsap.to(rolling.current, {
      v: figure,
      duration: 0.7,
      ease: EASE,
      overwrite: true,
      onUpdate: () => write(rolling.current.v),
    });

    const gain = goal.current - before.current;
    if (gain > 0) {
      if (plusRef.current) {
        plusRef.current.textContent = `+${fmt(gain)}`;
        gsap
          .timeline({ defaults: { overwrite: true } })
          .fromTo(plusRef.current, { y: '0.5em', opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: EASE })
          .to(plusRef.current, { y: '-0.3em', opacity: 0, duration: 0.2, ease: 'power2.out' }, 1.6);
      }
      if (tipRef.current) {
        gsap.fromTo(tipRef.current, { opacity: 0.9 }, { opacity: 0, duration: 0.8, ease: 'power2.out', overwrite: true });
      }
    }

    // La meta se acaba de cumplir: la etiqueta se despliega y la cifra asienta
    if (done && !before.done) {
      if (doneRef.current) {
        gsap.fromTo(
          doneRef.current,
          { clipPath: 'inset(0 100% 0 0)' },
          { clipPath: 'inset(0 0% 0 0)', duration: 0.45, ease: EASE, delay: 0.4 }
        );
      }
      if (numRef.current) {
        gsap.fromTo(numRef.current, { scale: 1.18 }, { scale: 1, duration: 0.5, ease: EASE, delay: 0.4 });
      }
    }
  }, [goal.id, goal.current, goal.target, figure, suffix, pct, done]);

  const selectable = Boolean(onSelect);
  const select = () => onSelect?.(goal.id);

  return (
    <div
      className="ovl-plate gl"
      data-ovl-theme={goal.style}
      data-selected={isSelected ? '' : undefined}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? select : undefined}
      onKeyDown={
        selectable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                select();
              }
            }
          : undefined
      }
      style={{ '--c': goal.accentColor, '--c-ink': inkFor(goal.accentColor) } as React.CSSProperties}
    >
      <div ref={innerRef} className="gl-in">
        <div className="gl-top">
          <span className="gl-title ovl-caps" title={goal.title}>
            {goal.title}
          </span>
          <span ref={plusRef} className="gl-plus ovl-mono" aria-hidden="true" />
          {showFigure && (
            <span className="gl-count">
              <b ref={numRef} />
              {done ? (
                <span ref={doneRef} className="gl-done ovl-caps">
                  Meta cumplida
                </span>
              ) : (
                goal.showNumbers && (
                  <span className="gl-of">
                    /{fmt(goal.target)} {goal.unit}
                    {goal.showPercentage ? ` · ${pct}%` : ''}
                  </span>
                )
              )}
            </span>
          )}
        </div>

        <div className="gl-track">
          <div ref={fillRef} className="gl-fill">
            <span ref={tipRef} className="gl-tip" />
          </div>
        </div>
      </div>
    </div>
  );
};
