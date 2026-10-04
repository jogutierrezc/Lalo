/**
 * src/components/roulette/RouletteLayer.tsx
 *
 * La ruleta tal como va en una fuente de navegador de OBS: en la fuente propia
 * (app=roulette) y dentro de «Todo en uno».
 *
 * - La abre y la cierra el streamer desde el panel, o él y sus moderadores con
 *   un comando y el nombre de la ruleta. Cerrada no se ve y nada la gira.
 * - La giran los puntos del canal o los bits, según eligió el streamer. Un canje
 *   con texto y un cheer llegan por el chat; un canje sin texto, por el canal de
 *   eventos de Twitch. Ningún espectador la gira con un comando.
 * - Varios giros seguidos esperan turno: gira uno cada vez.
 * - La voz no sale de aquí: cada frase entra en la cola de voz del sistema
 *   (`speak`), con la voz elegida en «Voz del chat», y como mucho una vez por
 *   giro y por momento.
 * - Con varias fuentes de la ruleta abiertas en el mismo navegador (la fuente
 *   propia y «Todo en uno», por ejemplo), solo una lleva el mando: atiende los
 *   canjes, hace sonar la rueda y habla. Las demás solo dibujan el mismo giro.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import gsap from 'gsap';
import {
  RouletteSegment,
  RouletteSettings,
  decodeRouletteSettings,
  loadRouletteSettings,
  normalizeRouletteSettings,
} from '../../types/roulette';
import { loadPowerupsSettings } from '../../types/powerups';
import { reduced } from '../../utils/alertMotion';
import { playAlertOrCustomSound } from '../../utils/alertsAudio';
import { RouletteSpinEvent, listenBus, postBus } from '../../utils/bus';
import type { ChatTags, UserRole } from '../../utils/moderation';
import { GateState, emptyGate } from '../../utils/rewardsLogic';
import {
  ActivityOverride,
  IncomingTrigger,
  ROULETTE_LOCK,
  ROULETTE_QUEUE_MAX,
  SeenTrigger,
  admitSpin,
  buildSpin,
  canUseRouletteCommands,
  commitSpinGate,
  createAnnouncer,
  isDuplicateTrigger,
  judgeTrigger,
  matchRouletteName,
  matchesTrigger,
  parseActivityCommand,
  rememberTrigger,
  resolveActive,
  spinAnnouncement,
  takeNextSpin,
  triggerFromChat,
  triggerFromEvent,
  winnerAnnouncement,
} from '../../utils/rouletteLogic';
import type { TwitchEvent } from '../../utils/twitchEvents';
import { RouletteOverlayView } from './RouletteOverlayView';

export interface RouletteLayerHandle {
  /** Mensaje del chat con sus etiquetas: un cheer o un canje con texto pueden girarla. */
  chat: (tags: ChatTags & { 'display-name'?: string }, role: UserRole) => void;
  /** Mensaje del streamer o de un moderador. Devuelve true si era un comando de la ruleta. */
  command: (message: string, sender: { name: string; role: UserRole }) => boolean;
  /** Evento del canal de eventos de Twitch: los canjes sin texto llegan por aquí. */
  event: (event: TwitchEvent) => void;
}

interface RouletteLayerProps {
  /** Pone una frase en la cola de voz del sistema. Es el único camino por el que habla la ruleta. */
  speak: (text: string) => unknown;
  /** demo=1: la rueda se ve aunque esté cerrada, para colocar la fuente en OBS. */
  demo?: boolean;
  onLog?: (message: string) => void;
}

interface Waiting {
  id: string;
  user: string;
  why?: string;
  /** Giro ya calculado por otra página de este navegador (una prueba del panel). */
  spin?: RouletteSpinEvent;
}

interface View {
  spin: RouletteSpinEvent | null;
  spinning: boolean;
  banner: { segment: RouletteSegment; user: string } | null;
  start: number;
  target: number;
}

const ACTIVITY_KEY = 'lalo_roulette_activity';
const IDLE_VIEW: View = { spin: null, spinning: false, banner: null, start: 0, target: 0 };

function urlParam(key: string): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get(key);
  if (fromSearch) return fromSearch.trim();
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return at === -1 ? null : (new URLSearchParams(hash.slice(at)).get(key) || '').trim() || null;
}

/** Ajustes de la ruleta para esta fuente: los de la URL (`rl`, sin cuenta en la nube) o los guardados. */
export function rouletteSettingsForWidget(): RouletteSettings {
  return decodeRouletteSettings(urlParam('rl')) || loadRouletteSettings();
}

