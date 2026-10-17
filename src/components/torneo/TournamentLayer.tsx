/**
 * src/components/torneo/TournamentLayer.tsx
 *
 * Capa «Torneos». Tiene dos piezas:
 *
 * - TournamentLayer pinta: recibe los ajustes y el estado y enseña una de las
 *   cinco pantallas (llave, sigue, tabla, victoria, campeón) o nada (oculto),
 *   en uno de los cuatro estilos. La usan el monitor de TournamentStudio y la
 *   muestra del editor de Studio.
 * - TournamentLiveLayer es la de OBS (Widget.tsx y la caja de Studio): lee el
 *   estado del almacén (lib/tournamentStore.ts), atiende los comandos de
 *   moderación y pasa las frases del narrador a la cola de voz del widget.
 *
 * - Al marcar un ganador se ve la pantalla de victoria los segundos elegidos y
 *   vuelve la llave, con el equipo entrando en su casilla; en la final, el
 *   campeón con confeti.
 * - Los pasos avanzan con temporizadores, no con el final de las animaciones:
 *   OBS detiene las animaciones de las fuentes ocultas.
 * - El narrador cuenta cada cambio de pantalla y cada resultado. Lo que ya
 *   estaba al cargar la fuente no se narra.
 * - Los nombres de los equipos los escribe gente de fuera: todo se pinta con
 *   React, nada se inserta como HTML.
 *
 * Un comando escrito en el chat lo atiende ESTA fuente, que cambia el estado y
 * lo escribe en el almacén. Con el almacén local se queda en su navegador; con
 * el de la nube (la URL lleva la clave `k`, ver lib/tournamentCloud.ts) llega
 * al panel en unos segundos.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { resolveMediaUrl } from '../../lib/mediaRef';
import { tournamentStore } from '../../lib/tournamentStore';
import { emptyTournamentState, type TournamentScene, type TournamentSettings, type TournamentState } from '../../types/tournament';
import { reduced } from '../../utils/alertMotion';
import type { UserRole } from '../../utils/moderation';
import {
  type BracketMatch,
  type BracketSide,
  advanceTo,
  buildBracket,
  championOf,
  currentMatch,
  inkFor,
  interpretTournamentCommand,
  isNewerState,
  matchName,
  matchTeams,
  narrationLine,
  nextAfter,
  playableCount,
  playedCount,
  roundLabel,
  roundMatches,
  roundOf,
  roundTitle,
  sampleFinishedState,
  sampleTournamentState,
  sceneNow,
  standings,
} from '../../utils/tournamentLogic';

interface TournamentLayerProps {
  settings: TournamentSettings;
  state: TournamentState;
  isStudio?: boolean;
  /** Fija la pantalla sin mirar la del estado: muestras y `demo=1`. */
  scene?: TournamentScene;
  /** Muestra quieta: sin entradas ni confeti. */
  still?: boolean;
  /** Al cambiar, la pantalla repite su entrada. */
  replay?: number;
  /** Frase del narrador, con su etiqueta de emoción al principio. */
  onNarrate?: (line: string) => void;
}

/** Lo que tarda la pantalla anterior en irse: menos que cualquier entrada. */
const EXIT_SEC = 0.16;
/** Pasado este tiempo la entrada se da por terminada aunque OBS la haya frenado. */
const SETTLE_MS = 2600;
const CONFETTI_CHAMP = 52;
const CONFETTI_VIC = 18;

interface EnterOptions {
  animateFrame?: boolean;
  victorySec?: number;
}

// ---------- Movimiento ----------

