/**
 * src/components/torneo/TournamentIntro.tsx
 *
 * La presentación de la página de inscripción: lo que ve quien abre
 * `#torneo/<slug>` antes del formulario. Axo, el ajolote de Lalo, da la
 * bienvenida, explica cómo se juega con lo que configuró el streamer y desea
 * suerte, en seis pasos. Sin voz ni sonido.
 *
 * - A un lado, el escenario de Axo (siempre oscuro, teñido con el acento del
 *   torneo): su dibujo, la pastilla de estado y el bocadillo, que aparece
 *   palabra a palabra. Al otro, el paso, con el estilo y el color del torneo.
 * - Navegación: Siguiente y Atrás, las pastillas de los pasos, las flechas del
 *   teclado, avance automático opcional y «Saltar presentación» siempre a la
 *   vista. Al terminar o saltar se llama a `onDone` con el sitio de Axo en
 *   pantalla, para que la página lo lleve volando hasta el formulario.
 * - Los textos y la geometría de la llave salen de utils/tournamentIntro.ts.
 *   Lo que escribió el streamer se pinta con React, nunca como HTML; el único
 *   HTML que se inserta es el dibujo de Axo, fijo, de mascotas/petArt.ts.
 * - Movimiento con GSAP (transform, opacity, clip-path y trazos SVG). Cada paso
 *   tiene un momento propio y salir es más rápido que entrar. El primer paso se
 *   ve entero en reposo. Con «reducir movimiento» quedan solo fundidos y todo
 *   está a la vista desde el principio. Al desmontar se para todo.
 * - Los gestos son los de Axo (PetLayer.tsx): mece las branquias y la cola,
 *   flota, las abre de golpe al cambiar de paso y suelta burbujas.
 */

import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { PetFigure } from '../mascotas/PetFigure';
import { petFaceMarkup } from '../mascotas/petArt';
import { PET_KINDS, type PetEmotion } from '../../types/pets';
import type { TournamentStyle } from '../../types/tournament';
import { reduced } from '../../utils/alertMotion';
import {
  GENERAL_RULES,
  INTRO_LAST,
  INTRO_STEPS,
  type GeneralRuleId,
  type IntroClosing,
  type IntroConfig,
  autoWaitSeconds,
  bracketCaption,
  bracketLayout,
  bracketSummary,
  clampStep,
  introClosing,
  introConfig,
  introFacts,
  introFlow,
  introPhases,
  introScript,
  introSeats,
  introStatusNote,
  introTotalGames,
  introTotalLabel,
  moodLabel,
  ownRulesHeading,
  teamHeading,
} from '../../utils/tournamentIntro';
import { inkFor } from '../../utils/tournamentLogic';
import type { PublicTournament } from '../../utils/tournamentSignup';
import '../../styles/mascotas.css';
import '../../styles/presentacion.css';

gsap.registerPlugin(useGSAP);

const AXO_COLOR = PET_KINDS.find((pet) => pet.id === 'axo')?.color ?? '#ff9fb0';

// ---------- Axo ----------

interface AxoFigureProps {
  emotion?: PetEmotion;
  className?: string;
  /** Con texto, el dibujo se anuncia; sin él, es decorativo. */
  label?: string;
}

/** El dibujo de Axo con una de sus seis caras. Cambiar de cara no vuelve a pintar el cuerpo. */
export const AxoFigure = forwardRef<HTMLDivElement, AxoFigureProps>(({ emotion = 'feliz', className, label }, ref) => {
  const own = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const face = own.current?.querySelector('[data-p="face"]');
    // La cara es texto fijo de petArt.ts
    if (face) face.innerHTML = petFaceMarkup('axo', emotion);
  }, [emotion]);
  return (
    <div
      ref={(node) => {
        own.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <PetFigure kind="axo" color={AXO_COLOR} />
    </div>
  );
});
AxoFigure.displayName = 'AxoFigure';

/** Los gestos de Axo. Sin movimiento (o antes de montar) no hacen nada. */
interface AxoMoves {
  /** Abre las branquias de golpe y agita la cola. */
  flutter: () => void;
  /** Saluda con la aleta. */
  wave: () => void;
  /** Sube y se deja caer despacio, como en el agua. */
  bob: () => void;
  /** Suelta unas burbujas. */
  bubbles: () => void;
  /** Todo a la vez: lo que hace cuando hay algo que celebrar. */
  celebrate: () => void;
}
const noop = () => undefined;
const STILL: AxoMoves = { flutter: noop, wave: noop, bob: noop, bubbles: noop, celebrate: noop };

// ---------- Dibujos fijos ----------

const CUP_PATH = 'M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4';
const STAR_PATH = 'M0 -11l3.3 7.7 7.7 3.3-7.7 3.3-3.3 7.7-3.3-7.7-7.7-3.3 7.7-3.3z';
/** Dónde queda cada destello alrededor del título de cierre: x e y en % de su caja, y tamaño. */
const STAR_SPOTS = [
  [-3, -42, 1.1],
  [46, -50, 0.7],
  [92, -38, 1.25],
  [99, 34, 0.8],
  [70, -78, 0.6],
  [20, -74, 0.75],
] as const;
const CONFETTI = Array.from({ length: 54 }, (_, index) => index);

const RULE_ICONS: Record<GeneralRuleId, React.ReactNode> = {
  hora: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  ausencia: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  limpio: (
    <>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  respeto: <path d="M4 5h16v11H9l-5 4V5z" />,
  inscritos: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5.5a3 3 0 0 1 0 5.5M17 14c2.4.6 4 2.6 4 6" />
    </>
  ),
  decision: (
    <>
      <circle cx="9" cy="14" r="5" />
      <path d="M13 11h8v4h-4" />
    </>
  ),
};

