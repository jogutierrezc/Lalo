/**
 * src/components/recompensas/RewardsLayer.tsx
 *
 * Capa «Recompensas». La usan la fuente de navegador de OBS (Widget.tsx) y el
 * monitor de RewardsStudio.
 *
 * - Reacciona sola a lo que llega por el chat: cheers con bits y canjes de
 *   puntos que piden texto. Las pruebas del panel entran por `fire`.
 * - Antes de mostrar nada carga el sonido. La placa aparece y el sonido empieza
 *   en la misma vuelta del navegador; la placa se queda un mínimo aunque el clip
 *   dure menos de un segundo y, si es largo, hasta que acaba (tope de 30 s).
 * - Cada recompensa lleva su propio temporizador. Varias a la vez van en cola
 *   o se solapan hasta un máximo, según los ajustes.
 * - Un uso antes de tiempo (espera, límite por espectador, cola llena) se
 *   descarta y se anota; no se guarda para después.
 * - En las fuentes de OBS el sonido arranca solo. En una pestaña normal el
 *   navegador puede impedirlo hasta que se pulse en la página: se anota y la
 *   cola sigue.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import gsap from 'gsap';
import {
  CustomRewardItem,
  PlateStyleId,
  RewardVideoPosition,
  RewardsSettings,
  buildRewardNotice,
  loadRewardsSettings,
  normalizeReward,
  plateStyleFor,
} from '../../types/rewards';
import { resolveMediaUrl } from '../../lib/mediaRef';
import { reduced } from '../../utils/alertMotion';
import { playAlertAudio } from '../../utils/alertsAudio';
import { listenBus } from '../../utils/bus';
import type { ChatTags, UserRole } from '../../utils/moderation';
import { VideoBox, ZONE_NAMES, fixedBox, randomBox, videoWidthPercent } from '../../utils/rewardPosition';
import {
  AUDIENCE_TEXT,
  GateState,
  MAX_REWARD_SECONDS,
  SYNTH_SECONDS,
  canActivate,
  checkGate,
  commitGate,
  emptyGate,
  admit,
  readChatTrigger,
  startable,
  staySeconds,
} from '../../utils/rewardsLogic';
import { RewardTriggerInput, RewardTriggerResult, registerRewardsEngine, resolveReward, sourceLabel } from '../../utils/rewardsEngine';
import { PlateIn, Shown, VideoIn } from './RewardShown';

export interface RewardRequest {
  reward: CustomRewardItem;
  /** Nombre visible de quien la activa. */
  user: string;
  /** Usuario en minúsculas, para el límite por espectador. */
  username?: string;
  /** Qué la activó, tal como sale en la placa. */
  why: string;
  message?: string;
  amount?: string;
  unit?: string;
  /** Muestra sin sonido (para colocar la capa en OBS). */
  silent?: boolean;
  /** Recuadro de muestra en lugar de un vídeo real. */
  sampleVideo?: boolean;
  /** Tiempo fijo en pantalla, para las muestras. */
  holdSeconds?: number;
}

export interface RewardsLayerHandle {
  /** Lanza una recompensa. Con `gates` se aplican esperas y límites. Devuelve false si se descarta. */
  fire: (request: RewardRequest, gates?: boolean) => boolean;
  /** Entrada común: elige la recompensa y aplica permiso, esperas, límite y cola. */
  trigger: (input: RewardTriggerInput) => RewardTriggerResult;
  /** Mensaje del chat con sus etiquetas. Devuelve true si disparó una recompensa. */
  chat: (tags: ChatTags & { 'display-name'?: string }, message: string, role: UserRole) => boolean;
  /** Vacía la cola y retira lo que haya en pantalla. */
  clear: () => void;
}

