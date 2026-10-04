/**
 * src/components/goals/GoalsOverlayView.tsx
 *
 * Capa de metas. La usan el monitor de GoalsStudio y la fuente de navegador de
 * OBS (Widget.tsx). La raíz cubre la pantalla entera y coloca las piezas en uno
 * de seis puntos; todo se mide en em (ver src/styles/metas.css).
 *
 * - Cada meta elige su diseño: Barra, Anillo, Bloques, Cinta, Columna o
 *   Personalizado. Cambian de forma, no solo de color.
 * - Varias metas: hasta 4 a la vez; con 5 o más (o forzado) pasa a carrusel.
 *   Al centro van en fila; en un lateral se apilan, salvo las Columnas, que
 *   siempre van una al lado de otra. Las Cintas se reparten el borde entero.
 * - Un aporte se lee solo: aparece «+N», el número rueda y la forma avanza a su
 *   manera. Al cruzar el 25, 50 o 75 % la pieza da un pulso corto; al cumplirse,
 *   la etiqueta se despliega y cada diseño celebra distinto. Nada late en bucle.
 * - Solo se animan transform, opacity, clip-path y el trazo del anillo. Con
 *   movimiento reducido los valores cambian sin desplazamientos.
 * - Los controles manuales del carrusel solo existen en el estudio.
 * - Muestra sin panel: `#widget?app=goals&demo=1&design=anillo&pos=br&n=3`.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  CommunityGoalItem,
  DEFAULT_GOALS,
  GoalsDisplayMode,
  GoalsPosition,
  calculateGoalProgress,
  checkMilestoneCrossed,
  shouldDisplayAsSlideshow,
} from '../../types/goals';
import {
  GOAL_BLOCKS,
  GoalCustom,
  GoalShape,
  GoalsDemo,
  blocksLit,
  cintaEdge,
  goalFontStack,
  goalShape,
  goalsFlow,
  inkOn,
  migrateGoalStyle,
  mixHex,
  normalizeGoalCustom,
  normalizeGoalsPosition,
  parseGoalsDemo,
} from '../../utils/goalDesign';
import { reduced } from '../../utils/alertMotion';
import '../../styles/metas.css';

const EASE = 'expo.out';
const RING = 263.9; // perímetro del anillo (radio 42)
const fmt = (n: number) => Math.round(n).toLocaleString('es');

/** Personalizado de muestra para `demo=1&design=custom`. */
const DEMO_CUSTOM: GoalCustom = {
  shape: 'bloques',
  background: '#f4efe2',
  text: '#1d1a3a',
  font: 'bricolage',
  size: 110,
  radius: 8,
  showTitle: true,
  showTarget: true,
};

function readDemo(): GoalsDemo | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  if (at !== -1) new URLSearchParams(hash.slice(at)).forEach((value, key) => params.set(key, value));
  return parseGoalsDemo(params);
}

const shapeOf = (goal: CommunityGoalItem): GoalShape => {
  const style = migrateGoalStyle(goal.style);
  return goalShape(style, style === 'custom' ? normalizeGoalCustom(goal.custom) : undefined);
};

interface GoalsOverlayViewProps {
  goals: CommunityGoalItem[];
  activeGoalId: string;
  displayMode: GoalsDisplayMode;
  slideshowIntervalSec: number;
  /** Punto de la pantalla. Por defecto, arriba al centro. */
  position?: GoalsPosition;
  recentProgressGoalId?: string | null;
  onSelectGoal?: (goalId: string) => void;
  isStudio?: boolean;
}