const Person: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);

/** Un texto letra a letra, para animarlo. Quien usa lector de pantalla lo oye entero. */
const Letters: React.FC<{ text: string; part: string }> = ({ text, part }) => (
  <>
    <span className="tpi-sr">{text}</span>
    <span aria-hidden="true">
      {text.split(' ').map((word, at) => (
        <React.Fragment key={at}>
          {at > 0 && ' '}
          <span className="tpi-word">
            {Array.from(word).map((letter, index) => (
              <span key={index} className="tpi-ch" data-a={part}>
                {letter}
              </span>
            ))}
          </span>
        </React.Fragment>
      ))}
    </span>
  </>
);

const Rail: React.FC<{ children: React.ReactNode; end?: boolean }> = ({ children, end }) => (
  <div className="tpi-rail">
    <span className="tpi-dot" data-a="dot">
      {children}
    </span>
    {!end && <i className="tpi-seg" data-a="seg" />}
  </div>
);

// ---------- Paso 1: bienvenida ----------

const Welcome: React.FC<{ tournament: PublicTournament; cfg: IntroConfig }> = ({ tournament, cfg }) => {
  const note = introStatusNote(cfg.status);
  return (
    <div className="tpi-step tpi-wel">
      {tournament.logo && (
        <div className="tpi-wel-logo tpi-plate" data-a="logo">
          <img src={tournament.logo} alt="" />
        </div>
      )}
      <h2 className="tpi-wel-name tpi-title">
        <Letters text={cfg.name} part="name" />
      </h2>
      <i className="tpi-wel-rule" data-a="rule" />
      <p className="tpi-wel-org" data-a="org">
        <span className="tpi-mut">Organiza</span> <b>{cfg.organizer}</b>
      </p>
      <ul className="tpi-facts" aria-label="Datos del torneo">
        {introFacts(cfg).map((fact, index) => (
          <li key={index} className="tpi-fact tpi-plate" data-a="fact">
            {fact}
          </li>
        ))}
        {note && (
          <li className="tpi-fact" data-tone="warn" data-a="fact">
            {note}
          </li>
        )}
      </ul>
      {tournament.sponsors.length > 0 && (
        <div className="tpi-wel-sp" data-a="sp">
          <span className="tpi-mut">Con el apoyo de</span>
          {tournament.sponsors.map((sponsor, index) =>
            sponsor.logo ? <img key={index} src={sponsor.logo} alt={sponsor.name || 'Patrocinador'} /> : <b key={index}>{sponsor.name}</b>
          )}
        </div>
      )}
    </div>
  );
};

// ---------- Paso 2: la llave ----------

interface BracketProps {
  cfg: IntroConfig;
  style: TournamentStyle;
  /** Se entró al paso con movimiento: la llave se dibuja y el equipo de ejemplo avanza. */
  animate: boolean;
  /** `start`: empieza (o se repite) el recorrido. `champion`: el equipo de ejemplo llegó a campeón. */
  onPhase: (phase: 'start' | 'champion') => void;
}

