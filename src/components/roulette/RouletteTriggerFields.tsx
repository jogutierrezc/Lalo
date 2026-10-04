/**
 * src/components/roulette/RouletteTriggerFields.tsx
 *
 * «Cómo se gira» del estudio de la ruleta: abrirla y cerrarla (panel o comando
 * con su nombre) y qué la hace girar (puntos del canal o bits), quién puede y
 * cada cuánto. Mismos campos y mismas reglas que las recompensas.
 */

import React, { useEffect, useId, useState } from 'react';
import {
  DEFAULT_CLOSE_COMMAND,
  DEFAULT_OPEN_COMMAND,
  ROULETTE_LIMITS,
  RouletteSettings,
  normalizeRouletteCommand,
  normalizeRouletteName,
} from '../../types/roulette';
import { DEFAULT_BITS_COOLDOWN_SECONDS, RewardAudience } from '../../types/rewards';
import { loadPowerupsSettings } from '../../types/powerups';
import { ROULETTE_QUEUE_MAX } from '../../utils/rouletteLogic';
import { Field, Toggle } from '../studio/StudioKit';
import { useRewardDetect } from '../voz/useRewardDetect';

interface RouletteTriggerFieldsProps {
  settings: RouletteSettings;
  update: (partial: Partial<RouletteSettings>) => void;
  onNote: (message: string) => void;
}

const AUDIENCES: { id: RewardAudience; name: string }[] = [
  { id: 'all', name: 'Todos' },
  { id: 'sub', name: 'Suscriptores' },
  { id: 'vip', name: 'VIP y mods' },
];

const whole = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

/** Campo de texto que se guarda al salir de él, ya corregido: mientras se escribe no se toca. */
const DraftInput: React.FC<{
  id: string;
  value: string;
  mono?: boolean;
  maxLength: number;
  onCommit: (text: string) => void;
}> = ({ id, value, mono, maxLength, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      className={`cab-inp ${mono ? 'cab-mono' : ''}`}
      value={draft}
      maxLength={maxLength}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onCommit(draft);
        setDraft(value);
      }}
    />
  );
};

