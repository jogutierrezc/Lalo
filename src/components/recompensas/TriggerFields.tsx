/**
 * src/components/recompensas/TriggerFields.tsx
 *
 * Qué activa una recompensa (puntos del canal o bits), quién puede hacerlo y
 * cuánto hay que esperar entre un uso y el siguiente.
 */

import React, { useId, useState } from 'react';
import { CustomRewardItem, DEFAULT_BITS_COOLDOWN_SECONDS, REWARD_LIMITS, RewardAudience, RewardsSettings } from '../../types/rewards';
import { bitsCandidates, isLowBits } from '../../utils/rewardsLogic';
import { Field } from '../studio/StudioKit';
import { useRewardDetect } from '../voz/useRewardDetect';

interface TriggerFieldsProps {
  reward: CustomRewardItem;
  settings: RewardsSettings;
  patch: (value: Partial<CustomRewardItem>) => void;
  onNote: (message: string) => void;
}

const AUDIENCES: { id: RewardAudience; name: string }[] = [
  { id: 'all', name: 'Todos' },
  { id: 'sub', name: 'Suscriptores' },
  { id: 'vip', name: 'VIP y mods' },
];

const whole = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

export const TriggerFields: React.FC<TriggerFieldsProps> = ({ reward, settings, patch, onNote }) => {
  const uid = useId();
  const [probe, setProbe] = useState(100);
  const detect = useRewardDetect((rewardId) => {
    const other = settings.rewards.find((entry) => entry.id !== reward.id && entry.twitchRewardId === rewardId);
    patch({ twitchRewardId: rewardId, userInputRequired: true });
    onNote(
      other
        ? `Recompensa de Twitch detectada. Ojo: «${other.name}» ya estaba enlazada a la misma; solo responderá la primera de la lista.`
        : 'Recompensa de Twitch detectada y enlazada.'
    );
  });

  const bits = reward.trigger === 'bits';
  const matches = bitsCandidates(settings.rewards, probe);
  const winner = matches[0];
  const low = isLowBits(reward);

  return (
    <>
      <div className="grid gap-4">
        <Field label="Se activa con">
          <div className="cab-seg" role="group" aria-label="Se activa con">
            <button type="button" aria-pressed={!bits} onClick={() => patch({ trigger: 'points' })}>
              Puntos de canal
            </button>
            <button
              type="button"
              aria-pressed={bits}
              onClick={() =>
                patch({
                  trigger: 'bits',
                  // Una recompensa por bits nace con espera: frena la ráfaga de cheers pequeños
                  cooldownSeconds: reward.cooldownSeconds || DEFAULT_BITS_COOLDOWN_SECONDS,
                })
              }
            >
              Bits
            </button>
          </div>
        </Field>
        <Field label="Quién puede activarla">
          <div className="cab-seg" role="group" aria-label="Quién puede activarla">
            {AUDIENCES.map((item) => (
              <button key={item.id} type="button" aria-pressed={reward.audience === item.id} onClick={() => patch({ audience: item.id })}>
                {item.name}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {!bits && (
        <>
          <div className="rw-two">
            <Field label="Costo en puntos" htmlFor={`${uid}-cost`} hint="Lo cobra Twitch. Aquí es solo para que la reconozcas.">
              <input
                id={`${uid}-cost`}
                type="number"
                min={0}
                step={50}
                className="cab-inp cab-mono"
                value={reward.cost}
                onChange={(e) => patch({ cost: whole(e.target.value, 0, 10_000_000) })}
              />
            </Field>
            <Field
              label="Recompensa de Twitch"
              hint={reward.twitchRewardId ? `Enlazada: ${reward.twitchRewardId.slice(0, 8)}…` : 'Aún sin enlazar: en directo no se activará.'}
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cab-btn2 cab-btn-sm"
                  disabled={!settings.channel}
                  onClick={() => (detect.detecting ? detect.cancel() : detect.start(settings.channel))}
                >
                  {detect.detecting ? 'Cancelar' : reward.twitchRewardId ? 'Detectar otra vez' : 'Detectar'}
                </button>
                {reward.twitchRewardId && (
                  <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => patch({ twitchRewardId: '' })}>
                    Desenlazar
                  </button>
                )}
              </div>
            </Field>
          </div>
          {detect.detecting && (
            <p className="cab-note" role="status">
              Escuchando el chat de #{settings.channel}. Canjea ahora esta recompensa en tu canal y escribe cualquier texto.
            </p>
          )}
          {detect.message && (
            <p className="cab-error" role="alert">
              {detect.message}
            </p>
          )}
          <p className="cab-note">
            La recompensa de Twitch tiene que tener activado «Requerir que el espectador escriba un texto». Sin eso, el
            canje no pasa por el chat y esta capa no lo ve. Pulsa «Detectar», canjéala una vez y queda enlazada. Twitch no
            devuelve los puntos de un canje descartado por la espera: pon la misma espera en Twitch.
          </p>
        </>
      )}

      {bits && (
        <>
          <div className="rw-two">
            <Field label="Cantidad">
              <div className="cab-seg" role="group" aria-label="Cantidad de bits">
                <button type="button" aria-pressed={reward.bitsMode === 'exact'} onClick={() => patch({ bitsMode: 'exact' })}>
                  Exacta
                </button>
                <button type="button" aria-pressed={reward.bitsMode === 'range'} onClick={() => patch({ bitsMode: 'range' })}>
                  Rango
                </button>
              </div>
            </Field>
            <Field label={reward.bitsMode === 'exact' ? 'Bits' : 'Mínimo'} htmlFor={`${uid}-min`} hint="Número entero, desde 1.">
              <input
                id={`${uid}-min`}
                type="number"
                min={REWARD_LIMITS.bits.min}
                max={REWARD_LIMITS.bits.max}
                step={1}
                className="cab-inp cab-mono"
                value={reward.bitsMin}
                onChange={(e) => {
                  const bitsMin = whole(e.target.value, REWARD_LIMITS.bits.min, REWARD_LIMITS.bits.max);
                  patch({ bitsMin, bitsMax: reward.bitsMax === null ? null : Math.max(bitsMin, reward.bitsMax) });
                }}
              />
            </Field>
            {reward.bitsMode === 'range' && (
              <Field label="Máximo (opcional)" htmlFor={`${uid}-max`} hint="Vacío: sin tope.">
                <input
                  id={`${uid}-max`}
                  type="number"
                  min={reward.bitsMin}
                  max={REWARD_LIMITS.bits.max}
                  step={1}
                  placeholder="sin tope"
                  className="cab-inp cab-mono"
                  value={reward.bitsMax ?? ''}
                  onChange={(e) =>
                    patch({ bitsMax: e.target.value === '' ? null : whole(e.target.value, REWARD_LIMITS.bits.min, REWARD_LIMITS.bits.max) })
                  }
                  onBlur={() => reward.bitsMax !== null && reward.bitsMax < reward.bitsMin && patch({ bitsMax: reward.bitsMin })}
                />
              </Field>
            )}
          </div>
          <p className="cab-hint">
            Si dos recompensas coinciden con el mismo cheer, suena solo una: gana la más específica. Primero la cantidad
            exacta, luego el rango más estrecho y, a igualdad, el mínimo más alto. Los cheers anónimos cuentan y salen
            como «Anónimo».
          </p>
          <p className="rw-result">
            <span className="rw-inline">
              <label htmlFor={`${uid}-probe`}>Con un cheer de</label>
              <input
                id={`${uid}-probe`}
                type="number"
                min={1}
                max={REWARD_LIMITS.bits.max}
                className="cab-inp cab-mono"
                value={probe}
                onChange={(e) => setProbe(whole(e.target.value, 1, REWARD_LIMITS.bits.max))}
              />
              <span>
                {probe === 1 ? 'bit' : 'bits'} suena:{' '}
                <b>
                  {winner
                    ? `${winner.name}${matches.length > 1 ? ` (coinciden ${matches.length}; gana la más específica)` : ''}`
                    : 'ninguna'}
                </b>
              </span>
            </span>
          </p>
          {low && (
            <p className="rw-warn" role="note">
              Con un mínimo de {reward.bitsMin} {reward.bitsMin === 1 ? 'bit' : 'bits'} (más o menos{' '}
              {reward.bitsMin === 1 ? 'un céntimo' : `${reward.bitsMin} céntimos`} de dólar) cualquiera puede repetir este
              sonido muchas veces por muy poco. Lo frenan la espera de esta recompensa (
              {reward.cooldownSeconds ? `${reward.cooldownSeconds} s` : 'ahora sin espera'}), el límite por espectador (
              {settings.perViewerPerMinute ? `${settings.perViewerPerMinute} por minuto` : 'ahora sin límite'}) y la cola (
              {settings.queueMax} en espera como mucho). Si te llenan el directo, sube la espera.
            </p>
          )}
        </>
      )}

      <Field
        label="Espera entre usos"
        htmlFor={`${uid}-cooldown`}
        hint="En segundos. Un uso antes de tiempo se descarta y queda anotado; no se guarda para después. Con 0 no hay espera."
      >
        <input
          id={`${uid}-cooldown`}
          type="number"
          min={REWARD_LIMITS.cooldown.min}
          max={REWARD_LIMITS.cooldown.max}
          className="cab-inp cab-mono sm:max-w-[160px]"
          value={reward.cooldownSeconds}
          onChange={(e) => patch({ cooldownSeconds: whole(e.target.value, REWARD_LIMITS.cooldown.min, REWARD_LIMITS.cooldown.max) })}
        />
      </Field>
    </>
  );
};