const Bracket: React.FC<BracketProps> = ({ cfg, style, animate, onPhase }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [phase, setPhase] = useState<'rest' | 'start' | number>('rest');
  const [again, setAgain] = useState(0);
  const drawn = useRef<{ width: number; again: number } | null>(null);
  const phaseCb = useRef(onPhase);
  phaseCb.current = onPhase;
  const solo = cfg.teamSize === 1;

  // La llave se dibuja a la medida del hueco: se mide antes de pintar y cuando cambia el ancho
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const next = Math.floor(box.clientWidth);
      setWidth((prev) => (Math.abs(prev - next) > 4 ? next : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => (width > 0 ? bracketLayout(cfg.size, width, solo) : null), [cfg.size, width, solo]);
  const rounds = layout ? layout.token.length - 1 : 0;
  const rx = style === 'cartel' ? Math.min(8, (layout?.barH ?? 0) / 2) : style === 'cabina' ? 2 : 0;

  useGSAP(
    () => {
      const box = boxRef.current;
      if (!box || !layout) return;
      const before = drawn.current;
      drawn.current = { width, again };
      setPhase('rest');
      // Un cambio de ancho deja la llave dibujada entera: no vuelve a empezar
      const resized = before !== null && before.width !== width && before.again === again;
      if (resized || reduced() || !(animate || again > 0)) return;

      const q = gsap.utils.selector(box);
      const token = q('.tpi-tk');
      const start = layout.token[0];
      gsap.set(q('.tpi-cn, .tpi-rt'), { strokeDasharray: 1, strokeDashoffset: 1 });
      gsap.set(q('[data-opp]'), { opacity: 1 });
      gsap.set(q('[data-slot]:not([data-slot="0"]), .tpi-bh:not([data-r="0"]), .tpi-cup'), { autoAlpha: 0 });
      gsap.set(token, { x: start.x, y: start.y, autoAlpha: 0 });
      setPhase('start');
      phaseCb.current('start');

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      // 1. La llave se dibuja, ronda a ronda
      tl.from(q('[data-slot="0"]'), { autoAlpha: 0, x: -12, duration: 0.3, stagger: 0.5 / cfg.size }, 0);
      for (let round = 0; round < rounds; round += 1) {
        tl.to(q(`.tpi-cn[data-r="${round}"]`), { strokeDashoffset: 0, duration: 0.5, ease: 'power2.inOut', stagger: 0.02 }, round === 0 ? 0.45 : '>-0.15').to(
          q(`[data-slot="${round + 1}"], .tpi-bh[data-r="${round + 1}"]`),
          { autoAlpha: 1, duration: 0.25 },
          '>-0.2'
        );
      }
      // 2. El equipo de ejemplo avanza hasta la final
      tl.to(token, { autoAlpha: 1, duration: 0.25 }, '>0.1').fromTo(token, { scale: 0.8, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.4, ease: 'back.out(2.4)' }, '<');
      for (let round = 0; round < rounds; round += 1) {
        const to = layout.token[round + 1];
        tl.call(() => setPhase(round), undefined, '>0.35')
          .to(q(`[data-opp="${round}"]`), { opacity: 0.38, duration: 0.3 }, '<')
          .to(q(`.tpi-rt[data-r="${round}"]`), { strokeDashoffset: 0, duration: 0.45, ease: 'power2.inOut' }, '<0.05')
          .to(token, { x: to.x, y: to.y, duration: 0.6, ease: 'power3.inOut' }, '<0.12');
      }
      // 3. Campeón: aparece la copa y Axo lo celebra
      tl.to(q('.tpi-cup'), { autoAlpha: 1, duration: 0.2 }, '>-0.1')
        .fromTo(q('.tpi-cup'), { scale: 0.5, transformOrigin: '50% 100%' }, { scale: 1, duration: 0.5, ease: 'back.out(3)' }, '<')
        .fromTo(token, { scale: 1.14, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.5, ease: 'back.out(2.5)' }, '<')
        .call(
          () => {
            setPhase('rest');
            phaseCb.current('champion');
          },
          undefined,
          '<'
        );
      // Si el navegador frena la animación (pestaña en segundo plano), la llave queda entera igual
      const settle = window.setTimeout(() => tl.progress(1), (tl.duration() + 2) * 1000);
      return () => window.clearTimeout(settle);
    },
    { dependencies: [layout, again], scope: boxRef, revertOnUpdate: true }
  );

  const caption = bracketCaption(cfg.size, phase, solo);
  const end = layout ? layout.token[rounds] : null;

  return (
    <div className="tpi-step">
      <h2>Eliminación directa</h2>
      <div className="tpi-br" ref={boxRef}>
        {layout && end && (
          <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="img" aria-label={bracketSummary(cfg.size, solo)}>
            {layout.heads.map((head) => (
              <text key={head.round} className="tpi-bh" data-r={head.round} x={head.x} y={13}>
                {head.label}
              </text>
            ))}
            {layout.links.map((link, index) => (
              <path key={index} className="tpi-cn" data-r={link.round} pathLength={1} d={link.d} />
            ))}
            {layout.slots.map((slot, index) => (
              <g key={index} data-slot={slot.round} data-opp={slot.opponent ? slot.round : undefined}>
                <rect className="tpi-sl" data-kind={slot.kind} x={slot.x} y={slot.y} width={layout.barW} height={layout.barH} rx={rx} />
                {slot.label && (
                  <text className="tpi-sn" x={slot.x + 8} y={slot.y + layout.barH / 2 + 4}>
                    {slot.label}
                  </text>
                )}
              </g>
            ))}
            {layout.route.map((leg) => (
              <path key={leg.round} className="tpi-rt" data-r={leg.round} pathLength={1} d={leg.d} />
            ))}
            {layout.cup && (
              <g className="tpi-cup" transform={`translate(${layout.cup.x} ${layout.cup.y})`}>
                <path d={CUP_PATH} />
              </g>
            )}
            <g className="tpi-tk" transform={`translate(${end.x} ${end.y})`}>
              <rect width={layout.barW} height={layout.barH} rx={rx} />
              <text x={layout.barW / 2} y={layout.barH / 2 + 4} textAnchor="middle">
                {layout.tokenLabel}
              </text>
            </g>
          </svg>
        )}
      </div>
      {/* El pie cambia varias veces por segundo mientras se anima: no se anuncia. El resumen va en el dibujo */}
      <p className="tpi-br-now" aria-hidden={phase === 'rest' ? undefined : true}>
        {caption.before}
        <b>{caption.strong}</b>
        {caption.after}
      </p>
      <p className="tpi-br-note tpi-mut">
        <span>Los cruces se conocen cuando se cierra la inscripción.</span>
        {!reduced() && (
          <button type="button" className="tpi-btn2 tpi-sm" onClick={() => setAgain((n) => n + 1)}>
            Ver otra vez
          </button>
        )}
      </p>
    </div>
  );
};

// ---------- Paso 3: las fases ----------

const Phases: React.FC<{ cfg: IntroConfig }> = ({ cfg }) => (
  <div className="tpi-step">
    <h2>Las fases</h2>
    <ol className="tpi-ph">
      {introPhases(cfg.size, cfg.teamSize === 1).map((item, index) => (
        <li key={index} data-a="row">
          <Rail>{index + 1}</Rail>
          <div className="tpi-ph-txt">
            <b data-a="ph-t">{item.title}</b>
            <span className="tpi-mut" data-a="ph-d">
              {item.detail}
            </span>
            <div className="tpi-sq" aria-hidden="true">
              {Array.from({ length: item.teams }, (_, at) => (
                <i key={at} data-a="sq" />
              ))}
            </div>
          </div>
        </li>
      ))}
      <li data-a="row" data-end="">
        <Rail end>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={CUP_PATH} />
          </svg>
        </Rail>
        <div className="tpi-ph-txt">
          <b data-a="ph-t">Campeón de {cfg.name}</b>
          <span className="tpi-mut" data-a="ph-d">
            {cfg.teamSize === 1 ? '1 jugador' : '1 equipo'}
          </span>
        </div>
      </li>
    </ol>
    <p className="tpi-total tpi-plate" data-a="total">
      <b data-a="total-n">{introTotalGames(cfg.size)}</b>
      <span>{introTotalLabel(cfg.size)}</span>
    </p>
  </div>
);

// ---------- Paso 4: tu equipo ----------

const Team: React.FC<{ cfg: IntroConfig }> = ({ cfg }) => (
  <div className="tpi-step">
    <h2>{teamHeading(cfg.teamSize)}</h2>
    <ul className="tpi-seats">
      {introSeats(cfg.teamSize).map((seat, index) => (
        <li key={index} className="tpi-seat tpi-plate" data-cap={seat.captain ? '' : undefined} data-a="seat">
          <Person />
          <b>{seat.title}</b>
          <span className="tpi-mut">{seat.note}</span>
        </li>
      ))}
    </ul>
    <ol className="tpi-fl">
      {introFlow(cfg).map((item, index) => (
        <li key={index} data-a="fl">
          <Rail>{index + 1}</Rail>
          <div className="tpi-fl-txt">
            {item.tag && (
              <span className="tpi-fact" data-tone={item.tag === 'pending' ? 'warn' : 'ok'} data-a={item.tag}>
                {item.tag === 'pending' ? 'Pendiente' : 'Aceptado'}
              </span>
            )}
            <b>{item.title}</b>
            <span className="tpi-mut">{item.text}</span>
          </div>
        </li>
      ))}
    </ol>
  </div>
);

// ---------- Paso 5: las reglas ----------

const Rules: React.FC<{ cfg: IntroConfig }> = ({ cfg }) => (
  <div className="tpi-step">
    <h2>Reglas generales</h2>
    <ul className="tpi-rl">
      {GENERAL_RULES.map((rule) => (
        <li key={rule.id} data-a="rule">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {RULE_ICONS[rule.id]}
          </svg>
          <div>
            <b>{rule.title}</b>
            <span className="tpi-mut">{rule.text}</span>
          </div>
        </li>
      ))}
    </ul>
    {cfg.rules.length > 0 && (
      <div className="tpi-own tpi-plate" data-a="own">
        <h3>{ownRulesHeading(cfg)}</h3>
        <ul>
          {cfg.rules.map((rule, index) => (
            <li key={index} data-a="own-li">
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);

// ---------- Paso 6: buena suerte ----------

const Luck: React.FC<{ closing: IntroClosing; onForm: () => void; onAgain: () => void }> = ({ closing, onForm, onAgain }) => (
  <div className="tpi-step tpi-lk">
    <h2 className="tpi-lk-t tpi-title">
      <Letters text={closing.title} part="luck" />
      <span className="tpi-stars" aria-hidden="true">
        {STAR_SPOTS.map(([x, y, size], index) => (
          <svg key={index} viewBox="-12 -12 24 24" style={{ left: `${x}%`, top: `${y}%`, scale: String(size) }} data-a="star" data-x={x} data-y={y}>
            <path d={STAR_PATH} />
          </svg>
        ))}
      </span>
    </h2>
    <p className="tpi-lead" data-a="lk">
      {closing.lead}
    </p>
    <div className="tpi-lk-act" data-a="lk">
      <button type="button" className="tpi-btn tpi-big" onClick={onForm}>
        {closing.action}
      </button>
      <button type="button" className="tpi-btn2" onClick={onAgain}>
        Ver la presentación otra vez
      </button>
    </div>
  </div>
);

// ---------- La presentación ----------

interface TournamentIntroProps {
  tournament: PublicTournament;
  /** Paso en el que empieza (0 a 5). Solo lo usa la muestra de desarrollo. */
  startStep?: number;
  /** Se abrió a petición (con «Ver la presentación»): el foco pasa a ella. */
  focus?: boolean;
  /**
   * Terminó o se saltó la presentación. `from` es dónde está Axo en pantalla,
   * para que la página lo lleve hasta el formulario; null si no hay dibujo.
   */
  onDone: (from: DOMRect | null) => void;
}

interface Entry {
  step: number;
  /** Sube con cada cambio de paso. En 0 es la primera vez: todo se ve en reposo. */
  n: number;
  /** El paso se abre con movimiento. */
  animate: boolean;
  dir: 1 | -1;
}

const share = (step: number): number => (step + 1) / INTRO_STEPS.length;
/** El bocadillo, de una vez, para el lector de pantalla. */
const spoken = (title: string, text: string): string => `${title}${/[.!?]$/.test(title) ? '' : '.'} ${text}`;

export const TournamentIntro: React.FC<TournamentIntroProps> = ({ tournament, startStep = 0, focus = false, onDone }) => {
  const cfg = useMemo(() => introConfig(tournament), [tournament]);
  const script = useMemo(() => introScript(cfg), [cfg]);
  const closing = useMemo(() => introClosing(cfg), [cfg]);

  const [entry, setEntry] = useState<Entry>(() => ({ step: clampStep(startStep), n: 0, animate: false, dir: 1 }));
  const [mood, setMood] = useState<PetEmotion>(() => script[clampStep(startStep)].mood);
  const [auto, setAuto] = useState(false);

  const rootRef = useRef<HTMLElement | null>(null);
  const ctRef = useRef<HTMLDivElement | null>(null);
  const figRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const axo = useRef<AxoMoves>(STILL);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const leaving = useRef<{ tween: gsap.core.Tween; timer: number } | null>(null);

  const line = script[entry.step];
  const accent = tournament.color;

  // ---------- Navegar ----------
  /** Cambia de paso. Salir es más rápido que entrar. */
  const go = useCallback((target: number) => {
    const next = clampStep(target);
    const current = entryRef.current.step;
    if (next === current || leaving.current) return;
    const dir: 1 | -1 = next > current ? 1 : -1;
    const swap = () => {
      if (leaving.current) window.clearTimeout(leaving.current.timer);
      leaving.current = null;
      setEntry((prev) => ({ step: next, n: prev.n + 1, animate: !reduced(), dir }));
      setMood(scriptRef.current[next].mood);
    };
    const content = ctRef.current;
    if (!content || reduced()) {
      swap();
      return;
    }
    const tween = gsap.to(content, { autoAlpha: 0, x: -14 * dir, filter: 'blur(4px)', duration: 0.14, ease: 'power2.out', overwrite: true, onComplete: swap });
    // Si el navegador frena la salida, el paso cambia igual
    const timer = window.setTimeout(() => {
      tween.kill();
      swap();
    }, 500);
    leaving.current = { tween, timer };
  }, []);
  const goRef = useRef(go);
  goRef.current = go;

  const finish = useCallback(() => {
    const drawing = figRef.current?.querySelector('.pt-svg');
    onDone(drawing ? drawing.getBoundingClientRect() : null);
  }, [onDone]);

  useEffect(() => {
    if (focus) rootRef.current?.focus({ preventScroll: true });
  }, [focus]);

  // Flechas del teclado, salvo dentro de un campo
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as Element | null;
      if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowRight' && entryRef.current.step < INTRO_LAST) {
        event.preventDefault();
        goRef.current(entryRef.current.step + 1);
      }
      if (event.key === 'ArrowLeft' && entryRef.current.step > 0) {
        event.preventDefault();
        goRef.current(entryRef.current.step - 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // La pastilla del paso en curso queda a la vista aunque la fila no quepa entera
  useEffect(() => {
    const nav = navRef.current;
    const now = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !now || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: Math.max(0, now.offsetLeft - nav.clientWidth / 2 + now.offsetWidth / 2), behavior: reduced() ? 'auto' : 'smooth' });
  }, [entry.step]);

  // ---------- La vida de Axo: mece branquias y cola, flota y parpadea ----------
  useGSAP(
    () => {
      const root = rootRef.current;
      const fig = figRef.current;
      const svg = fig?.querySelector<SVGSVGElement>('.pt-svg');
      if (!root || !fig || !svg) return;
      const part = (name: string) => svg.querySelector(`[data-p="${name}"]`);
      const live: gsap.core.Animation[] = [];
      const keep = <T extends gsap.core.Animation>(animation: T): T => {
        live.push(animation);
        return animation;
      };
      const loop = { ease: 'sine.inOut', yoyo: true, repeat: -1 };
      const sway: gsap.core.Tween[] = [];
      let blinkCall: gsap.core.Tween | null = null;

      if (!reduced()) {
        const rock = (name: string, from: number, to: number, origin: string, duration: number) => {
          const el = part(name);
          if (el) sway.push(keep(gsap.fromTo(el, { rotation: from }, { rotation: to, svgOrigin: origin, duration, ...loop })));
        };
        // Los mismos gestos que tiene en la capa de mascotas
        rock('gl', -6, 6, '48 100', 1.4);
        rock('gr', 6, -6, '152 100', 1.4);
        rock('tail', -8, 8, '124 168', 1.6);
        const float = root.querySelector('.tpi-float');
        if (float) keep(gsap.to(float, { yPercent: -5, duration: 2.1, ...loop }));
        const blink = () => {
          const eyes = svg.querySelector('.pt-e');
          // Con la cara contenta los ojos ya son dos arcos: no hay nada que cerrar
          if (eyes && !reduced() && moodRef.current !== 'feliz') gsap.to(eyes, { scaleY: 0.08, transformOrigin: '50% 60%', duration: 0.07, yoyo: true, repeat: 1 });
          blinkCall = gsap.delayedCall(gsap.utils.random(2.2, 5), blink);
        };
        blinkCall = gsap.delayedCall(1.8, blink);
      }

      const flutter = () => {
        if (reduced()) return;
        if (sway.length) keep(gsap.fromTo(sway, { timeScale: 3.4 }, { timeScale: 1, duration: 1.3, ease: 'power2.in' }));
        const flare = (name: string, origin: string) => {
          const el = part(name);
          if (el) keep(gsap.fromTo(el, { scale: 1.2 }, { scale: 1, svgOrigin: origin, duration: 0.9, ease: 'elastic.out(1, 0.45)' }));
        };
        flare('gl', '48 100');
        flare('gr', '152 100');
      };
      const wave = () => {
        const arm = part('arm');
        if (arm && !reduced()) keep(gsap.fromTo(arm, { rotation: 0 }, { rotation: -36, svgOrigin: '126 150', duration: 0.17, ease: 'sine.inOut', yoyo: true, repeat: 5 }));
      };
      const rise = (high: boolean) => {
        if (reduced()) return;
        const tl = gsap.timeline().to(fig, { y: high ? -28 : -12, rotation: high ? -7 : -4, duration: 0.26, ease: 'power2.out', overwrite: true });
        if (high) tl.to(fig, { rotation: 7, duration: 0.14, ease: 'sine.inOut', yoyo: true, repeat: 3 });
        keep(tl.to(fig, { y: 0, rotation: 0, duration: 0.75, ease: 'sine.inOut' }));
      };
      const bubbles = () => {
        if (reduced()) return;
        const bits = root.querySelectorAll('.tpi-bubbles i');
        keep(
          gsap
            .timeline()
            .fromTo(bits, { y: 0, x: 0, scale: 0.5, opacity: 0 }, { opacity: 0.85, scale: 1, duration: 0.25, ease: 'power2.out', stagger: 0.14 }, 0)
            .to(bits, { y: -120, x: () => gsap.utils.random(-12, 12), duration: 1.7, ease: 'power1.out', stagger: 0.14 }, 0)
            .to(bits, { opacity: 0, duration: 0.5, ease: 'power1.in', stagger: 0.14 }, 1.1)
        );
      };
      axo.current = {
        flutter,
        wave,
        bob: () => rise(false),
        bubbles,
        celebrate: () => {
          rise(true);
          flutter();
          bubbles();
        },
      };

      return () => {
        axo.current = STILL;
        blinkCall?.kill();
        live.forEach((animation) => animation.kill());
      };
    },
    { scope: rootRef }
  );

  // ---------- El momento de cada paso ----------
  useGSAP(
    () => {
      const root = rootRef.current;
      const content = ctRef.current;
      if (!root || !content) return;
      const q = gsap.utils.selector(root);
      const a = (name: string) => gsap.utils.toArray<HTMLElement>(content.querySelectorAll(`[data-a="${name}"]`));

      // Primera vez: el paso se ve entero. Solo se abre el escenario y Axo saluda
      if (entry.n === 0) {
        if (reduced()) return;
        gsap.fromTo(q('.tpi-glow'), { scale: 0.6, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 1.1, ease: 'power2.out', clearProps: 'transform,opacity' });
        gsap.fromTo(q('.tpi-rings i'), { scale: 0.7, opacity: 0.3 }, { scale: 1, opacity: 1, duration: 1, ease: 'power3.out', stagger: 0.08, clearProps: 'transform,opacity' });
        gsap.delayedCall(0.5, () => {
          axo.current.flutter();
          axo.current.wave();
          axo.current.bubbles();
        });
        return;
      }

      const bubble = q('.tpi-bub');
      // Con «reducir movimiento»: un fundido y nada más
      if (!entry.animate || reduced()) {
        gsap.fromTo([content, ...bubble], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: 'power1.out', clearProps: 'opacity,visibility,transform,filter' });
        return;
      }

      const tl = gsap.timeline();
      tl.fromTo(
        content,
        { autoAlpha: 0, x: 26 * entry.dir, filter: 'blur(6px)' },
        { autoAlpha: 1, x: 0, filter: 'blur(0px)', duration: 0.45, ease: 'expo.out', clearProps: 'transform,filter,opacity,visibility' },
        0
      )
        .fromTo(bubble, { scale: 0.95 }, { scale: 1, duration: 0.34, ease: 'back.out(2)', clearProps: 'transform' }, 0)
        .fromTo(q('.tpi-bub b'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.28, ease: 'power3.out', clearProps: 'opacity,transform' }, 0)
        // El texto del bocadillo aparece palabra a palabra, a ritmo de lectura
        .fromTo(q('.tpi-w'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out', stagger: 0.045, clearProps: 'opacity,transform' }, 0)
        // Los anillos del escenario laten con cada paso
        .fromTo(q('.tpi-rings i'), { scale: 0.86, opacity: 0.2 }, { scale: 1, opacity: 1, duration: 0.9, ease: 'power3.out', stagger: 0.07, clearProps: 'transform,opacity' }, 0);

      const done = 'transform,filter,opacity,visibility,clipPath';
      const hero = gsap.timeline({ defaults: { ease: 'expo.out', clearProps: done } });
      /** Entrada de unas piezas del paso. Si el paso no las tiene (sin logo, sin patrocinadores), no hace nada. */
      const from = (targets: Element[], vars: gsap.TweenVars, at: gsap.Position) => {
        if (targets.length) hero.from(targets, vars, at);
      };
      const step = INTRO_STEPS[entry.step].id;
      if (step !== 'suerte') {
        axo.current.bob();
        axo.current.flutter();
      }

      if (step === 'bienvenida') {
        axo.current.wave();
        from(a('logo'), { scale: 0.8, autoAlpha: 0, duration: 0.4 }, 0);
        from(a('name'), { autoAlpha: 0, y: 20, filter: 'blur(8px)', duration: 0.5, stagger: 0.035, ease: 'power3.out' }, 0.05);
        from(a('rule'), { scaleX: 0, duration: 0.6 }, 0.35);
        from(a('org'), { autoAlpha: 0, y: 8, duration: 0.35 }, 0.45);
        from(a('fact'), { autoAlpha: 0, y: 10, duration: 0.35, stagger: 0.06 }, 0.55);
        from(a('sp'), { autoAlpha: 0, duration: 0.4 }, 0.8);
      }

      if (step === 'fases') {
        const rows = a('row');
        rows.forEach((row, index) => {
          const at = index * 0.42;
          const inRow = (name: string) => Array.from(row.querySelectorAll(`[data-a="${name}"]`));
          const squares = inRow('sq');
          from(inRow('dot'), { scale: 0.5, autoAlpha: 0, duration: 0.4, ease: 'back.out(2.6)' }, at);
          from(inRow('ph-t'), { autoAlpha: 0, x: -10, duration: 0.35 }, at + 0.05);
          from(inRow('ph-d'), { autoAlpha: 0, duration: 0.3 }, at + 0.12);
          from(squares, { scale: 0.3, autoAlpha: 0, duration: 0.25, stagger: 0.25 / Math.max(1, squares.length), ease: 'back.out(2)' }, at + 0.12);
          from(inRow('seg'), { scaleY: 0, duration: 0.4, ease: 'power2.inOut' }, at + 0.15);
        });
        // El total cuenta hasta su número
        const out = a('total-n')[0];
        const total = { n: 0 };
        const games = introTotalGames(cfg.size);
        from(a('total'), { autoAlpha: 0, y: 10, duration: 0.4 }, '>-0.1');
        if (out) {
          hero.to(
            total,
            {
              n: games,
              duration: 0.7,
              ease: 'power2.out',
              snap: { n: 1 },
              clearProps: '',
              onUpdate: () => {
                out.textContent = String(total.n);
              },
              onComplete: () => {
                out.textContent = String(games);
              },
            },
            '<'
          );
        }
      }

      if (step === 'equipo') {
        from(a('seat'), { autoAlpha: 0, y: 16, scale: 0.9, duration: 0.45, stagger: 0.08, ease: 'back.out(1.8)' }, 0);
        from(a('fl'), { autoAlpha: 0, x: -12, duration: 0.4, stagger: 0.28 }, 0.35);
        from(a('pending'), { scale: 0.7, duration: 0.4, ease: 'back.out(3)' }, 0.75);
        from(a('accepted'), { scale: 0.7, filter: 'blur(4px)', duration: 0.45, ease: 'back.out(3)' }, 1.1);
      }

      if (step === 'reglas') {
        // Cada regla se descubre de izquierda a derecha
        from(a('rule'), { clipPath: 'inset(0% 100% 0% 0%)', x: -8, duration: 0.55, stagger: 0.09 }, 0);
        from(a('own'), { autoAlpha: 0, y: 12, duration: 0.45 }, '>-0.25');
        from(a('own-li'), { autoAlpha: 0, x: -8, duration: 0.3, stagger: 0.07 }, '<0.1');
      }

      if (step === 'suerte') {
        const stars = a('star');
        axo.current.celebrate();
        axo.current.wave();
        hero
          .from(a('luck'), { autoAlpha: 0, y: 26, rotation: -8, filter: 'blur(8px)', duration: 0.55, stagger: 0.04, ease: 'back.out(1.8)' }, 0)
          // Los destellos salen de detrás del título hasta su sitio
          .from(
            stars,
            {
              x: (_: number, star: HTMLElement) => ((45 - Number(star.dataset.x)) / 100) * (star.parentElement?.clientWidth ?? 0),
              y: (_: number, star: HTMLElement) => ((40 - Number(star.dataset.y)) / 100) * (star.parentElement?.clientHeight ?? 0),
              scale: 0.2,
              rotation: -160,
              autoAlpha: 0,
              duration: 0.9,
              stagger: 0.05,
              clearProps: 'opacity,visibility',
            },
            0.15
          )
          .from(a('lk'), { autoAlpha: 0, y: 12, duration: 0.4, stagger: 0.1 }, 0.5);
        gsap.to(stars, { rotation: 24, scale: 1.18, duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.2, delay: 1.2 });
        if (closing.confetti) {
          const fx = q('.tpi-fx')[0];
          q('.tpi-fx i').forEach((bit) => {
            gsap.set(bit, { left: `${gsap.utils.random(2, 98)}%` });
            gsap.fromTo(
              bit,
              { y: 0, x: 0, rotation: 0, autoAlpha: 1 },
              {
                y: () => (fx?.clientHeight ?? 600) + 30,
                x: gsap.utils.random(-70, 70),
                rotation: gsap.utils.random(-540, 540),
                autoAlpha: 1,
                duration: gsap.utils.random(2.2, 3.8),
                delay: gsap.utils.random(0, 1.1),
                ease: 'power1.in',
                onComplete: () => gsap.set(bit, { autoAlpha: 0 }),
              }
            );
          });
        }
      }

      // Si el navegador frena la animación (pestaña en segundo plano), el paso queda entero igual
      const settle = window.setTimeout(
        () => {
          tl.progress(1);
          hero.progress(1);
        },
        (Math.max(tl.duration(), hero.duration()) + 2) * 1000
      );
      return () => window.clearTimeout(settle);
    },
    { dependencies: [entry.n], scope: rootRef, revertOnUpdate: true }
  );

  // ---------- La barra de avance (y el avance automático) ----------
  useGSAP(
    () => {
      const bar = rootRef.current?.querySelector('.tpi-prog i');
      if (!bar) return;
      const at = share(entry.step);
      if (auto && entry.step < INTRO_LAST) {
        // La barra corre hacia el paso siguiente y al llegar cambia
        gsap.fromTo(
          bar,
          { scaleX: at },
          { scaleX: share(entry.step + 1), duration: autoWaitSeconds(entry.step, cfg.size), ease: 'none', overwrite: true, onComplete: () => goRef.current(entry.step + 1) }
        );
      } else if (entry.n === 0 || reduced()) {
        gsap.set(bar, { scaleX: at, overwrite: true });
      } else {
        gsap.to(bar, { scaleX: at, duration: 0.28, ease: 'power3.out', overwrite: true });
      }
    },
    { dependencies: [entry.n, auto, cfg.size], scope: rootRef }
  );

  // Al desmontar no queda nada moviéndose: ni la salida a medias ni el confeti
  useEffect(() => {
    const root = rootRef.current;
    return () => {
      if (leaving.current) {
        window.clearTimeout(leaving.current.timer);
        leaving.current.tween.kill();
        leaving.current = null;
      }
      if (root) gsap.killTweensOf(root.querySelectorAll('*'));
    };
  }, []);

  /** Lo que pasa en la llave se nota en la cara de Axo. */
  const onBracket = useCallback((phase: 'start' | 'champion') => {
    if (phase === 'start') {
      setMood('neutral');
      return;
    }
    setMood('emocionado');
    axo.current.celebrate();
  }, []);

  const stepId = INTRO_STEPS[entry.step].id;
  const pills = [...INTRO_STEPS.map((item) => item.name), closing.pill];

  return (
    <section
      ref={rootRef}
      className="tpi"
      data-style={tournament.style}
      data-custom={accent ? '' : undefined}
      style={accent ? ({ '--tpi-custom': accent, '--tpi-custom-ink': inkFor(accent) } as React.CSSProperties) : undefined}
      aria-label={`Presentación de ${cfg.name}`}
      tabIndex={-1}
    >
      <header className="tpi-top">
        {tournament.logo && (
          <div className="tpi-logo tpi-plate">
            <img src={tournament.logo} alt="" />
          </div>
        )}
        <h1 className="tpi-top-name">{cfg.name}</h1>
        <button type="button" className="tpi-btn2 tpi-sm" onClick={finish}>
          Saltar presentación
        </button>
      </header>

      <nav className="tpi-nav" ref={navRef} aria-label="Pasos de la presentación">
        {pills.map((name, index) => {
          const state = index < entry.step ? 'done' : index === entry.step ? 'now' : 'todo';
          return (
            <button
              key={index}
              type="button"
              data-s={state}
              aria-current={state === 'now' ? 'step' : undefined}
              onClick={() => (index > INTRO_LAST ? finish() : go(index))}
            >
              <i aria-hidden="true" />
              {name}
            </button>
          );
        })}
      </nav>

      <div className="tpi-gate">
        <div className="tpi-scene">
          <div className="tpi-halo">
            <span className="tpi-glow" aria-hidden="true" />
            <span className="tpi-rings" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="tpi-bubbles" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div className="tpi-float">
              <AxoFigure ref={figRef} className="tpi-fig" emotion={mood} label="Axo, el guía de Lalo" />
            </div>
          </div>
          <span className="tpi-mood">
            <i aria-hidden="true" />
            <span>{moodLabel(mood)}</span>
          </span>
          {/* A la vista, palabra a palabra; para el lector de pantalla, de una vez */}
          <div className="tpi-bub" aria-hidden="true">
            <b>{line.title}</b>
            <span>
              {line.text.split(' ').map((word, index) => (
                <span key={`${entry.n}-${index}`} className="tpi-w">
                  {word}{' '}
                </span>
              ))}
            </span>
          </div>
          <p className="tpi-sr" aria-live="polite" aria-atomic="true">
            {spoken(line.title, line.text)}
          </p>
        </div>

        <div className="tpi-body">
          <div className="tpi-ct" ref={ctRef}>
            <React.Fragment key={entry.n}>
              {stepId === 'bienvenida' && <Welcome tournament={tournament} cfg={cfg} />}
              {stepId === 'llave' && <Bracket cfg={cfg} style={tournament.style} animate={entry.animate} onPhase={onBracket} />}
              {stepId === 'fases' && <Phases cfg={cfg} />}
              {stepId === 'equipo' && <Team cfg={cfg} />}
              {stepId === 'reglas' && <Rules cfg={cfg} />}
              {stepId === 'suerte' && <Luck closing={closing} onForm={finish} onAgain={() => go(0)} />}
            </React.Fragment>
          </div>
        </div>
      </div>

      <footer className="tpi-foot">
        <button type="button" className="tpi-btn2" disabled={entry.step === 0} onClick={() => go(entry.step - 1)}>
          Atrás
        </button>
        <div className="tpi-mid">
          <div className="tpi-prog-row">
            <div
              className="tpi-prog"
              role="progressbar"
              aria-label="Avance de la presentación"
              aria-valuemin={1}
              aria-valuemax={INTRO_STEPS.length}
              aria-valuenow={entry.step + 1}
              aria-valuetext={`Paso ${entry.step + 1} de ${INTRO_STEPS.length}: ${INTRO_STEPS[entry.step].name}`}
            >
              <i />
            </div>
            <b>
              {entry.step + 1} de {INTRO_STEPS.length}
            </b>
          </div>
          <label className="tpi-auto">
            <input type="checkbox" className="tpi-tog" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
            <span>Avance automático</span>
          </label>
        </div>
        <button type="button" className="tpi-btn" onClick={() => (entry.step === INTRO_LAST ? finish() : go(entry.step + 1))}>
          {entry.step === INTRO_LAST ? closing.next : 'Siguiente'}
        </button>
      </footer>

      {stepId === 'suerte' && closing.confetti && (
        <div className="tpi-fx" aria-hidden="true">
          {CONFETTI.map((bit) => (
            <i key={bit} />
          ))}
        </div>
      )}
    </section>
  );
};