export const GoalsOverlayView: React.FC<GoalsOverlayViewProps> = ({
  goals: savedGoals,
  activeGoalId,
  displayMode: savedMode,
  slideshowIntervalSec,
  position: savedPosition,
  recentProgressGoalId,
  onSelectGoal,
  isStudio = false,
}) => {
  // demo=1 en la URL de la capa: metas de muestra para colocarla sin abrir el panel
  const demo = useMemo(() => (isStudio ? null : readDemo()), [isStudio]);
  const goals = useMemo(() => {
    if (!demo) return savedGoals;
    return DEFAULT_GOALS.slice(0, demo.count).map((goal) => ({
      ...goal,
      enabled: true,
      current: demo.done ? goal.target : goal.current,
      style: demo.design ?? goal.style,
      custom: demo.design === 'custom' ? DEMO_CUSTOM : goal.custom,
    }));
  }, [demo, savedGoals]);
  const displayMode: GoalsDisplayMode = demo ? 'row_only' : savedMode;
  const position = normalizeGoalsPosition(demo?.position ?? savedPosition);

  const enabledGoals = goals.filter((g) => g.enabled);
  const totalEnabled = enabledGoals.length;
  const isSlideshow =
    displayMode !== 'single_active' && shouldDisplayAsSlideshow(totalEnabled, displayMode);

  // slideIndex es la meta a la que vamos; shownIndex, la que está pintada.
  const [slideIndex, setSlideIndex] = useState(0);
  const [shownIndex, setShownIndex] = useState(0);
  const slideRef = useRef<HTMLDivElement>(null);
  const segsRef = useRef<HTMLDivElement>(null);

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

  // Salida de la pieza actual antes de pintar la siguiente. La salida es más
  // corta que la entrada; la entrada la hace la propia pieza al montarse.
  useEffect(() => {
    if (slideIndex === shownIndex) return;
    const piece = slideRef.current;
    if (!piece || reduced()) {
      setShownIndex(slideIndex);
      return;
    }
    const tween = gsap.to(piece, {
      y: '-0.4em',
      opacity: 0,
      duration: 0.16,
      ease: 'power2.out',
      onComplete: () => setShownIndex(slideIndex),
    });
    return () => {
      tween.kill();
      gsap.set(piece, { clearProps: 'transform,opacity' });
    };
  }, [slideIndex, shownIndex]);

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
  }, [isSlideshow, slideIndex, shownIndex, totalEnabled, slideshowIntervalSec]);

  const studioAttr = isStudio ? '' : undefined;

  if (totalEnabled === 0) {
    // En la emisión una capa sin metas no dibuja nada
    if (!isStudio) return null;
    return (
      <div className="ovl mt-root" data-studio="">
        <div className="gl-empty mt-empty">No hay metas activas. Habilita una en el panel.</div>
      </div>
    );
  }

  // Qué metas se ven ahora mismo
  let visible: CommunityGoalItem[];
  if (displayMode === 'single_active') {
    visible = [enabledGoals.find((g) => g.id === activeGoalId) || enabledGoals[0]];
  } else if (isSlideshow) {
    visible = [enabledGoals[shownIndex] || enabledGoals[0]];
  } else {
    visible = enabledGoals.slice(0, 4);
  }

  const edge = cintaEdge(position);
  const cintas = visible.filter((goal) => shapeOf(goal) === 'cinta');
  const others = visible.filter((goal) => shapeOf(goal) !== 'cinta');
  const shapes = others.map(shapeOf);
  const flow = goalsFlow(position, shapes);
  const sameShape = shapes.every((shape) => shape === shapes[0]);
  // Con tres o más piezas en fila, o varias cintas en el mismo borde, cada una va justa de ancho
  const tightRow = !isSlideshow && flow === 'fila' && others.length >= 3;

  const piece = (goal: CommunityGoalItem) => (
    <GoalPiece
      key={goal.id}
      goal={goal}
      edge={edge}
      tight={shapeOf(goal) === 'cinta' ? cintas.length > 1 : tightRow}
      isSelected={isStudio && goal.id === activeGoalId}
      onSelect={onSelectGoal}
      pieceRef={isSlideshow ? slideRef : undefined}
    />
  );

  const segs = isSlideshow && (
    <div ref={segsRef} className="gl-segs" aria-hidden="true">
      {enabledGoals.map((g) => (
        <i key={g.id}>
          <b />
        </i>
      ))}
    </div>
  );

  return (
    <div className="ovl mt-root" data-studio={studioAttr} data-cinta={cintas.length > 0 ? edge : undefined}>
      {cintas.length > 0 && (
        <div className="mt-edge" data-edge={edge}>
          {cintas.map(piece)}
          {segs}
        </div>
      )}

      {others.length > 0 && (
        <div
          className="mt-group"
          data-pos={position}
          data-flow={isSlideshow ? 'pila' : flow}
          data-same={sameShape ? '' : undefined}
        >
          {isSlideshow ? (
            <div className="mt-slide">
              {others.map(piece)}
              {segs}
            </div>
          ) : (
            others.map(piece)
          )}
        </div>
      )}

      {isStudio && isSlideshow && (
        <div className="gl-ctl mt-ctl" data-at={edge === 'b' ? 't' : undefined}>
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
  );
};

// ==============================================================
// Pieza de una meta
// ==============================================================
interface GoalPieceProps {
  goal: CommunityGoalItem;
  /** Borde de la pantalla más cercano: por ahí entra la Cinta. */
  edge: 't' | 'b';
  /** Va justa de ancho: se quita el porcentaje junto a la cifra y el anillo pasa a vertical. */
  tight?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  pieceRef?: React.RefObject<HTMLDivElement | null>;
}

interface Painted {
  id: string;
  shape: GoalShape;
  current: number;
  done: boolean;
  lit: number;
}

const GoalPiece: React.FC<GoalPieceProps> = ({ goal, edge, tight, isSelected, onSelect, pieceRef }) => {
  const style = migrateGoalStyle(goal.style);
  const custom = style === 'custom' ? normalizeGoalCustom(goal.custom) : null;
  const shape = goalShape(style, custom ?? undefined);

  const pct = calculateGoalProgress(goal.current, goal.target);
  const done = goal.current >= goal.target;
  const lit = blocksLit(done ? 100 : Math.min(pct, 99.9));
  const showTitle = custom ? custom.showTitle : true;
  const showTarget = custom ? custom.showTarget : true;
  // La cifra grande es el valor actual; si los números están ocultos, el porcentaje
  const showFigure = goal.showNumbers || goal.showPercentage;
  const figure = goal.showNumbers ? goal.current : pct;
  const suffix = goal.showNumbers ? '' : '%';
  // El anillo ya lleva el porcentaje en el centro y la columna no tiene ancho para él
  const pctNote =
    goal.showPercentage && goal.showNumbers && !tight && shape !== 'anillo' && shape !== 'columna'
      ? ` · ${pct.toLocaleString('es')}%`
      : '';

  const elRef = useRef<HTMLDivElement | null>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const vfillRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLElement>(null);
  const plusRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  const rolling = useRef({ v: figure });
  const prev = useRef<Painted | null>(null);

  // Al desmontar no queda ningún movimiento vivo
  useLayoutEffect(() => {
    const el = elRef.current;
    const roll = rolling.current;
    return () => {
      gsap.killTweensOf(roll);
      if (el) gsap.killTweensOf([el, ...Array.from(el.querySelectorAll('*'))]);
      prev.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { id: goal.id, shape, current: goal.current, done, lit };
    const plate = plateRef.current;
    const still = reduced();

    const write = (value: number) => {
      if (numRef.current) numRef.current.textContent = fmt(value) + suffix;
    };
    // Lleva la forma a un porcentaje: la barra y la cinta se deslizan, el
    // anillo se cierra y la columna sube.
    const level = (percent: number, animate: boolean) => {
      const tween = animate ? { duration: 0.7, ease: EASE, overwrite: true } : { duration: 0, overwrite: true };
      if (fillRef.current) gsap.to(fillRef.current, { xPercent: percent - 100, ...tween });
      if (vfillRef.current) gsap.to(vfillRef.current, { yPercent: 100 - percent, ...tween });
      if (ringRef.current) {
        gsap.to(ringRef.current, { attr: { 'stroke-dashoffset': RING * (1 - percent / 100) }, ...tween });
      }
    };
    // Los bloques recién encendidos entran en cascada
    const cascade = (from: number) => {
      const blocks = blocksRef.current ? Array.from(blocksRef.current.children).slice(from, lit) : [];
      if (blocks.length === 0) return;
      gsap.fromTo(
        blocks,
        { scaleY: 0.3, opacity: 0.4 },
        { scaleY: 1, opacity: 1, duration: 0.3, ease: EASE, stagger: 0.03, overwrite: true }
      );
    };

    // Primera pintura, cambio de meta (carrusel) o de forma: entra la pieza y se llena desde cero
    if (!before || before.id !== goal.id || before.shape !== shape) {
      gsap.killTweensOf(rolling.current);
      rolling.current.v = figure;
      write(figure);
      if (still || !plate) {
        level(pct, false);
        return;
      }
      level(0, false);
      level(pct, true);
      cascade(0);
      const from = shape === 'cinta' ? (edge === 'b' ? '100%' : '-100%') : '0.6em';
      gsap.fromTo(plate, { opacity: 0, y: from }, { opacity: 1, y: 0, duration: 0.45, ease: EASE, overwrite: true });
      return;
    }

    const gain = goal.current - before.current;

    if (still) {
      // Movimiento reducido: los valores cambian en su sitio; el «+N» solo aparece y se va
      gsap.killTweensOf(rolling.current);
      rolling.current.v = figure;
      write(figure);
      level(pct, false);
      if (gain > 0 && plusRef.current) {
        plusRef.current.textContent = `+${fmt(gain)}`;
        gsap
          .timeline({ defaults: { overwrite: true } })
          .fromTo(plusRef.current, { opacity: 0 }, { opacity: 1, duration: 0.2 })
          .to(plusRef.current, { opacity: 0, duration: 0.2 }, 1.6);
      }
      return;
    }

    write(rolling.current.v);
    level(pct, true);
    gsap.to(rolling.current, {
      v: figure,
      duration: 0.7,
      ease: EASE,
      overwrite: true,
      onUpdate: () => write(rolling.current.v),
    });

    if (gain > 0) {
      if (plusRef.current) {
        plusRef.current.textContent = `+${fmt(gain)}`;
        gsap
          .timeline({ defaults: { overwrite: true } })
          .fromTo(plusRef.current, { y: '0.5em', opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: EASE })
          .to(plusRef.current, { y: '-0.3em', opacity: 0, duration: 0.2, ease: 'power2.out' }, 1.6);
      }
      // La punta destella una vez
      if (tipRef.current) {
        gsap.fromTo(
          tipRef.current,
          { opacity: 0.9, xPercent: 0, yPercent: 0 },
          { opacity: 0, duration: 0.8, ease: 'power2.out', overwrite: true }
        );
      }
      if (lit > before.lit) cascade(before.lit);

      // Hito al 25, 50 o 75 %: un pulso corto de toda la pieza
      const milestone = checkMilestoneCrossed(before.current, goal.current, goal.target);
      if (milestone && milestone !== 100 && !done && plate) {
        gsap.fromTo(plate, { scale: 1.04 }, { scale: 1, duration: 0.5, ease: EASE, overwrite: true });
      }
    }

    // La meta se acaba de cumplir: la etiqueta se despliega, la cifra asienta
    // y cada forma celebra a su manera
    if (done && !before.done) {
      if (doneRef.current) {
        gsap.fromTo(
          doneRef.current,
          { clipPath: 'inset(0 100% 0 0)' },
          { clipPath: 'inset(0 0% 0 0)', duration: 0.45, ease: EASE, delay: 0.4 }
        );
      }
      if (numRef.current) {
        gsap.fromTo(numRef.current, { scale: 1.25 }, { scale: 1, duration: 0.6, ease: EASE, delay: 0.4 });
      }
      if (shape === 'bloques' && blocksRef.current) {
        // Salto de bloques
        gsap.fromTo(
          Array.from(blocksRef.current.children),
          { y: 0 },
          { y: '-0.35em', duration: 0.18, ease: 'power2.out', stagger: 0.04, yoyo: true, repeat: 1, delay: 0.5 }
        );
      }
      if (shape === 'anillo' && svgRef.current) {
        // Latido del anillo
        gsap.fromTo(
          svgRef.current,
          { scale: 1.12 },
          { scale: 1, duration: 0.6, ease: EASE, delay: 0.4, transformOrigin: '50% 50%' }
        );
      }
      if (tipRef.current) {
        // Barrido de luz: de lado a lado en la barra y la cinta, de abajo arriba en la columna
        const sweep = shape === 'columna' ? { yPercent: 300 } : { xPercent: -600 };
        gsap.fromTo(
          tipRef.current,
          { opacity: 1, ...sweep },
          { opacity: 0, xPercent: 0, yPercent: 0, duration: 0.9, ease: 'power2.out', delay: 0.3, overwrite: true }
        );
      }
    }
  }, [goal.id, goal.current, goal.target, figure, suffix, pct, done, lit, shape, showFigure, edge]);

  const selectable = Boolean(onSelect);
  const select = () => onSelect?.(goal.id);

  const vars: Record<string, string> = { '--c': goal.accentColor, '--c-ink': inkOn(goal.accentColor) };
  if (custom) {
    vars['--p-bg'] = custom.background;
    vars['--p-fg'] = custom.text;
    vars['--p-mut'] = mixHex(custom.text, custom.background, 0.32);
    vars['--p-track'] = mixHex(custom.background, custom.text, 0.16);
    vars['--p-line'] = mixHex(custom.background, custom.text, 0.24);
    vars['--p-r'] = `${custom.radius / 10}em`;
    vars['--p-font'] = goalFontStack(custom.font);
    vars.fontSize = `${custom.size / 100}em`;
  }

  const title = showTitle && (
    <span className="mt-ti" title={goal.title}>
      {goal.title}
    </span>
  );
  const num = showFigure && <b ref={numRef} className="mt-n" />;
  const tail = done ? (
    <span ref={doneRef} className="mt-done">
      Meta cumplida
    </span>
  ) : (
    goal.showNumbers &&
    showTarget && (
      <span className="mt-of">
        /{fmt(goal.target)} <span className="mt-unit">{goal.unit}</span>
        {pctNote}
      </span>
    )
  );
  const count = (num || tail) && (
    <span className="mt-count">
      {num}
      {tail}
    </span>
  );
  const plus = <span ref={plusRef} className="mt-plus ovl-mono" aria-hidden="true" />;

  let body: React.ReactNode;
  if (shape === 'anillo') {
    body = (
      <div ref={plateRef} className="ovl-plate mt-plate mt-anillo">
        <div className="mt-ringwrap">
          <svg ref={svgRef} viewBox="0 0 100 100" aria-hidden="true">
            <g transform="rotate(-90 50 50)">
              <circle className="mt-ring-bg" cx="50" cy="50" r="42" />
              <circle
                ref={ringRef}
                className="mt-ring"
                cx="50"
                cy="50"
                r="42"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING}
              />
            </g>
          </svg>
          <b className="mt-n mt-pc">{Math.round(pct)}%</b>
        </div>
        {(title || count) && (
          <div className="mt-side">
            {title}
            {count}
            {plus}
          </div>
        )}
      </div>
    );
  } else if (shape === 'bloques') {
    body = (
      <div ref={plateRef} className="ovl-plate mt-plate mt-bloques">
        <div className="mt-top">
          {title}
          {plus}
          {count}
        </div>
        <div ref={blocksRef} className="mt-blocks" aria-hidden="true">
          {Array.from({ length: GOAL_BLOCKS }, (_, i) => (
            <i key={i} data-on={i < lit ? '' : undefined} />
          ))}
        </div>
      </div>
    );
  } else if (shape === 'cinta') {
    body = (
      <div ref={plateRef} className="mt-plate mt-cinta" data-edge={edge}>
        <div ref={fillRef} className="mt-fill">
          <span ref={tipRef} className="mt-tip" />
        </div>
        {title}
        <span className="mt-cinta-end">
          {plus}
          {count}
        </span>
      </div>
    );
  } else if (shape === 'columna') {
    body = (
      <div ref={plateRef} className="ovl-plate mt-plate mt-columna">
        {num}
        {tail && <span className="mt-colof">{tail}</span>}
        <div className="mt-vtrack">
          <div ref={vfillRef} className="mt-vfill">
            <span ref={tipRef} className="mt-vtip" />
          </div>
        </div>
        {title}
        {plus}
      </div>
    );
  } else {
    body = (
      <div ref={plateRef} className="ovl-plate mt-plate mt-barra">
        <div className="mt-top">
          {title}
          {plus}
          {count}
        </div>
        <div className="mt-track">
          <div ref={fillRef} className="mt-fill">
            <span ref={tipRef} className="mt-tip" />
          </div>
          <div className="mt-ticks" aria-hidden="true">
            {[25, 50, 75].map((mark) => (
              <i key={mark} style={{ left: `${mark}%` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={(node) => {
        elRef.current = node;
        if (pieceRef) pieceRef.current = node;
      }}
      className="mt-piece"
      data-d={shape}
      data-tight={tight ? '' : undefined}
      data-selected={isSelected ? '' : undefined}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-label={selectable ? `Editar ${goal.title}` : undefined}
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
      style={vars as React.CSSProperties}
    >
      {body}
    </div>
  );
};