interface RewardsLayerProps {
  /** Ajustes vivos (estudio). Sin ellos, la capa los lee con `getSettings` en cada evento. */
  settings?: RewardsSettings;
  getSettings?: () => RewardsSettings;
  isStudio?: boolean;
  /** Escucha las pruebas que el panel envía a las fuentes abiertas en este navegador. */
  bus?: boolean;
  /** Muestra fija de un estilo de placa o de un vídeo, para comprobarlos a la vista. */
  demoPlate?: PlateStyleId | null;
  demoVideo?: RewardVideoPosition | null;
  onLog?: (message: string) => void;
  onCounts?: (waiting: number, active: number) => void;
}

interface Item {
  id: string;
  req: RewardRequest;
  settings: RewardsSettings;
  audio?: HTMLAudioElement;
  timers: ReturnType<typeof setTimeout>[];
  startedAt: number;
  /** Segundos mínimos antes de poder retirarla (placa mínima o duración del sonido). */
  minSeconds: number;
  dead?: boolean;
  leaving?: boolean;
}


/** Lo que se espera a que cargue un sonido antes de seguir adelante. */
const PRELOAD_MS = 1500;
const EXIT_FALLBACK_MS = 500;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

let serial = 0;
const nextId = () => `rw-${Date.now()}-${(serial += 1)}`;

/** Recompensa de ejemplo para las muestras fijas. */
export function sampleRequest(plate: PlateStyleId | null, video: RewardVideoPosition | null): RewardRequest {
  return {
    reward: normalizeReward({
      id: 'muestra',
      name: 'Bocina',
      trigger: 'bits',
      bitsMin: 100,
      showPlate: plate !== null,
      plateStyle: plate ?? 'default',
      position: video ?? 'center',
      duration: 4,
      soundType: 'none',
      showNoticeText: false,
    }),
    user: 'mar_ia',
    why: 'Cheer de 100 bits',
    amount: '100',
    unit: 'bits',
    silent: true,
    sampleVideo: video !== null,
    holdSeconds: video !== null ? 4 : 12,
  };
}