function confetti(root: HTMLElement, mode: 'campeon' | 'victoria' = 'campeon'): void {
  const box = root.querySelector<HTMLElement>('[data-a="fx"]');
  if (!box) return;
  box.replaceChildren();
  const count = mode === 'campeon' ? CONFETTI_CHAMP : CONFETTI_VIC;
  const tones = ['var(--t-acc)', 'var(--t-fg)', 'var(--tn-white)'];
  const shapes = ['ribbon', 'diamond', 'spark'] as const;
  const height = box.clientHeight || 720;

  for (let i = 0; i < count; i += 1) {
    const bit = document.createElement('i');
    const shape = shapes[i % shapes.length];
    bit.dataset.shape = shape;
    bit.style.left = `${gsap.utils.random(6, 94)}%`;
    bit.style.background = tones[i % tones.length];
    box.append(bit);

    const driftX = gsap.utils.random(-95, 95);
    const fallDuration = mode === 'campeon' ? gsap.utils.random(2.3, 3.9) : gsap.utils.random(1.5, 2.4);
    const startDelay = mode === 'campeon' ? gsap.utils.random(0.12, 1.25) : gsap.utils.random(0.05, 0.45);

    gsap.fromTo(
      bit,
      {
        y: gsap.utils.random(-30, 10),
        x: 0,
        scale: gsap.utils.random(0.85, 1.2),
        rotation: gsap.utils.random(-45, 45),
        rotationX: gsap.utils.random(0, 180),
        rotationY: gsap.utils.random(0, 180),
        autoAlpha: 0,
      },
      {
        y: height * (mode === 'campeon' ? 1.12 : 0.85),
        x: driftX,
        rotation: gsap.utils.random(-520, 520),
        rotationX: gsap.utils.random(360, 900),
        rotationY: gsap.utils.random(360, 900),
        autoAlpha: mode === 'campeon' ? 0.92 : 0.78,
        duration: fallDuration,
        delay: startDelay,
        ease: 'power1.in',
      }
    );
  }
}

