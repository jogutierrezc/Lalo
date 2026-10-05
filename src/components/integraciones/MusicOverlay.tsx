/**
 * src/components/integraciones/MusicOverlay.tsx
 *
 * La capa «Ahora suena» tal como se ve en OBS y en el monitor del panel: los
 * seis diseños aprobados, con su entrada, su cambio de canción y su salida.
 *
 * Quien la monta le cuenta lo que pasa (canción nueva, pausa, deja de sonar, el
 * botón en directo...) con `input`. Las reglas de cuándo se muestra viven en
 * utils/musicRules.ts; aquí solo se pinta y se anima.
 *
 * El contenido se escribe directamente en el DOM, no con estado de React: así
 * el cambio de canción ocurre justo en el punto de la animación en que el texto
 * anterior ya no se ve.
 *
 * Normas de la portada: va entera (object-fit: contain), sin nada encima, sin
 * girar ni deformar, con esquinas de 4 px (8 px en «Portada»). Solo cambia su
 * opacidad o se mueve con la pieza completa.
 */

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import type { MusicSettings } from '../../types/music';
import { reduced } from '../../utils/alertMotion';
import { MUSIC_IDLE, formatClock, hideAfterMs, musicStep, progressRatio, type MusicInput, type MusicState, type MusicStep, type MusicTrack } from '../../utils/musicRules';
import { BrandMark } from './BrandMark';
import { coverAccent } from './coverAccent';
import { MUSIC_MOTION, edgeDirection, partList, type MusicParts } from './musicMotion';
import '../../styles/ahora-suena.css';

export interface MusicOverlayHandle {
  /** Algo pasó. Con `song` hay que dar la canción; `progressMs` es por dónde va. */
  input: (input: MusicInput, track?: MusicTrack, progressMs?: number) => MusicStep;
  /** Corrige por dónde va la canción (cada lectura del servidor). */
  sync: (progressMs: number) => void;
  state: () => MusicState;
}

interface MusicOverlayProps {
  settings: MusicSettings;
  /** Avisa cuando la capa entra o sale, para el botón «Mostrar ahora / Ocultar ahora». */
  onVisible?: (visible: boolean) => void;
  /** La capa se retiró sola al pasar los segundos. */
  onTimeout?: () => void;
  /** Muestra quieta (editor de Studio): el reloj no avanza y ni el disco, ni el medidor ni el título se mueven. */
  still?: boolean;
}

/** Una orden en directo de hace más de esto ya no se obedece (por ejemplo, al abrir la fuente). */
const LIVE_MAX_AGE_MS = 30_000;