export const RouletteTriggerFields: React.FC<RouletteTriggerFieldsProps> = ({ settings, update, onNote }) => {
  const uid = useId();
  const detect = useRewardDetect((rewardId) => {
    update({ twitchRewardId: rewardId });
    onNote('Recompensa de Twitch detectada y enlazada a la ruleta.');
  });

  const bits = settings.triggerKind === 'bits';
  const powerups = loadPowerupsSettings();
  const eventsOn = powerups.channelActive && powerups.pointsViaChannel;

  return (
    <>
      {settings.spinNotice && (
        <p className="cab-note" role="status">
          La ruleta ya no se gira escribiendo un comando en el chat. Ahora la giran los puntos del canal o los bits, lo que
          elijas aquí. Tu comando <span className="cab-mono">{settings.openCommand}</span> se queda para abrirla, y solo lo
          pueden usar tú y tus moderadores. Hasta que enlaces una recompensa o elijas los bits, nada la gira.{' '}
          <button type="button" className="studio-link" onClick={() => update({ spinNotice: false })}>
            Entendido
          </button>
        </p>
      )}

      <Toggle
        label={settings.active ? 'Ruleta abierta' : 'Ruleta cerrada'}
        checked={settings.active}
        onChange={(next) => update({ active: next, activeAt: Date.now() })}
      />
      <p className="cab-hint">
        Abierta se ve en OBS y la giran los canjes o los cheers. Cerrada no se ve y nada la gira. Con cuenta en la nube, este
        interruptor tarda hasta medio minuto en llegar a OBS; el comando del chat es inmediato. Lo que se abra o cierre desde
        el chat no mueve este interruptor.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre de la ruleta" htmlFor={`${uid}-name`}>
          <DraftInput
            id={`${uid}-name`}
            value={settings.name}
            maxLength={ROULETTE_LIMITS.nameMax}
            onCommit={(text) => update({ name: normalizeRouletteName(text) })}
          />
        </Field>
        <Field label="Comando para abrirla" htmlFor={`${uid}-open`}>
          <DraftInput
            id={`${uid}-open`}
            mono
            value={settings.openCommand}
            maxLength={25}
            onCommit={(text) => {
              const openCommand = normalizeRouletteCommand(text, DEFAULT_OPEN_COMMAND);
              if (openCommand === settings.closeCommand) onNote('Ese comando ya es el que la cierra. Elige otro.');
              else update({ openCommand });
            }}
          />
        </Field>
        <Field label="Comando para cerrarla" htmlFor={`${uid}-close`}>
          <DraftInput
            id={`${uid}-close`}
            mono
            value={settings.closeCommand}
            maxLength={25}
            onCommit={(text) => {
              const closeCommand = normalizeRouletteCommand(text, DEFAULT_CLOSE_COMMAND);
              if (closeCommand === settings.openCommand) onNote('Ese comando ya es el que la abre. Elige otro.');
              else update({ closeCommand });
            }}
          />
        </Field>
      </div>
      <p className="cab-hint">
        Solo tú y tus moderadores: <span className="cab-mono">{settings.openCommand} {settings.name}</span> la abre y{' '}
        <span className="cab-mono">{settings.closeCommand}</span> la cierra. Vale el comienzo del nombre, y dan igual las
        mayúsculas y los acentos. Los espectadores no la giran con comandos.
      </p>

      <div className="grid gap-4">
        <Field label="Se gira con">
          <div className="cab-seg" role="group" aria-label="Se gira con">
            <button type="button" aria-pressed={!bits} onClick={() => update({ triggerKind: 'points' })}>
              Puntos de canal
            </button>
            <button
              type="button"
              aria-pressed={bits}
              onClick={() =>
                update({
                  triggerKind: 'bits',
                  // Por bits nace con espera: frena la ráfaga de cheers pequeños
                  cooldownSeconds: settings.cooldownSeconds || DEFAULT_BITS_COOLDOWN_SECONDS,
                })
              }
            >
              Bits
            </button>
          </div>
        </Field>
        <Field label="Quién puede girarla">
          <div className="cab-seg" role="group" aria-label="Quién puede girarla">
            {AUDIENCES.map((item) => (
              <button key={item.id} type="button" aria-pressed={settings.audience === item.id} onClick={() => update({ audience: item.id })}>
                {item.name}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {!bits && (
        <>
          <Field
            label="Recompensa de Twitch"
            hint={
              settings.twitchRewardId
                ? `Enlazada: ${settings.twitchRewardId.slice(0, 8)}…`
                : 'Aún sin enlazar: en directo ningún canje la girará.'
            }
          >
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="cab-btn2 cab-btn-sm"
                disabled={!settings.channel}
                onClick={() => (detect.detecting ? detect.cancel() : detect.start(settings.channel))}
              >
                {detect.detecting ? 'Cancelar' : settings.twitchRewardId ? 'Detectar otra vez' : 'Detectar'}
              </button>
              {settings.twitchRewardId && (
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => update({ twitchRewardId: '' })}>
                  Desenlazar
                </button>
              )}
            </div>
          </Field>
          {detect.detecting && (
            <p className="cab-note" role="status">
              Escuchando el chat de #{settings.channel}. Canjea ahora la recompensa en tu canal y escribe cualquier texto.
            </p>
          )}
          {detect.message && (
            <p className="cab-error" role="alert">
              {detect.message}
            </p>
          )}
          <p className="cab-note">
            Crea en Twitch la recompensa de puntos y pulsa «Detectar»: canjéala una vez escribiendo un texto y queda
            enlazada. Para detectarla, la recompensa tiene que tener activado «Requerir que el espectador escriba un texto»;
            así el canje pasa por el chat.{' '}
            {eventsOn
              ? 'Tienes encendido el canal de eventos de Twitch: después puedes quitarle el texto y seguirá girando.'
              : 'Sin el canal de eventos de Twitch (se enciende en «Power-ups»), un canje sin texto no llega y no gira.'}{' '}
            Twitch no devuelve los puntos de un canje descartado por la espera o con la ruleta cerrada: pon la misma espera
            en Twitch y pausa la recompensa cuando cierres. Si no dejas girar a todos, usa una recompensa con texto: el canal
            de eventos no dice si quien canjea es suscriptor o VIP.
          </p>
        </>
      )}

      {bits && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Cantidad">
              <div className="cab-seg" role="group" aria-label="Cantidad de bits">
                <button type="button" aria-pressed={settings.bitsMode === 'exact'} onClick={() => update({ bitsMode: 'exact' })}>
                  Exacta
                </button>
                <button type="button" aria-pressed={settings.bitsMode === 'range'} onClick={() => update({ bitsMode: 'range' })}>
                  Rango
                </button>
              </div>
            </Field>
            <Field label={settings.bitsMode === 'exact' ? 'Bits' : 'Mínimo'} htmlFor={`${uid}-min`} hint="Número entero, desde 1.">
              <input
                id={`${uid}-min`}
                type="number"
                min={ROULETTE_LIMITS.bits.min}
                max={ROULETTE_LIMITS.bits.max}
                step={1}
                className="cab-inp cab-mono"
                value={settings.bitsMin}
                onChange={(e) => {
                  const bitsMin = whole(e.target.value, ROULETTE_LIMITS.bits.min, ROULETTE_LIMITS.bits.max);
                  update({ bitsMin, bitsMax: settings.bitsMax === null ? null : Math.max(bitsMin, settings.bitsMax) });
                }}
              />
            </Field>
            {settings.bitsMode === 'range' && (
              <Field label="Máximo (opcional)" htmlFor={`${uid}-max`} hint="Vacío: sin tope.">
                <input
                  id={`${uid}-max`}
                  type="number"
                  min={settings.bitsMin}
                  max={ROULETTE_LIMITS.bits.max}
                  step={1}
                  placeholder="sin tope"
                  className="cab-inp cab-mono"
                  value={settings.bitsMax ?? ''}
                  onChange={(e) =>
                    update({
                      bitsMax: e.target.value === '' ? null : whole(e.target.value, ROULETTE_LIMITS.bits.min, ROULETTE_LIMITS.bits.max),
                    })
                  }
                  onBlur={() => settings.bitsMax !== null && settings.bitsMax < settings.bitsMin && update({ bitsMax: settings.bitsMin })}
                />
              </Field>
            )}
          </div>
          <p className="cab-hint">
            Los cheers llegan por el chat, sin iniciar sesión en Twitch. Los anónimos cuentan y salen como «Anónimo». Si el
            mismo cheer activa también una recompensa, suenan las dos cosas.
          </p>
        </>
      )}

      <Field
        label="Espera entre giros"
        htmlFor={`${uid}-cooldown`}
        hint={`En segundos. Un giro antes de tiempo se descarta y queda anotado. Con 0 no hay espera. Si llegan varios seguidos giran de uno en uno, con ${ROULETTE_QUEUE_MAX} esperando como mucho.`}
      >
        <input
          id={`${uid}-cooldown`}
          type="number"
          min={ROULETTE_LIMITS.cooldown.min}
          max={ROULETTE_LIMITS.cooldown.max}
          className="cab-inp cab-mono sm:max-w-[160px]"
          value={settings.cooldownSeconds}
          onChange={(e) => update({ cooldownSeconds: whole(e.target.value, ROULETTE_LIMITS.cooldown.min, ROULETTE_LIMITS.cooldown.max) })}
        />
      </Field>
    </>
  );
};