/** Entrada de una pantalla. `flash` es el equipo que acaba de avanzar: entra en su casilla nueva. */
function playEnter(root: HTMLElement, scene: TournamentScene, flash: number | null, options: EnterOptions = {}): gsap.core.Timeline {
  const { animateFrame = true, victorySec = 5 } = options;
  const tl = gsap.timeline();
  const q = (name: string) => Array.from(root.querySelectorAll<HTMLElement | SVGElement>(`[data-a="${name}"]`));
  const from = (targets: Element[], vars: gsap.TweenVars, at: number) => {
    if (targets.length) tl.from(targets, vars, at);
  };
  gsap.set([...q('top'), ...q('sp'), ...q('top-sub')], { clearProps: 'all' });

  if (reduced()) {
    const main = root.querySelector<HTMLElement>('.tn-main');
    tl.from(main ? [main] : Array.from(root.children), { autoAlpha: 0, duration: 0.2 });
    return tl;
  }

  if (animateFrame) {
    from(q('top'), { x: -24, autoAlpha: 0, duration: 0.38, ease: 'expo.out', clearProps: 'transform' }, 0);
    from(q('sp'), { y: 14, autoAlpha: 0, duration: 0.38, ease: 'expo.out', clearProps: 'transform' }, 0.08);
  } else {
    from(q('top-sub'), { y: -6, autoAlpha: 0, duration: 0.26, ease: 'power2.out', clearProps: 'transform' }, 0);
  }

  if (scene === 'llave') {
    const heads = Array.from(root.querySelectorAll<HTMLElement>('.tn-h'));
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.tn-mc'));
    const wires = q('wire');
    from(heads, { y: -8, autoAlpha: 0, duration: 0.26, ease: 'power2.out', stagger: 0.04, clearProps: 'transform' }, 0.04);
    // Con muchas casillas el escalonado se acorta: la llave entera entra en menos de medio segundo
    from(
      cards,
      {
        autoAlpha: 0,
        x: -16,
        scale: 0.96,
        duration: 0.32,
        ease: 'power3.out',
        stagger: Math.min(0.045, 0.34 / Math.max(1, cards.length)),
        clearProps: 'transform',
      },
      0.08
    );
    from(
      wires,
      {
        autoAlpha: 0,
        scaleX: 0,
        transformOrigin: '0% 50%',
        duration: 0.34,
        ease: 'expo.out',
        stagger: 0.03,
        clearProps: 'transform',
      },
      0.2
    );
    if (flash !== null) {
      const rows = Array.from(root.querySelectorAll<HTMLElement>(`.tn-mr[data-t="${flash}"]`));
      from(
        rows.slice(-1),
        {
          rotationX: -75,
          y: -6,
          transformOrigin: '50% 0%',
          autoAlpha: 0,
          duration: 0.48,
          ease: 'back.out(1.6)',
          clearProps: 'transform',
        },
        0.48
      );
    }
  }
  if (scene === 'sigue') {
    from(q('tag'), { y: -12, scale: 0.92, autoAlpha: 0, duration: 0.3, ease: 'power3.out', clearProps: 'transform' }, 0.1);
    from(q('left'), { xPercent: -32, scale: 0.94, autoAlpha: 0, duration: 0.46, ease: 'expo.out', clearProps: 'transform' }, 0.16);
    from(q('right'), { xPercent: 32, scale: 0.94, autoAlpha: 0, duration: 0.46, ease: 'expo.out', clearProps: 'transform' }, 0.16);
    from(q('vs'), { scale: 0.88, rotation: -8, autoAlpha: 0, duration: 0.42, ease: 'back.out(1.9)', clearProps: 'transform' }, 0.38);
    from(q('after'), { autoAlpha: 0, y: 8, duration: 0.3, ease: 'power2.out', clearProps: 'transform' }, 0.58);
    const shine = q('shine');
    if (shine.length) tl.to(shine, { xPercent: 460, duration: 0.95, ease: 'power2.inOut', stagger: 0.12 }, 0.48);
  }
  if (scene === 'tabla') {
    const rows = q('row');
    from(
      rows,
      {
        autoAlpha: 0,
        x: 20,
        scale: 0.98,
        duration: 0.3,
        ease: 'power3.out',
        stagger: Math.min(0.055, 0.46 / Math.max(1, rows.length)),
        clearProps: 'transform',
      },
      0.1
    );
  }
  if (scene === 'victoria' || scene === 'campeon') {
    from(q('ring'), { scale: 0.88, y: 10, autoAlpha: 0, duration: 0.46, ease: 'back.out(1.8)', clearProps: 'transform' }, 0.08);
    from(q('tag'), { y: -12, scale: 0.92, autoAlpha: 0, duration: 0.3, ease: 'power3.out', clearProps: 'transform' }, 0.16);
    from(q('card'), { scale: 0.92, y: 14, autoAlpha: 0, duration: 0.46, ease: 'expo.out', clearProps: 'transform' }, 0.2);
    from(
      Array.from(root.querySelectorAll<HTMLElement>('.tn-l')),
      {
        autoAlpha: 0,
        y: 14,
        filter: 'blur(4px)',
        duration: 0.38,
        ease: 'power3.out',
        stagger: 0.026,
        clearProps: 'filter,transform',
      },
      0.38
    );
    from(q('sub'), { autoAlpha: 0, y: 6, duration: 0.3, ease: 'power2.out', clearProps: 'transform' }, 0.74);
    from(q('after'), { autoAlpha: 0, y: 8, duration: 0.3, ease: 'power2.out', clearProps: 'transform' }, 0.84);
    const shine = q('shine');
    if (shine.length) tl.to(shine, { xPercent: 460, duration: 1, ease: 'power2.inOut' }, 0.78);
    const vbar = q('vbar');
    if (vbar.length) {
      tl.fromTo(
        vbar,
        { scaleX: 1, transformOrigin: '0% 50%' },
        { scaleX: 0, transformOrigin: '0% 50%', duration: Math.max(1.5, victorySec - 0.35), ease: 'none' },
        0.25
      );
    }
    confetti(root, scene);
  }
  return tl;
}

// ---------- Pantallas ----------

/** El nombre, letra a letra, para que cada una entre por separado. */
const Letters: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text
      .split(' ')
      .filter(Boolean)
      .map((word, index) => (
        <React.Fragment key={index}>
          <span className="tn-word">
            {Array.from(word).map((letter, at) => (
              <span key={at} className="tn-l">
                {letter}
              </span>
            ))}
          </span>{' '}
        </React.Fragment>
      ))}
  </>
);

const Row: React.FC<{ side: BracketSide; other: BracketSide; match: BracketMatch; state: TournamentState; final: boolean }> = ({ side, other, match, state, final }) => {
  if (typeof side !== 'number') {
    return (
      <div className="tn-mr" data-tbd="">
        <i />
        <span>{side === 'bye' ? 'Sin rival' : 'Por definir'}</span>
        <em />
      </div>
    );
  }
  const won = match.played && match.out === side;
  const lost = match.played && !won;
  // Un pase directo no es una victoria: se dice, pero sin el filete de color
  const pass = other === 'bye';
  return (
    <div className="tn-mr" data-w={won ? '' : undefined} data-l={lost ? '' : undefined} data-pass={pass ? '' : undefined} data-t={side}>
      <i />
      <span>{state.teams[side]?.name ?? 'Equipo'}</span>
      <em>{won ? (final ? 'Campeón' : 'Avanza') : pass ? 'Pasa' : ''}</em>
    </div>
  );
};