export const MusicOverlay = forwardRef<MusicOverlayHandle, MusicOverlayProps>(({ settings, onVisible, onTimeout, still = false }, ref) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<HTMLDivElement | null>(null);
  const parts = useRef<(MusicParts & { ts: HTMLElement; an: HTMLElement; ex: HTMLElement; pu: HTMLElement; time: HTMLElement; img: HTMLImageElement; sample: HTMLElement; eq: HTMLElement[]; discFace: HTMLElement }) | null>(null);

  const state = useRef<MusicState>(MUSIC_IDLE);
  const track = useRef<MusicTrack | null>(null);
  const clock = useRef({ base: 0, at: 0 });
  const tl = useRef<gsap.core.Timeline | null>(null);
  const marqueeTw = useRef<gsap.core.Tween | null>(null);
  const spinTw = useRef<gsap.core.Tween | null>(null);
  const eqTw = useRef<gsap.core.Tween | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ settings, onVisible, onTimeout, still });
  live.current = { settings, onVisible, onTimeout, still };

  const progressNow = () => {
    const t = track.current;
    const elapsed = state.current.playing && !live.current.still ? performance.now() - clock.current.at : 0;
    const value = clock.current.base + elapsed;
    return t && t.durationMs ? Math.min(t.durationMs, value) : value;
  };

  const tick = () => {
    const e = parts.current;
    const t = track.current;
    if (!e || !t) return;
    const at = progressNow();
    e.pu.style.transform = `scaleX(${progressRatio(at, t.durationMs)})`;
    e.time.textContent = t.durationMs ? `${formatClock(at)} / ${formatClock(t.durationMs)}` : formatClock(at);
  };

  const marquee = () => {
    const e = parts.current;
    if (!e) return;
    marqueeTw.current?.kill();
    marqueeTw.current = null;
    gsap.set(e.ts, { clearProps: 'transform' });
    e.t.classList.remove('ell');
    if (live.current.settings.design === 'portada') return;
    const over = e.t.scrollWidth - e.t.clientWidth;
    if (over <= 2) return;
    if (reduced() || live.current.still) {
      e.t.classList.add('ell');
      return;
    }
    // Los títulos largos se deslizan despacio para poder leerse enteros
    marqueeTw.current = gsap.to(e.ts, { x: -over, duration: Math.max(2.5, over / 36), ease: 'sine.inOut', delay: 1.2, repeat: -1, yoyo: true, repeatDelay: 1.4 });
  };

  const accent = () => {
    const e = parts.current;
    const t = track.current;
    if (!e) return;
    const s = live.current.settings;
    const set = (color: string) => e.np.style.setProperty('--ac', color);
    if (s.accent === 'fixed' || !t) return set(s.color);
    if (t.sampleAccent) return set(t.sampleAccent);
    set(s.color);
    if (!t.art) return;
    const id = t.id;
    coverAccent(t.art).then((color) => {
      if (color && track.current?.id === id && live.current.settings.accent === 'cover') set(color);
    });
  };

  /** Escribe la canción en la pieza. */
  const paint = () => {
    const e = parts.current;
    const t = track.current;
    if (!e || !t) return;
    e.ts.textContent = t.title;
    e.an.textContent = t.artists;
    e.al.textContent = t.album;
    e.ex.hidden = !t.explicit;
    e.sample.hidden = !t.sampleCover;
    e.sample.className = `cv ${t.sampleCover ?? ''}`;
    e.img.hidden = !t.art;
    if (t.art) {
      if (e.img.getAttribute('src') !== t.art) e.img.src = t.art;
    } else {
      e.img.removeAttribute('src');
    }
    // Archivo local o pódcast sin imagen: la pieza se recoloca sin portada
    e.np.toggleAttribute('data-noart', !t.art && !t.sampleCover);
    e.kick.textContent = state.current.playing ? 'Ahora suena' : 'En pausa';
    accent();
    tick();
    marquee();
  };

  const motion = () => {
    const s = state.current;
    const on = !live.current.still && s.vis && s.playing && s.music;
    const design = live.current.settings.design;
    if (spinTw.current) on && design === 'disco' ? spinTw.current.play() : spinTw.current.pause();
    if (eqTw.current) on && design === 'linea' ? eqTw.current.play() : eqTw.current.pause();
  };

  const kill = () => {
    const e = parts.current;
    tl.current?.kill();
    tl.current = null;
    if (e) gsap.set(partList(e), { clearProps: 'transform,opacity,clipPath' });
  };

  const run = (step: MusicStep) => {
    const e = parts.current;
    if (!e) return;
    const s = live.current.settings;
    const was = state.current.vis;
    state.current = step.state;
    const [sx, sy] = edgeDirection(s.pos);
    step.effects.forEach((effect) => {
      if (effect === 'render') paint();
      if (effect === 'enter') {
        kill();
        gsap.set(e.np, { clearProps: 'transform,clipPath,opacity,visibility' });
        paint();
        if (reduced()) gsap.set(e.np, { autoAlpha: 1 });
        else {
          tl.current = gsap.timeline();
          MUSIC_MOTION[s.design].in(tl.current, e, sx, sy);
        }
      }
      if (effect === 'leave') {
        kill();
        if (reduced()) gsap.set(e.np, { autoAlpha: 0 });
        else {
          tl.current = gsap.timeline({ onComplete: () => gsap.set(e.np, { autoAlpha: 0 }) });
          MUSIC_MOTION[s.design].out(tl.current, e, sx, sy);
        }
      }
      if (effect === 'swap') {
        kill();
        gsap.set(e.np, { clearProps: 'transform,clipPath' });
        gsap.set(e.np, { autoAlpha: 1 });
        if (reduced()) paint();
        else {
          tl.current = gsap.timeline();
          MUSIC_MOTION[s.design].sw(tl.current, e, paint);
        }
      }
      if (effect === 'arm' || effect === 'disarm') {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = null;
        const wait = effect === 'arm' ? hideAfterMs(s.show, s.secs) : null;
        // La retirada va con un temporizador: OBS detiene las animaciones de las fuentes ocultas
        if (wait !== null) {
          hideTimer.current = setTimeout(() => {
            feed.current({ type: 'timeout' });
            live.current.onTimeout?.();
          }, wait);
        }
      }
    });
    e.kick.textContent = step.state.playing ? 'Ahora suena' : 'En pausa';
    posRef.current?.classList.toggle('dim', step.state.vis && !step.state.playing);
    motion();
    if (was !== step.state.vis) live.current.onVisible?.(step.state.vis);
  };

  const feed = useRef<(input: MusicInput, next?: MusicTrack, progressMs?: number) => MusicStep>(() => ({ state: MUSIC_IDLE, effects: [] }));
  feed.current = (input, next, progressMs) => {
    const s = live.current.settings;
    const before = state.current;
    const step = musicStep(before, input, { show: s.show, pause: s.pause });
    // El reloj se detiene o arranca con la canción
    if (input.type === 'song') {
      if (next) track.current = next;
      clock.current = { base: progressMs ?? 0, at: performance.now() };
    } else if (before.playing !== step.state.playing) {
      const at = before.playing ? clock.current.base + (performance.now() - clock.current.at) : clock.current.base;
      clock.current = { base: at, at: performance.now() };
    }
    run(step);
    return step;
  };

  useImperativeHandle(
    ref,
    () => ({
      input: (input, next, progressMs) => feed.current(input, next, progressMs),
      sync: (progressMs) => {
        clock.current = { base: progressMs, at: performance.now() };
        tick();
      },
      state: () => state.current,
    }),
    []
  );

  // Piezas, giro del disco, medidor y reloj
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T;
    parts.current = {
      np: root,
      bg: q('.np-bg'),
      disc: q('.np-disc'),
      cov: q('.np-cov'),
      tx: q('.np-tx'),
      kick: q('.np-kick'),
      t: q('.np-t'),
      a: q('.np-a'),
      al: q('.np-al'),
      pr: q('.np-pr'),
      side: q('.np-side'),
      wipe: q('.np-wipe'),
      ts: q('.np-t span'),
      an: q('.np-an'),
      ex: q('.np-e'),
      pu: q('.np-pr u'),
      time: q('.np-time'),
      img: q<HTMLImageElement>('img.cv'),
      sample: q('span.cv'),
      eq: Array.from(root.querySelectorAll<HTMLElement>('.np-eq i')),
      discFace: q('.np-disc i'),
    };
    const e = parts.current;
    if (!reduced()) {
      spinTw.current = gsap.to(e.discFace, { rotation: 360, duration: 5, ease: 'none', repeat: -1, paused: true });
      eqTw.current = gsap.to(e.eq, { scaleY: 0.3, duration: 0.42, ease: 'sine.inOut', repeat: -1, yoyo: true, stagger: 0.14, paused: true });
    }
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      tl.current?.kill();
      marqueeTw.current?.kill();
      spinTw.current?.kill();
      eqTw.current?.kill();
      gsap.killTweensOf([e.np, e.ts, ...partList(e)]);
    };
  }, []);

  // Cambios de ajustes con la capa ya montada
  const mounted = useRef(false);
  const previous = useRef(settings);
  useEffect(() => {
    const before = previous.current;
    previous.current = settings;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (before.design !== settings.design || before.pos !== settings.pos) feed.current({ type: 'preview' });
    else if (before.show !== settings.show) feed.current({ type: 'rules', changed: 'show' });
    else if (before.pause !== settings.pause) feed.current({ type: 'rules', changed: 'pause' });
    else if (before.secs !== settings.secs && state.current.vis) run({ state: state.current, effects: ['arm'] });
    else {
      accent();
      marquee();
    }
    if (before.live.at !== settings.live.at && settings.live.action && Date.now() - settings.live.at < LIVE_MAX_AGE_MS) {
      feed.current({ type: 'live', action: settings.live.action });
    }
  }, [settings]);

  const classes = ['np', !settings.art && 'no-art', !settings.bar && 'no-bar', !settings.artist && 'no-artist', !settings.album && 'no-album'].filter(Boolean).join(' ');

  return (
    <div className="itg-ov">
      <div ref={posRef} className="pos" data-p={settings.pos} style={{ fontSize: `${settings.size}%` }}>
        <div ref={rootRef} className={classes} data-k={settings.design}>
          <div className="np-bg" />
          <div className="np-disc">
            <i />
          </div>
          <div className="np-eq" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="np-cov">
            <span className="cv" role="img" aria-label="Portada de ejemplo" hidden />
            <img className="cv" alt="Portada del álbum" hidden />
          </div>
          <div className="np-tx">
            <div className="np-kick">Ahora suena</div>
            <div className="np-t">
              <span />
            </div>
            <div className="np-a">
              <b className="np-e" title="Contenido explícito" hidden>
                E
              </b>
              <span className="np-an" />
            </div>
            <div className="np-al" />
            <i className="np-wipe" aria-hidden="true" />
          </div>
          <div className="np-pr">
            <u />
          </div>
          <div className="np-side">
            <span className="np-time" />
            <BrandMark brand="spotify" className="np-sp" />
          </div>
        </div>
      </div>
    </div>
  );
});

MusicOverlay.displayName = 'MusicOverlay';