function loadOverride(): ActivityOverride | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { active, at } = parsed as Record<string, unknown>;
    return typeof active === 'boolean' && typeof at === 'number' && Number.isFinite(at) ? { active, at } : null;
  } catch {
    return null;
  }
}

function saveOverride(override: ActivityOverride): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(override));
  } catch {
    // Sin almacenamiento en la fuente: el cambio vale hasta que se recargue
  }
}

let serial = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${(serial += 1)}`;

export const RouletteLayer = forwardRef<RouletteLayerHandle, RouletteLayerProps>(({ speak, demo = false, onLog }, ref) => {
  const [settings, setSettings] = useState<RouletteSettings>(rouletteSettingsForWidget);
  const [override, setOverride] = useState<ActivityOverride | null>(loadOverride);
  const [leader, setLeader] = useState(false);
  const [view, setView] = useState<View>(IDLE_VIEW);

  const active = resolveActive(settings, override);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activeRef = useRef(active);
  activeRef.current = active;
  const leaderRef = useRef(false);
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const demoRef = useRef(demo);
  demoRef.current = demo;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<Waiting[]>([]);
  /** Giro en pantalla, hasta que se retira su resultado. */
  const currentRef = useRef<RouletteSpinEvent | null>(null);
  /** Id del giro cuyo final ya se atendió: el aviso de fin puede llegar dos veces. */
  const finishedRef = useRef<string | null>(null);
  const shownIdsRef = useRef<string[]>([]);
  const gateRef = useRef<GateState>(emptyGate());
  const seenRef = useRef<SeenTrigger[]>([]);
  const restRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const aliveRef = useRef(true);

  const engine = useRef<{
    process: (incoming: IncomingTrigger) => void;
    command: (message: string, sender: { name: string; role: UserRole }) => boolean;
    incoming: (spin: RouletteSpinEvent) => void;
    complete: (spinId: string) => void;
    clear: () => void;
    pump: () => void;
  } | null>(null);

  if (!engine.current) {
    const say = (message: string) => {
      onLogRef.current?.(message);
      console.info('[Lalo ruleta]', message);
    };
    const later = (fn: () => void, ms: number) => {
      timersRef.current.push(setTimeout(fn, ms));
    };
    const stopTimers = () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    const markShown = (id: string) => {
      shownIdsRef.current = [...shownIdsRef.current.slice(-39), id];
    };
    // Único camino de voz: la cola del sistema. Solo habla la fuente que lleva el mando
    const announcer = createAnnouncer(
      (text) => speakRef.current(text),
      () => leaderRef.current
    );

    const play = (spin: RouletteSpinEvent) => {
      const s = settingsRef.current;
      stopTimers();
      if (boxRef.current) gsap.killTweensOf(boxRef.current);
      markShown(spin.id);
      currentRef.current = spin;
      finishedRef.current = null;
      setView({ spin, spinning: true, banner: null, start: spin.startRotation ?? 0, target: spin.finalRotation });

      if (spin.ttsAnnounceSpin !== false && s.ttsAnnounceSpin !== false) {
        announcer.say(spin.id, 'spin', spinAnnouncement(spin.user, s.title));
      }
      say(`Gira ${spin.user || 'Streamer'}${spin.why ? ` (${spin.why.toLowerCase()})` : ''}.`);
      // Si OBS tiene la fuente oculta la animación no avanza: el giro se da por terminado igual
      later(() => complete(spin.id), (s.spinDurationSec || 6) * 1000 + 1500);
    };

    const complete = (spinId: string) => {
      const spin = currentRef.current;
      if (!spin || spin.id !== spinId || finishedRef.current === spinId || !aliveRef.current) return;
      finishedRef.current = spinId;
      stopTimers();
      const s = settingsRef.current;
      const winner = spin.winnerSegment;
      const user = spin.user || 'Streamer';
      const rest = ((spin.finalRotation % 360) + 360) % 360;
      restRef.current = rest;
      const withBanner = spin.showWinnerBanner !== false;
      setView({ spin, spinning: false, banner: withBanner ? { segment: winner, user } : null, start: rest, target: spin.finalRotation });

      if (leaderRef.current) {
        playAlertOrCustomSound(spin.victoryCustomAudioUrl, spin.victorySoundType || 'arcade-chime', spin.victoryCustomAudioVolume ?? 0.85);
      }
      if (spin.ttsAnnounceWinner !== false && s.ttsAnnounceWinner !== false) {
        announcer.say(spin.id, 'winner', winnerAnnouncement(winner, spin.user));
      }
      if (spin.screenShake && boxRef.current && !reduced()) {
        gsap.fromTo(
          boxRef.current,
          { x: -16, y: 12, rotate: -1.2 },
          { x: 0, y: 0, rotate: 0, duration: 0.8, ease: 'elastic.out(1.2, 0.18)', clearProps: 'transform' }
        );
      }
      say(`Salió «${winner.text}» para ${user}.`);
      later(() => dismiss(spinId), (withBanner ? spin.winnerBannerDurationSec || 8 : 2) * 1000);
    };

    const dismiss = (spinId: string) => {
      if (currentRef.current?.id !== spinId || !aliveRef.current) return;
      stopTimers();
      const stays = activeRef.current || demoRef.current;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        currentRef.current = null;
        if (boxRef.current) {
          gsap.killTweensOf(boxRef.current);
          gsap.set(boxRef.current, { clearProps: 'all' });
        }
        if (!aliveRef.current) return;
        setView({ ...IDLE_VIEW, start: restRef.current, target: restRef.current });
        // Un respiro para que la rueda vuelva al centro antes del siguiente giro
        later(pump, stays ? 800 : 150);
      };
      if (!stays && boxRef.current && !reduced()) {
        // Cerrada, la ruleta se retira al acabar. El temporizador cubre a OBS con la fuente oculta
        later(finish, 500);
        gsap.to(boxRef.current, { opacity: 0, scale: 0.96, duration: 0.22, ease: 'power2.out', onComplete: finish });
      } else {
        finish();
      }
    };

    const pump = () => {
      if (!leaderRef.current || currentRef.current || !aliveRef.current) return;
      const { next, rest } = takeNextSpin(queueRef.current);
      if (!next) return;
      queueRef.current = rest;
      if (next.spin) {
        play(next.spin);
        return;
      }
      const spin = buildSpin(settingsRef.current, { id: next.id, user: next.user, why: next.why, baseRotation: restRef.current });
      if (!spin) {
        say(`El giro de ${next.user} se descarta: la ruleta no tiene segmentos activos.`);
        pump();
        return;
      }
      // Las demás fuentes de la ruleta abiertas en este navegador dibujan el mismo giro
      markShown(spin.id);
      postBus({ type: 'ROULETTE_SPIN', spin });
      play(spin);
    };

    const process = (incoming: IncomingTrigger) => {
      // Solo una fuente atiende los canjes: así un canje no gira una vez por fuente abierta
      if (!leaderRef.current) return;
      const s = settingsRef.current;
      if (!matchesTrigger(s, incoming)) return;
      const now = Date.now();
      if (isDuplicateTrigger(seenRef.current, incoming, now)) {
        say(`${incoming.user}: ese canje ya llegó por el otro camino (chat o canal de eventos). No gira dos veces.`);
        return;
      }
      const verdict = judgeTrigger(s, incoming, {
        active: activeRef.current,
        activeSegments: s.segments.filter((segment) => segment.enabled).length,
        gate: gateRef.current,
        now,
      });
      if (!verdict.ok) {
        if (verdict.message) say(verdict.message);
        return;
      }
      const admitted = admitSpin(queueRef.current.length, currentRef.current !== null);
      if (admitted === 'full') {
        say(`${incoming.user}: ya hay ${ROULETTE_QUEUE_MAX} giros esperando. Este se descarta.`);
        return;
      }
      seenRef.current = rememberTrigger(seenRef.current, incoming, now);
      if (incoming.via !== 'test') gateRef.current = commitSpinGate(gateRef.current, s, incoming.username, now);
      queueRef.current = [...queueRef.current, { id: nextId('spin'), user: incoming.user, why: verdict.why }];
      if (admitted === 'wait') say(`${incoming.user} espera turno (${queueRef.current.length} en cola).`);
      pump();
    };

    const command = (message: string, sender: { name: string; role: UserRole }) => {
      const s = settingsRef.current;
      if (!canUseRouletteCommands(sender.role)) return false;
      const parsed = parseActivityCommand(message, s);
      if (!parsed) return false;
      // Hoy hay una sola ruleta guardada: la lista tiene un elemento
      const found = matchRouletteName([{ name: s.name }], parsed.query);
      if (found.kind !== 'one') {
        say(
          `${sender.name} escribió «${message.trim()}»: ${
            found.kind === 'none' ? 'no hay ninguna ruleta con ese nombre' : 'ese nombre vale para más de una ruleta'
          }. No se hace nada. La ruleta se llama «${s.name}».`
        );
        return true;
      }
      const want = parsed.action === 'open';
      if (activeRef.current === want) {
        say(`${sender.name}: la ruleta «${s.name}» ya estaba ${want ? 'abierta' : 'cerrada'}.`);
        return true;
      }
      const next: ActivityOverride = { active: want, at: Math.max(Date.now(), s.activeAt + 1) };
      saveOverride(next);
      setOverride(next);
      if (!want && queueRef.current.length) {
        say(`Se descartan ${queueRef.current.length} giros que esperaban turno.`);
        queueRef.current = [];
      }
      say(`${sender.name} ${want ? 'abrió' : 'cerró'} la ruleta «${s.name}».`);
      return true;
    };

    /** Giro calculado por otra página de este navegador: el panel (prueba) o la fuente que lleva el mando. */
    const incoming = (spin: RouletteSpinEvent) => {
      if (shownIdsRef.current.includes(spin.id)) return;
      if (leaderRef.current && currentRef.current) {
        markShown(spin.id);
        if (admitSpin(queueRef.current.length, true) === 'full') {
          say(`Llegó un giro de ${spin.user || 'Streamer'} con ${ROULETTE_QUEUE_MAX} esperando. Se descarta.`);
          return;
        }
        queueRef.current = [...queueRef.current, { id: spin.id, user: spin.user || 'Streamer', why: spin.why, spin }];
        return;
      }
      play(spin);
    };

    const clear = () => {
      stopTimers();
      queueRef.current = [];
      currentRef.current = null;
      setView({ ...IDLE_VIEW, start: restRef.current, target: restRef.current });
    };

    engine.current = { process, command, incoming, complete, clear, pump };
  }

  useImperativeHandle(
    ref,
    () => ({
      chat: (tags, role) => {
        const incoming = triggerFromChat(tags, role);
        if (incoming) engine.current?.process(incoming);
      },
      command: (message, sender) => engine.current?.command(message, sender) ?? false,
      event: (event) => {
        const incoming = triggerFromEvent(event, { pointsViaChannel: loadPowerupsSettings().pointsViaChannel });
        if (incoming) engine.current?.process(incoming);
      },
    }),
    []
  );

  // Ajustes al día y giros que llegan de otras páginas de este navegador
  useEffect(
    () =>
      listenBus((message) => {
        if (message.type === 'ROULETTE_SETTINGS_UPDATE') setSettings(normalizeRouletteSettings(message.settings));
        if (message.type === 'ROULETTE_SPIN') engine.current?.incoming(message.spin);
        if (message.type === 'ROULETTE_CLEAR') engine.current?.clear();
      }),
    []
  );

  // Reparto del mando entre las fuentes abiertas en este navegador. La primera se lo queda
  // mientras viva; al cerrarse pasa a la siguiente. Sin soporte del navegador, esta fuente manda
  useEffect(() => {
    aliveRef.current = true;
    const take = () => {
      leaderRef.current = true;
      setLeader(true);
      engine.current?.pump();
    };
    let release: (() => void) | null = null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks || !controller) {
      take();
    } else {
      locks
        .request(
          ROULETTE_LOCK,
          { signal: controller.signal },
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
              if (aliveRef.current) take();
              else resolve();
            })
        )
        .catch(() => {
          // Petición cancelada al desmontar la fuente
        });
    }
    return () => {
      aliveRef.current = false;
      leaderRef.current = false;
      controller?.abort();
      release?.();
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  const visible = demo || active || view.spin !== null;
  if (!visible) return null;

  return (
    <div ref={boxRef} className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center p-6">
      <div className="pointer-events-auto w-full">
        <RouletteOverlayView
          // Solo suena la rueda de la fuente que lleva el mando
          settings={leader ? settings : { ...settings, soundEnabled: false }}
          targetRotation={view.target}
          startRotation={view.start}
          targetWinner={view.spin?.winnerSegment}
          isSpinning={view.spinning}
          activeUser={view.spin?.user || 'Streamer'}
          winnerBanner={view.banner}
          onSpinComplete={() => {
            const id = currentRef.current?.id;
            if (id) engine.current?.complete(id);
          }}
          isStudio={false}
        />
      </div>
    </div>
  );
});

RouletteLayer.displayName = 'RouletteLayer';
