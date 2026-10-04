/**
 * src/components/integraciones/KofiStage.tsx
 *
 * Todo lo de Ko-fi que se ve en una pantalla: las alertas, la meta y los
 * últimos apoyos, cada pieza encendida o no según la fuente. La usan el widget
 * de OBS y el monitor del panel, con las mismas reglas:
 *
 *   - Un aviso con un nivel distinto del elegido o por debajo del mínimo no
 *     cuenta para nada.
 *   - Si cuenta, entra en «últimos apoyos» y, si su tipo suma y la moneda es la
 *     de la meta, sube la meta. La alerta sale solo si su tipo está encendido.
 *   - Privado: «Alguien», sin mensaje y sin voz. Un mensaje con una palabra
 *     bloqueada ni se ve ni se lee.
 *   - Lo recaudado lo lleva el servidor: un aviso real trae el total nuevo y la
 *     capa lo pone tal cual. Las pruebas suman solo en esta pantalla.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  decideKofi,
  parseStoredKofiEvent,
  pushKofiRecent,
  type KofiDecision,
  type KofiRecent,
  type ReceivedKofiEvent,
} from '../../../server/integrations/kofiRules';
import { resolveMediaUrl } from '../../lib/mediaRef';
import type { AlertSoundType } from '../../types/alerts';
import { kofiRuleSet, type KofiSettings } from '../../types/kofi';
import { playAlertAudio, playCustomAudio } from '../../utils/alertsAudio';
import { findBlockedWord } from '../../utils/moderation';
import { KofiAlerts, type KofiAlertsHandle } from './KofiAlerts';
import { KofiGoal, KofiRecentList } from './KofiFixed';

export interface KofiParts {
  alerts: boolean;
  goal: boolean;
  recent: boolean;
}

export interface KofiHandled {
  event: ReceivedKofiEvent;
  decision: KofiDecision;
  /** La alerta entró en la cola (false si no tocaba o la cola está llena). */
  queued: boolean;
}

export interface KofiStageHandle {
  /** Un aviso del canal de eventos o una prueba. null si no tiene la forma esperada. Con `silent` no suena ni habla. */
  event: (payload: unknown, test: boolean, silent?: boolean) => KofiHandled | null;
  /** Repite en pantalla el último aviso, para ver un cambio de diseño. */
  preview: () => void;
  clearAlert: () => void;
  /** Pone lo recaudado y la lista que diga el servidor (o cero al reiniciar). */
  setState: (state: { raised: number; recent?: KofiRecent[] }) => void;
}

interface KofiStageProps {
  settings: KofiSettings;
  parts: KofiParts;
  blockedWords: string[];
  /** Pone una frase en la cola de voz. Sin ella (panel), la voz no habla. */
  speak?: (text: string) => void;
  /** Sin sonido (monitor del panel con el sonido apagado o modo demo). */
  muted?: boolean;
  initial?: { raised: number; recent: KofiRecent[] };
}

const VOLUME = 0.8;

export const KofiStage = forwardRef<KofiStageHandle, KofiStageProps>(({ settings, parts, blockedWords, speak, muted = false, initial }, ref) => {
  const alertsRef = useRef<KofiAlertsHandle | null>(null);
  const [raised, setRaised] = useState(initial?.raised ?? 0);
  const [recent, setRecent] = useState<KofiRecent[]>(initial?.recent ?? []);
  const [plus, setPlus] = useState<{ id: number; amount: number } | null>(null);
  const [bump, setBump] = useState(0);
  const counter = useRef(0);
  const last = useRef<{ event: ReceivedKofiEvent; decision: KofiDecision } | null>(null);
  const live = useRef({ settings, parts, blockedWords, speak, muted });
  live.current = { settings, parts, blockedWords, speak, muted };

  const toItem = useCallback((event: ReceivedKofiEvent, decision: KofiDecision, withEffects: boolean) => {
    const rule = live.current.settings.events[event.kind];
    return {
      kind: event.kind,
      big: decision.big,
      title: decision.title,
      amount: event.amount,
      currency: event.currency,
      tier: event.tier,
      message: decision.message,
      hold: decision.hold,
      onShow: withEffects
        ? () => {
            const now = live.current;
            if (!now.muted) {
              const custom = rule.snd === 'custom' ? resolveMediaUrl(rule.sndUrl) : null;
              if (custom) playCustomAudio(custom, VOLUME);
              else if (rule.snd !== 'none' && rule.snd !== 'custom') playAlertAudio(rule.snd as AlertSoundType, VOLUME);
            }
            // La voz solo lee mensajes públicos que pasaron el filtro (decision.voice ya lo exige)
            if (decision.voice) now.speak?.(decision.message);
          }
        : undefined,
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      event: (payload, test, silent = false) => {
        const event = parseStoredKofiEvent(payload, test);
        if (!event) return null;
        const now = live.current;
        const blocked = event.blockedSample || (Boolean(event.message) && findBlockedWord(event.message, now.blockedWords) !== null);
        const decision = decideKofi(event, kofiRuleSet(now.settings), now.settings.hold, blocked);
        last.current = { event, decision };
        if (decision.skip) return { event, decision, queued: false };

        setRecent((list) => pushKofiRecent(list, { name: event.name, amount: event.amount, currency: event.currency, kind: event.kind }));
        setBump((value) => value + 1);
        if (event.raised !== null) setRaised(event.raised);
        else if (decision.goalAdd > 0) setRaised((value) => Math.round((value + decision.goalAdd) * 100) / 100);
        if (decision.goalAdd > 0) {
          counter.current += 1;
          setPlus({ id: counter.current, amount: decision.goalAdd });
        }
        const queued = decision.alert && now.parts.alerts ? (alertsRef.current?.push(toItem(event, decision, !silent)) ?? false) : false;
        return { event, decision, queued };
      },
      preview: () => {
        if (last.current) alertsRef.current?.preview(toItem(last.current.event, last.current.decision, false));
      },
      clearAlert: () => alertsRef.current?.clear(),
      setState: (state) => {
        setRaised(state.raised);
        if (state.recent) setRecent(state.recent);
      },
    }),
    [toItem]
  );

  // Si la fuente deja de mostrar alertas, no queda ninguna a medias
  useEffect(() => {
    if (!parts.alerts) alertsRef.current?.clear();
  }, [parts.alerts]);

  return (
    <>
      {parts.alerts && <KofiAlerts ref={alertsRef} settings={settings} />}
      {(parts.goal || parts.recent) && (
        <div className="itg-ov">
          {parts.goal && (
            <KofiGoal
              layout={settings.goal.layout}
              title={settings.goal.title}
              target={settings.goal.target}
              currency={settings.goal.currency}
              total={raised}
              color={settings.color}
              plus={plus}
            />
          )}
          {parts.recent && <KofiRecentList layout={settings.recent.layout} items={recent} color={settings.color} bump={bump} />}
        </div>
      )}
    </>
  );
});

KofiStage.displayName = 'KofiStage';