/** Conectores geométricos entre las partidas de una ronda y la siguiente. */
const RoundWires: React.FC<{ list: number[]; bracket: BracketMatch[]; now: number | null }> = ({ list, bracket, now }) => {
  const count = list.length;
  if (count < 2) return null;
  const pairs = Math.floor(count / 2);
  return (
    <svg className="tn-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: pairs }, (_, pairIdx) => {
        const topIndex = list[pairIdx * 2];
        const botIndex = list[pairIdx * 2 + 1];
        const topMatch = bracket[topIndex];
        const botMatch = bracket[botIndex];
        const yTop = ((pairIdx * 2 + 0.5) / count) * 100;
        const yBot = ((pairIdx * 2 + 1.5) / count) * 100;
        const yMid = ((pairIdx * 2 + 1) / count) * 100;
        const topLit = Boolean(topMatch && (topMatch.played || typeof topMatch.out === 'number'));
        const botLit = Boolean(botMatch && (botMatch.played || typeof botMatch.out === 'number'));
        const topNow = now === topIndex;
        const botNow = now === botIndex;
        const topPath = `M 0 ${yTop} H 52 V ${yMid} H 100`;
        const botPath = `M 0 ${yBot} H 52 V ${yMid} H 100`;
        return (
          <g key={pairIdx} data-a="wire">
            <path className="tn-wire" d={topPath} vectorEffect="non-scaling-stroke" />
            <path className="tn-wire" d={botPath} vectorEffect="non-scaling-stroke" />
            {(topLit || topNow) && (
              <path
                className="tn-wire tn-wire--lit"
                data-now={topNow ? '' : undefined}
                d={topPath}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {(botLit || botNow) && (
              <path
                className="tn-wire tn-wire--lit"
                data-now={botNow ? '' : undefined}
                d={botPath}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};

const Bracket: React.FC<{ state: TournamentState }> = ({ state }) => {
  const bracket = buildBracket(state);
  const rounds = roundMatches(state.size);
  const now = currentMatch(state);
  return (
    <div className="tn-br" data-size={state.size} style={{ '--tn-rounds': rounds.length } as React.CSSProperties}>
      <div className="tn-heads">
        {rounds.map((_, round) => (
          <span key={round} className="tn-h">
            {roundTitle(round, state.size)}
          </span>
        ))}
      </div>
      <div className="tn-cols">
        {rounds.map((list, round) => (
          <div key={round} className="tn-col">
            {list.map((index) => {
              const match = bracket[index];
              return (
                <div
                  key={index}
                  className="tn-mc"
                  data-match={index}
                  data-now={now === index ? '' : undefined}
                  data-done={match.played ? '' : undefined}
                  data-empty={match.out === 'bye' ? '' : undefined}
                >
                  <div className="tn-plate">
                    <Row side={match.sides[0]} other={match.sides[1]} match={match} state={state} final={round === rounds.length - 1} />
                    <Row side={match.sides[1]} other={match.sides[0]} match={match} state={state} final={round === rounds.length - 1} />
                  </div>
                </div>
              );
            })}
            {round < rounds.length - 1 && <RoundWires list={list} bracket={bracket} now={now} />}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Qué pantalla se pinta y qué subtítulo lleva el marco. null: no hay con qué pintarla (un instante entre dos estados). */
function screenOf(scene: TournamentScene, state: TournamentState, tournamentName: string): { sub: string; main: React.ReactNode } | null {
  const size = state.size;
  const team = (index: number) => state.teams[index]?.name ?? 'Equipo';
  const champion = championOf(state);
  const now = currentMatch(state);

  if (scene === 'llave') {
    const sub = champion !== null ? 'Llave final' : now !== null ? `En juego: ${matchName(now, size)}` : 'Llave';
    return { sub, main: <Bracket state={state} /> };
  }

  if (scene === 'sigue') {
    const teams = now === null ? null : matchTeams(state, now);
    if (now === null || !teams) return null;
    const next = nextAfter(state, now);
    const after = next === null ? null : matchTeams(state, next);
    return {
      sub: roundLabel(roundOf(now, size), size),
      main: (
        <div className="tn-nx">
          <span className="tn-tag" data-a="tag">
            Sigue · {matchName(now, size)}
          </span>
          <div className="tn-vs">
            <div className="tn-t tn-plate" data-a="left">
              <p className="tn-title">{team(teams[0])}</p>
              <i className="tn-shine" data-a="shine" />
            </div>
            <i data-a="vs">VS</i>
            <div className="tn-t tn-plate" data-a="right">
              <p className="tn-title">{team(teams[1])}</p>
              <i className="tn-shine" data-a="shine" />
            </div>
          </div>
          <span className="tn-after tn-plate" data-a="after">
            {after ? (
              <>
                <span className="tn-mut">Después:</span> {team(after[0])} contra {team(after[1])}
              </>
            ) : playedCount(state) === playableCount(state) - 1 ? (
              'Es la última partida del torneo'
            ) : (
              'La siguiente se decide con esta'
            )}
          </span>
        </div>
      ),
    };
  }

  if (scene === 'tabla') {
    const rows = standings(state);
    const wide = rows.length > 8;
    return {
      sub: 'Tabla de posiciones',
      main: (
        <div className="tn-tb" data-wide={wide ? '' : undefined} style={{ '--tn-rows': Math.ceil(rows.length / 2) } as React.CSSProperties}>
          {rows.map((row, place) => (
            <div key={row.team} className="tn-tr tn-plate" data-a="row" data-out={row.out !== null && !row.champ ? '' : undefined} data-top={row.out === null ? '' : undefined}>
              <b>{place + 1}</b>
              <p>{row.name}</p>
              {/* En dos columnas no cabe la frase entera: «Fuera en octavos de final» queda en «Octavos» */}
              <em>{wide ? row.status.replace(/^Fuera en /, '').replace(/ de final$/, '') : row.status}</em>
              <span>
                {row.wins}V {row.losses}D
              </span>
            </div>
          ))}
        </div>
      ),
    };
  }

  if (scene === 'victoria') {
    const last = state.last;
    const winner = last === null ? null : state.results[last];
    const teams = last === null ? null : matchTeams(state, last);
    if (last === null || winner == null || !teams) return null;
    const loser = teams[0] === winner ? teams[1] : teams[0];
    const to = advanceTo(last, size);
    return {
      sub: roundLabel(roundOf(last, size), size),
      main: (
        <>
          <div className="tn-fx" data-a="fx" />
          <div className="tn-vic">
            <span className="tn-tag" data-a="tag">
              Victoria · {matchName(last, size)}
            </span>
            <div className="tn-card tn-plate" data-a="card">
              <p className="tn-vname tn-title">
                <Letters text={team(winner)} />
              </p>
              {to && (
                <span className="tn-sub" data-a="sub">
                  Avanza a {to}
                </span>
              )}
              <i className="tn-shine" data-a="shine" />
              <i className="tn-vic-bar" data-a="vbar" />
            </div>
            <span className="tn-after tn-plate" data-a="after">
              <span className="tn-mut">Vence a</span> {team(loser)}
            </span>
          </div>
        </>
      ),
    };
  }

  if (scene === 'campeon') {
    if (champion === null) {
      const left = playableCount(state) - playedCount(state);
      return {
        sub: 'Aún sin campeón',
        main: (
          <div className="tn-vic">
            <div className="tn-card tn-plate" data-a="card">
              <p className="tn-sub">Todavía no hay campeón</p>
              <span className="tn-mut">{left > 0 ? (left === 1 ? 'Falta jugar una partida.' : `Falta jugar ${left} partidas.`) : 'Faltan equipos en la llave.'}</span>
            </div>
          </div>
        ),
      };
    }
    const final = buildBracket(state).filter((match) => match.played).pop();
    const loser = final ? final.sides.find((side) => typeof side === 'number' && side !== champion) : undefined;
    return {
      sub: 'Gran final',
      main: (
        <>
          <div className="tn-fx" data-a="fx" />
          <div className="tn-ch">
            <div className="tn-ring" data-a="ring">
              1.º
            </div>
            <span className="tn-tag" data-a="tag">
              Campeón de {tournamentName}
            </span>
            <div className="tn-card tn-plate" data-a="card">
              <p className="tn-chname tn-title">
                <Letters text={team(champion)} />
              </p>
              <i className="tn-shine" data-a="shine" />
            </div>
            {typeof loser === 'number' && (
              <span className="tn-after tn-plate" data-a="after">
                <span className="tn-mut">Finalista:</span> {team(loser)}
              </span>
            )}
          </div>
        </>
      ),
    };
  }

  return null;
}

// ---------- La capa que pinta ----------

export const TournamentLayer: React.FC<TournamentLayerProps> = ({ settings, state, isStudio = false, scene, still = false, replay = 0, onNarrate }) => {
  const [, setTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const prevReplayRef = useRef(replay);
  const live = useRef({ settings, state, scene, onNarrate });
  live.current = { settings, state, scene, onNarrate };

  const target = scene ?? sceneNow(state, settings.victorySec, Date.now());
  const targetKey = `${target}|${state.sceneAt}|${replay}`;
  const [view, setView] = useState<{ scene: TournamentScene; key: string; flash: number | null; animateFrame: boolean }>({
    scene: target,
    key: targetKey,
    flash: null,
    animateFrame: true,
  });

  // La pantalla de victoria caduca sola: un temporizador vuelve a mirar qué toca
  useEffect(() => {
    if (scene || state.scene !== 'victoria') return;
    const left = state.sceneAt + settings.victorySec * 1000 - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), left + 40);
    return () => clearTimeout(timer);
  }, [scene, state.scene, state.sceneAt, settings.victorySec]);

  // Cambio de pantalla: mantiene el marco (logo + patrocinadores) salvo al abrir/cerrar todo o repetir prueba
  useEffect(() => {
    if (view.key === targetKey) return;
    const { state: current } = live.current;
    const replayChanged = prevReplayRef.current !== replay;
    prevReplayRef.current = replay;
    // Tras una victoria, quien avanza entra en su casilla de la llave
    const flash = view.scene === 'victoria' && target === 'llave' && current.last !== null ? (current.results[current.last] ?? null) : null;
    const animateFrame = view.scene === 'oculto' || target === 'oculto' || replayChanged;
    const next = { scene: target, key: targetKey, flash, animateFrame };
    const body = bodyRef.current;
    if (still || !body || view.scene === 'oculto') {
      setView(next);
      return;
    }
    const mainEl = body.querySelector<HTMLElement>('.tn-main');
    const subEl = body.querySelector<HTMLElement>('[data-a="top-sub"]');
    const exitTargets =
      target === 'oculto'
        ? Array.from(body.children)
        : [mainEl, subEl].filter((el): el is HTMLElement => Boolean(el));
    const exitVars: gsap.TweenVars = reduced()
      ? { autoAlpha: 0, duration: EXIT_SEC, ease: 'power2.out' }
      : { autoAlpha: 0, y: -8, scale: 0.985, filter: 'blur(3px)', duration: EXIT_SEC, ease: 'power2.in' };
    const tween = gsap.to(exitTargets, exitVars);
    const timer = setTimeout(() => setView(next), EXIT_SEC * 1000 + 30);
    return () => {
      clearTimeout(timer);
      tween.kill();
    };
  }, [targetKey, target, view.key, view.scene, still, replay]);

  // Entrada de la pantalla recién puesta
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || still || view.scene === 'oculto') return;
    let tl: gsap.core.Timeline | null = null;
    const ctx = gsap.context(() => {
      tl = playEnter(body, view.scene, view.flash, {
        animateFrame: view.animateFrame,
        victorySec: live.current.settings.victorySec,
      });
    }, body);
    // Si OBS frena la animación con la fuente oculta, la pantalla queda entera igual
    const settle = setTimeout(() => tl?.progress(1), SETTLE_MS);
    // El confeti se retira con un temporizador, llegue o no al suelo
    const sweep = setTimeout(() => body.querySelector('[data-a="fx"]')?.replaceChildren(), 6000);
    return () => {
      clearTimeout(settle);
      clearTimeout(sweep);
      ctx.revert();
      body.querySelector('[data-a="fx"]')?.replaceChildren();
    };
    // Solo al cambiar de pantalla: un resultado nuevo en la misma pantalla no repite la entrada completa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.key, still]);

  // Micro-coreografía cuando cambia el estado dentro de la misma pantalla (ej. deshacer o marcar en vivo sobre llave/tabla)
  const prevVersionRef = useRef(state.version);
  useEffect(() => {
    if (prevVersionRef.current === state.version) return;
    prevVersionRef.current = state.version;
    const body = bodyRef.current;
    if (!body || still || reduced() || view.key !== targetKey) return;
    const ctx = gsap.context(() => {
      if (view.scene === 'llave') {
        const nowCard = body.querySelector<HTMLElement>('.tn-mc[data-now]');
        if (nowCard) {
          gsap.fromTo(nowCard, { scale: 0.96 }, { scale: 1, duration: 0.36, ease: 'back.out(1.8)', clearProps: 'transform' });
        }
        if (state.last !== null) {
          const lastWinner = state.results[state.last];
          if (typeof lastWinner === 'number') {
            const rows = Array.from(body.querySelectorAll<HTMLElement>(`.tn-mr[data-t="${lastWinner}"]`));
            const latestRow = rows[rows.length - 1];
            if (latestRow) {
              gsap.fromTo(latestRow, { x: -10, autoAlpha: 0.35 }, { x: 0, autoAlpha: 1, duration: 0.34, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
            }
          }
        }
      } else if (view.scene === 'tabla') {
        const rows = Array.from(body.querySelectorAll<HTMLElement>('.tn-tr'));
        if (rows.length) {
          gsap.fromTo(rows, { x: 10 }, { x: 0, duration: 0.26, ease: 'power2.out', stagger: 0.025, clearProps: 'transform' });
        }
      }
    }, body);
    return () => ctx.revert();
  }, [state.version, state.last, state.results, still, view.key, view.scene, targetKey]);

  // Narrador: cuenta cada cambio marcado en el estado. Lo que había al montar no se narra
  const cueRef = useRef(state.cueAt);
  useEffect(() => {
    if (state.cueAt === cueRef.current) return;
    cueRef.current = state.cueAt;
    const current = live.current;
    if (!current.settings.narrator || !current.onNarrate || current.scene) return;
    const line = narrationLine(current.state, sceneNow(current.state, current.settings.victorySec, Date.now()), current.settings.name);
    if (line) current.onNarrate(line);
  }, [state.cueAt]);

  const logoUrl = settings.logo ? resolveMediaUrl(settings.logo.url) : null;
  const sponsors = useMemo(
    () => settings.sponsors.map((sponsor) => ({ ...sponsor, src: sponsor.image ? resolveMediaUrl(sponsor.image.url) : null })).filter((sponsor) => sponsor.src || sponsor.name),
    [settings.sponsors]
  );
  const screen = view.scene === 'oculto' ? null : screenOf(view.scene, state, settings.name);

  return (
    <div
      className="tnl"
      data-style={settings.style}
      data-custom={settings.customColor ? '' : undefined}
      data-studio={isStudio ? '' : undefined}
      aria-hidden="true"
      style={settings.customColor ? ({ '--tn-custom': settings.color, '--tn-custom-ink': inkFor(settings.color) } as React.CSSProperties) : undefined}
    >
      {screen && (
        <div ref={bodyRef} style={{ display: 'contents' }}>
          <div className="tn-top" data-a="top">
            {(logoUrl || isStudio) && <div className="tn-logo tn-plate">{logoUrl ? <img src={logoUrl} alt="" /> : 'TU LOGO'}</div>}
            <div className="tn-name tn-plate">
              <b className="tn-title">{settings.name}</b>
              <span key={view.key} data-a="top-sub">
                {settings.game} · {screen.sub}
              </span>
            </div>
          </div>
          <div key={view.key} className="tn-main">
            {screen.main}
          </div>
          {sponsors.length > 0 ? (
            <div className="tn-sp tn-plate" data-a="sp">
              <span className="tn-mut">Con el apoyo de</span>
              {sponsors.map((sponsor) => (sponsor.src ? <img key={sponsor.id} src={sponsor.src} alt="" /> : <b key={sponsor.id}>{sponsor.name}</b>))}
            </div>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  );
};

// ---------- La capa de OBS ----------

export interface TournamentLiveHandle {
  /** Mensaje del streamer o de un moderador. Devuelve true si era un comando del torneo. */
  command: (message: string, sender: { name: string; role: UserRole }) => boolean;
  /** Prueba del panel: repite la entrada de la pantalla y, con `say`, la frase del narrador. */
  test: (say: boolean) => void;
}

interface TournamentLiveProps {
  settings: TournamentSettings;
  /** Pantallas de ejemplo una tras otra, para colocar la capa en OBS. */
  demo?: boolean;
  /** Pone la frase del narrador en la cola de voz del widget. */
  speak?: (text: string, options: { voiceId?: string }) => void;
  /** Estado de reserva (el de la URL de OBS), por si este navegador no tiene ninguno más nuevo. */
  fallbackState?: TournamentState | null;
}

const DEMO_SCENES: TournamentScene[] = ['llave', 'sigue', 'tabla', 'victoria', 'campeon'];
const DEMO_STEP_MS = 7000;

function firstState(fallback: TournamentState | null | undefined, size: TournamentSettings['size']): TournamentState {
  const stored = tournamentStore().read();
  // Con el estado en la nube manda ella: el de la URL es de cuando se copió
  if (stored && tournamentStore().cloud?.()) return stored;
  if (stored && fallback) return isNewerState(fallback, stored) ? fallback : stored;
  return stored ?? fallback ?? emptyTournamentState(size);
}

export const TournamentLiveLayer = forwardRef<TournamentLiveHandle, TournamentLiveProps>(({ settings, demo = false, speak, fallbackState }, ref) => {
  const [state, setState] = useState(() => firstState(fallbackState, settings.size));
  const [replay, setReplay] = useState(0);
  const [demoStep, setDemoStep] = useState(0);
  const live = useRef({ settings, state, speak });
  live.current = { settings, state, speak };

  // Lo que cambian el panel u otra fuente: solo se adopta si es más nuevo que lo que hay,
  // salvo que venga obligado: es el vigente en la nube y un cambio de aquí pudo ser rechazado
  useEffect(
    () =>
      tournamentStore().subscribe((next, forced) => {
        if (!forced && !isNewerState(next, live.current.state)) return;
        live.current.state = next;
        setState(next);
      }),
    []
  );

  useEffect(() => {
    if (!demo) return;
    const timer = setInterval(() => setDemoStep((n) => n + 1), DEMO_STEP_MS);
    return () => clearInterval(timer);
  }, [demo]);

  const narrate = (line: string) => live.current.speak?.(line, { voiceId: live.current.settings.voiceId || undefined });

  useImperativeHandle(
    ref,
    () => ({
      command: (message) => {
        const current = live.current;
        if (!current.settings.enabled) return false;
        const result = interpretTournamentCommand(message, current.settings.commands, current.state, {
          victorySec: current.settings.victorySec,
          now: Date.now(),
        });
        if (!result) return false;
        if (result.state) {
          // El estado cambia aquí, en la fuente, y va al almacén (ver la cabecera)
          current.state = result.state;
          setState(result.state);
          tournamentStore().write(result.state);
        }
        return true;
      },
      test: (say) => {
        setReplay((n) => n + 1);
        const current = live.current;
        if (!say || !current.settings.narrator) return;
        const line = narrationLine(current.state, sceneNow(current.state, current.settings.victorySec, Date.now()), current.settings.name);
        if (line) current.speak?.(line, { voiceId: current.settings.voiceId || undefined });
      },
    }),
    []
  );

  if (demo) {
    const scene = DEMO_SCENES[demoStep % DEMO_SCENES.length];
    const sample = scene === 'campeon' ? sampleFinishedState(settings.size) : sampleTournamentState(settings.size);
    return <TournamentLayer settings={settings} state={sample} scene={scene} />;
  }
  if (!settings.enabled) return null;
  return <TournamentLayer settings={settings} state={state} replay={replay} onNarrate={narrate} />;
});

TournamentLiveLayer.displayName = 'TournamentLiveLayer';