export const RewardsLayer = forwardRef<RewardsLayerHandle, RewardsLayerProps>(
  ({ settings, getSettings, isStudio = false, bus = false, demoPlate = null, demoVideo = null, onLog, onCounts }, ref) => {
    const [shown, setShown] = useState<Shown[]>([]);

    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const getSettingsRef = useRef(getSettings);
    getSettingsRef.current = getSettings;
    const onLogRef = useRef(onLog);
    onLogRef.current = onLog;
    const onCountsRef = useRef(onCounts);
    onCountsRef.current = onCounts;
    const studioRef = useRef(isStudio);
    studioRef.current = isStudio;

    const rootRef = useRef<HTMLDivElement | null>(null);
    const queueRef = useRef<Item[]>([]);
    const activeRef = useRef<Set<Item>>(new Set());
    const gateRef = useRef<GateState>(emptyGate());
    const lastZoneRef = useRef<number | null>(null);
    const aliveRef = useRef(true);
    const elsRef = useRef<Map<string, Set<HTMLElement>>>(new Map());
    const shakeRef = useRef<gsap.core.Tween | null>(null);

    const engine = useRef<{
      fire: (request: RewardRequest, gates: boolean) => boolean;
      clear: (silent?: boolean) => void;
      videoEnded: (id: string) => void;
      videoFailed: (id: string) => void;
    } | null>(null);

    if (!engine.current) {
      const current = (): RewardsSettings => settingsRef.current ?? getSettingsRef.current?.() ?? loadRewardsSettings();
      const say = (message: string) => {
        onLogRef.current?.(message);
        if (!studioRef.current) console.info('[Lalo recompensas]', message);
      };
      const counts = () => onCountsRef.current?.(queueRef.current.length, activeRef.current.size);
      const later = (item: Item, fn: () => void, ms: number) => {
        item.timers.push(setTimeout(fn, ms));
      };
      const stopTimers = (item: Item) => {
        item.timers.forEach(clearTimeout);
        item.timers = [];
      };
      const elapsed = (item: Item) => (performance.now() - item.startedAt) / 1000;
      const find = (id: string) => [...activeRef.current].find((item) => item.id === id);

      const remove = (item: Item) => {
        if (item.dead) return;
        item.dead = true;
        stopTimers(item);
        elsRef.current.get(item.id)?.forEach((el) => gsap.killTweensOf(el));
        activeRef.current.delete(item);
        if (!aliveRef.current) return;
        setShown((prev) => prev.filter((entry) => entry.id !== item.id));
        pump();
      };

      const leave = (item: Item) => {
        if (item.leaving || item.dead) return;
        item.leaving = true;
        stopTimers(item);
        // Solo se corta un sonido que ha llegado al tope; uno corto ya terminó por sí solo
        if (item.audio && !item.audio.paused && elapsed(item) >= MAX_REWARD_SECONDS) item.audio.pause();
        const els = [...(elsRef.current.get(item.id) || [])];
        if (!els.length) {
          remove(item);
          return;
        }
        // Si OBS tiene la fuente oculta y no avanza la animación, se retira igual
        later(item, () => remove(item), EXIT_FALLBACK_MS);
        gsap.killTweensOf(els);
        gsap.to(els, { opacity: 0, y: reduced() ? 0 : '0.4em', duration: 0.18, ease: 'power2.out', onComplete: () => remove(item) });
      };

      /** Llegó su hora: si el sonido sigue sonando, espera a que acabe (hasta el tope). */
      const finish = (item: Item) => {
        if (item.leaving || item.dead) return;
        const audio = item.audio;
        const spent = elapsed(item);
        if (audio && !audio.paused && !audio.ended && spent < MAX_REWARD_SECONDS) {
          stopTimers(item);
          audio.addEventListener('ended', () => leave(item), { once: true });
          later(item, () => leave(item), (MAX_REWARD_SECONDS - spent) * 1000);
          return;
        }
        leave(item);
      };

      /** Termina en cuanto se cumpla su mínimo (placa mínima o duración del sonido). */
      const endSoon = (item: Item) => {
        if (item.leaving || item.dead) return;
        const rest = item.minSeconds - elapsed(item);
        stopTimers(item);
        if (rest <= 0) finish(item);
        else later(item, () => finish(item), rest * 1000);
      };

      const show = (item: Item, clipSeconds: number, play: () => void) => {
        if (item.dead || !aliveRef.current) return;
        const { req, settings: s } = item;
        const r = req.reward;
        const videoUrl = req.sampleVideo ? null : resolveMediaUrl(r.videoUrl);
        const hasVideo = req.sampleVideo === true || videoUrl !== null;
        const untilEnd = hasVideo && !req.sampleVideo && r.duration <= 0;
        const videoSeconds = hasVideo ? (untilEnd ? MAX_REWARD_SECONDS : r.duration || 4) : 0;
        const stay =
          req.holdSeconds ?? staySeconds({ clipSeconds, videoSeconds, hasPlate: r.showPlate, minPlateSeconds: s.minPlateSeconds });
        item.minSeconds = Math.min(MAX_REWARD_SECONDS, Math.max(r.showPlate ? s.minPlateSeconds : 0, clipSeconds));

        let box: VideoBox | null = null;
        if (hasVideo && r.position !== 'fullscreen') {
          const root = rootRef.current;
          const stageAspect = root && root.clientHeight > 0 ? root.clientWidth / root.clientHeight : 16 / 9;
          const widthPercent = videoWidthPercent(r.scale);
          if (r.position === 'random') {
            box = randomBox({
              widthPercent,
              margin: r.randomMargin,
              vary: r.randomVary,
              noRepeat: r.randomNoRepeat,
              lastZone: lastZoneRef.current,
              stageAspect,
            });
            lastZoneRef.current = box.zone;
          } else {
            box = fixedBox(r.position, widthPercent, stageAspect);
          }
        }

        // «Personalizado» sin archivo: en la emisión sale la placa de la casa; en el estudio, el hueco vacío
        const wanted = plateStyleFor(r, s);
        const plateStyle: PlateStyleId =
          wanted === 'custom' && !studioRef.current && !resolveMediaUrl(s.customPlate.mediaUrl) ? 'cabina' : wanted;

        const entry: Shown = {
          id: item.id,
          plate: r.showPlate
            ? {
                plateStyle,
                accent: r.accentColor,
                tag: req.why,
                name: r.name || 'Sin nombre',
                user: r.showNoticeText && r.noticeTemplate.trim() ? buildRewardNotice(r.noticeTemplate, req.user, r.name, req.message) : req.user,
                amount: req.amount ?? (r.trigger === 'bits' ? String(r.bitsMin) : r.cost.toLocaleString('es')),
                unit: req.unit ?? (r.trigger === 'bits' ? (r.bitsMin === 1 ? 'bit' : 'bits') : 'puntos'),
                barSeconds: clipSeconds > 0 ? Math.min(stay, clipSeconds) : stay,
              }
            : null,
          video: hasVideo ? { url: videoUrl, box, blend: r.blendMode === 'screen', volume: clamp01(r.volume), untilEnd } : null,
        };

        // La placa entra en el documento y el sonido empieza en la misma vuelta
        const shownAt = performance.now();
        flushSync(() => setShown((prev) => [...prev, entry]));
        play();
        const gap = Math.round(performance.now() - shownAt);
        item.startedAt = shownAt;

        if (r.screenShake && rootRef.current && !reduced()) {
          shakeRef.current?.kill();
          shakeRef.current = gsap.fromTo(
            rootRef.current,
            { x: -14, y: 10, rotate: -0.8 },
            { x: 0, y: 0, rotate: 0, duration: 0.65, ease: 'elastic.out(1.2, 0.2)', clearProps: 'transform' }
          );
        }

        const where = box ? ` Vídeo en ${ZONE_NAMES[box.zone]}${box.repeated ? ' (con este tamaño y margen solo cabe en una zona)' : ''}.` : '';
        say(
          `${req.user} activó «${r.name}» (${req.why.toLowerCase()}). ${
            req.silent ? 'Muestra sin sonido' : clipSeconds > 0 ? `Sonido de ${f1(clipSeconds)} s, a ${gap} ms de la placa` : 'Sin sonido'
          }; ${r.showPlate ? `placa ${f1(stay)} s` : hasVideo ? `vídeo ${f1(stay)} s` : 'nada en pantalla'}.${where}`
        );
        // Sin nada en pantalla se deja un respiro para que el sonido no se pise con el siguiente
        later(item, () => finish(item), stay * 1000 + (entry.plate || entry.video ? 0 : 150));
        counts();
      };

      const start = (item: Item) => {
        activeRef.current.add(item);
        const { req } = item;
        const r = req.reward;
        const volume = clamp01(r.customAudioVolume ?? r.volume);

        const synth = () => {
          const seconds = req.silent ? 0 : SYNTH_SECONDS[r.soundType] ?? 0;
          // Fuera de la vuelta actual: `show` no puede ejecutarse dentro de un efecto de React
          Promise.resolve().then(() =>
            show(item, seconds, () => {
              if (!req.silent) playAlertAudio(r.soundType, volume);
            })
          );
        };

        const url = req.silent ? null : resolveMediaUrl(r.customAudioUrl);
        if (!url || volume <= 0) {
          synth();
          return;
        }

        const audio = new Audio();
        audio.preload = 'auto';
        audio.volume = volume;
        item.audio = audio;
        let settled = false;
        const ready = () => {
          if (settled) return;
          settled = true;
          clearTimeout(wait);
          const seconds = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
          show(item, seconds, () => {
            audio.play().catch((err: unknown) => {
              const blocked = err instanceof Error && err.name === 'NotAllowedError';
              say(
                blocked
                  ? `El navegador no dejó sonar «${r.name}» sin una pulsación en la página. En OBS arranca solo.`
                  : `No se pudo reproducir el sonido de «${r.name}».`
              );
            });
          });
        };
        const failed = () => {
          if (settled) return;
          settled = true;
          clearTimeout(wait);
          item.audio = undefined;
          say(`No se pudo cargar el sonido de «${r.name}». Suena el sonido de serie.`);
          synth();
        };
        audio.addEventListener('canplaythrough', ready, { once: true });
        audio.addEventListener('error', failed, { once: true });
        const wait = setTimeout(ready, PRELOAD_MS);
        item.timers.push(wait);
        audio.src = url;
        audio.load();
      };

      const pump = () => {
        if (!aliveRef.current) return;
        const first = queueRef.current[0];
        if (!first) {
          counts();
          return;
        }
        const n = startable(queueRef.current.length, activeRef.current.size, current());
        const starting = queueRef.current.slice(0, n);
        queueRef.current = queueRef.current.slice(n);
        starting.forEach(start);
        counts();
      };

      const fire = (request: RewardRequest, gates: boolean): boolean => {
        if (!aliveRef.current) return false;
        const s = current();
        const r = request.reward;
        const username = (request.username || request.user || '').toLowerCase();
        const now = Date.now();
        if (gates) {
          const verdict = checkGate(gateRef.current, r, s, username, now);
          if (!verdict.ok) {
            say(verdict.message);
            return false;
          }
        }
        if (admit(queueRef.current.length, activeRef.current.size, s) === 'full') {
          say(`La cola está llena (${s.queueMax} en espera): «${r.name}» se descarta.`);
          return false;
        }
        if (gates) gateRef.current = commitGate(gateRef.current, r, username, now);
        queueRef.current = [...queueRef.current, { id: nextId(), req: request, settings: s, timers: [], startedAt: performance.now(), minSeconds: 0 }];
        pump();
        return true;
      };

      const clear = (silent = false) => {
        queueRef.current = [];
        activeRef.current.forEach((item) => {
          item.dead = true;
          stopTimers(item);
          item.audio?.pause();
          elsRef.current.get(item.id)?.forEach((el) => gsap.killTweensOf(el));
        });
        activeRef.current.clear();
        if (!aliveRef.current) return;
        setShown([]);
        counts();
        if (!silent) say('Cola vaciada.');
      };

      engine.current = {
        fire,
        clear,
        videoEnded: (id) => {
          const item = find(id);
          if (item) endSoon(item);
        },
        videoFailed: (id) => {
          const item = find(id);
          if (!item) return;
          say(`No se pudo cargar el vídeo de «${item.req.reward.name}».`);
          endSoon(item);
        },
      };
    }

    /** Entrada común a todos los orígenes: elige la recompensa, mira el permiso y la lanza con sus esperas. */
    const trigger = useCallback((input: RewardTriggerInput): RewardTriggerResult => {
      const s = settingsRef.current ?? getSettingsRef.current?.() ?? loadRewardsSettings();
      const test = input.source === 'test';
      if (!s.enabled && !test) return { ok: false, reason: 'disabled' };
      const reward = resolveReward(s, input);
      if (!reward) return { ok: false, reason: 'no_match' };
      if (!test && !canActivate(reward.audience, input.role ?? 'viewer')) {
        const line = `${input.user} no puede activar «${reward.name}»: es solo para ${AUDIENCE_TEXT[reward.audience]}.`;
        onLogRef.current?.(line);
        if (!studioRef.current) console.info('[Lalo recompensas]', line);
        return { ok: false, reason: 'not_allowed', rewardId: reward.id };
      }
      const bits = typeof input.bits === 'number' ? input.bits : null;
      const accepted =
        engine.current?.fire(
          {
            reward,
            user: input.user,
            username: input.username || input.user,
            why: sourceLabel(input),
            message: input.text,
            amount: bits !== null ? String(bits) : undefined,
            unit: bits !== null ? (bits === 1 ? 'bit' : 'bits') : undefined,
          },
          !test
        ) ?? false;
      return accepted ? { ok: true, rewardId: reward.id } : { ok: false, reason: 'discarded', rewardId: reward.id };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        fire: (request, gates = false) => engine.current?.fire(request, gates) ?? false,
        trigger,
        chat: (tags, message, role) => {
          const found = readChatTrigger(tags);
          if (!found) return false;
          return trigger(
            found.kind === 'bits'
              ? { source: 'bits', bits: found.bits, user: found.user, username: found.username, role }
              : { source: 'points', twitchRewardId: found.rewardId, user: found.user, username: found.username, role, text: message }
          ).ok;
        },
        clear: () => engine.current?.clear(),
      }),
      [trigger]
    );

    // La capa del widget es la que atiende a triggerReward() (rewardsEngine.ts)
    useEffect(() => (bus ? registerRewardsEngine(trigger) : undefined), [bus, trigger]);

    // Pruebas enviadas desde el panel a las fuentes abiertas en este mismo navegador
    useEffect(() => {
      if (!bus) return;
      return listenBus((message) => {
        if (message.type !== 'REWARD_TEST') return;
        if (message.test.clear) {
          engine.current?.clear(true);
          return;
        }
        if (!message.test.reward) return;
        engine.current?.fire(
          {
            reward: normalizeReward(message.test.reward),
            user: message.test.user,
            why: message.test.why,
            amount: message.test.amount,
            unit: message.test.unit,
          },
          false
        );
      });
    }, [bus]);

    // Muestra fija: se repite mientras la capa esté vacía
    const demoOn = demoPlate !== null || demoVideo !== null;
    const empty = shown.length === 0;
    const demoShownRef = useRef(false);
    useEffect(() => {
      if (!demoOn || !empty) return;
      const timer = setTimeout(() => {
        demoShownRef.current = true;
        engine.current?.fire(sampleRequest(demoPlate, demoVideo), false);
      }, demoShownRef.current ? 1200 : 0);
      return () => clearTimeout(timer);
    }, [demoOn, empty, demoPlate, demoVideo]);

    // Al desmontar se detiene todo: sonidos, temporizadores y animaciones
    useEffect(() => {
      aliveRef.current = true;
      return () => {
        aliveRef.current = false;
        engine.current?.clear(true);
        shakeRef.current?.kill();
        elsRef.current.clear();
      };
    }, []);

    const register = (id: string, el: HTMLElement | null, previous: HTMLElement | null) => {
      const set = elsRef.current.get(id) ?? new Set<HTMLElement>();
      if (previous) set.delete(previous);
      if (el) set.add(el);
      if (set.size) elsRef.current.set(id, set);
      else elsRef.current.delete(id);
    };

    const custom = (settingsRef.current ?? getSettingsRef.current?.() ?? loadRewardsSettings()).customPlate;

    return (
      <div ref={rootRef} className="rwl" data-studio={isStudio ? '' : undefined} aria-hidden="true">
        {shown.map((entry) =>
          entry.video ? (
            <VideoIn
              key={entry.id}
              id={entry.id}
              video={entry.video}
              register={register}
              onEnded={() => engine.current?.videoEnded(entry.id)}
              onError={() => engine.current?.videoFailed(entry.id)}
            />
          ) : null
        )}
        <div className="rw-stack">
          {shown.map((entry) =>
            entry.plate ? <PlateIn key={entry.id} id={entry.id} plate={entry.plate} custom={custom} register={register} /> : null
          )}
        </div>
      </div>
    );
  }
);

RewardsLayer.displayName = 'RewardsLayer';
