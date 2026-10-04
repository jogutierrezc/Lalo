/**
 * src/components/voz/RulesPanel.tsx
 *
 * Pestaña «Reglas» de Voz del chat: quién puede usar la voz, cuánto y cómo se
 * activa. A la vista queda lo básico; los bloqueos y las formas de activarla
 * van plegados.
 */

import React, { useId, useState } from 'react';
import { X } from 'lucide-react';
import type { TTSSettings } from '../../types/settings';
import { LIMITS, MIN_ROLES, normalizeUser, parseWordList } from '../../utils/moderation';
import { Field, Range, Toggle, UndoNote, useUndo } from '../studio/StudioKit';
import type { RewardDetect } from './useRewardDetect';

interface RulesPanelProps {
  settings: TTSSettings;
  update: (patch: Partial<TTSSettings>) => void;
  detect: RewardDetect;
}

export const RulesPanel: React.FC<RulesPanelProps> = ({ settings, update, detect }) => {
  const uid = useId();
  const [wordsDraft, setWordsDraft] = useState(() => settings.blockedWords.join(', '));
  const [userDraft, setUserDraft] = useState('');
  const rewardUndo = useUndo<string>();

  const hasChannel = Boolean(settings.channel.trim());

  const addUserDraft = () => {
    const user = normalizeUser(userDraft);
    setUserDraft('');
    if (!user || settings.blockedUsers.includes(user)) return;
    update({ blockedUsers: [...settings.blockedUsers, user] });
  };
  const unblockUser = (user: string) => update({ blockedUsers: settings.blockedUsers.filter((u) => u !== user) });

  const removeReward = () => {
    rewardUndo.offer('Se quitó la recompensa enlazada.', settings.rewardId);
    update({ rewardId: '' });
  };

  return (
    <>
      <Field label="Quién puede usar !s" hint="Tú y tus mods siempre podéis. Los canjes de puntos y los bits no dependen de este filtro.">
        <div className="cab-seg" role="group" aria-label="Quién puede usar el comando">
          {MIN_ROLES.map((role) => (
            <button key={role.id} type="button" aria-pressed={settings.minRole === role.id} onClick={() => update({ minRole: role.id })}>
              {role.name}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Espera por usuario" hint="Tiempo mínimo entre dos mensajes del mismo espectador.">
        <Range
          label="Espera por usuario"
          min={LIMITS.cooldown.min}
          max={LIMITS.cooldown.max}
          step={5}
          value={settings.cooldownSec}
          format={(value) => (value ? `${value} s` : 'Sin')}
          onChange={(cooldownSec) => update({ cooldownSec })}
        />
      </Field>

      <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
        <Field label="Longitud máxima" hint="Caracteres que se leen de cada mensaje.">
          <Range
            label="Longitud máxima"
            min={LIMITS.length.min}
            max={LIMITS.length.max}
            step={10}
            value={settings.maxLength}
            format={(value) => String(value)}
            onChange={(maxLength) => update({ maxLength })}
          />
        </Field>
        <Field label="Cola máxima" hint="Mensajes que pueden esperar a la vez.">
          <Range
            label="Cola máxima"
            min={LIMITS.queue.min}
            max={LIMITS.queue.max}
            value={settings.maxQueueSize}
            format={(value) => String(value)}
            onChange={(maxQueueSize) => update({ maxQueueSize })}
          />
        </Field>
      </div>

      <div className="cab-field">
        <Toggle label="Prioridad a puntos y bits" checked={settings.priorityPaid} onChange={(priorityPaid) => update({ priorityPaid })} />
        <span className="cab-hint">Los mensajes de canjes y cheers pasan delante de los del comando !s.</span>
      </div>

      <details className="studio-details">
        <summary>Bloqueos</summary>
        <div>
          <Field
            label="Palabras bloqueadas"
            htmlFor={`${uid}-words`}
            hint="Separadas por comas. Un mensaje que contenga alguna se descarta entero. No distingue mayúsculas ni tildes."
          >
            <textarea
              id={`${uid}-words`}
              rows={2}
              value={wordsDraft}
              onChange={(e) => {
                setWordsDraft(e.target.value);
                update({ blockedWords: parseWordList(e.target.value) });
              }}
              spellCheck={false}
              className="cab-inp"
            />
          </Field>

          <Field label="Usuarios bloqueados" htmlFor={`${uid}-user`}>
            <div className="flex gap-2">
              <input
                id={`${uid}-user`}
                type="text"
                value={userDraft}
                onChange={(e) => setUserDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addUserDraft();
                }}
                placeholder="nombre_de_usuario"
                autoComplete="off"
                spellCheck={false}
                className="cab-inp cab-mono"
              />
              <button type="button" className="cab-btn2" onClick={addUserDraft} disabled={!normalizeUser(userDraft)}>
                Bloquear
              </button>
            </div>
            {settings.blockedUsers.length ? (
              <ul className="flex flex-wrap gap-2">
                {settings.blockedUsers.map((user) => (
                  <li key={user} className="cab-chip cab-chip-lg">
                    <span className="cab-mono">{user}</span>
                    <button type="button" aria-label={`Desbloquear a ${user}`} title="Desbloquear" onClick={() => unblockUser(user)}>
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="cab-hint">Nadie bloqueado.</span>
            )}
          </Field>
        </div>
      </details>

      <details className="studio-details">
        <summary>Cómo se activa</summary>
        <div>
          <div className="cab-field">
            <Toggle
              label={
                <>
                  Comando <span className="vz-code">!s</span>
                </>
              }
              checked={settings.commandEnabled}
              onChange={(commandEnabled) => update({ commandEnabled })}
            />
            <span className="cab-hint">Cualquier mensaje que empiece con !s se lee, según las reglas de arriba.</span>
          </div>

          <Field
            label="Recompensa de puntos del canal"
            hint={
              detect.detecting
                ? 'Escuchando el chat durante 90 segundos. Canjea ahora la recompensa con cualquier texto.'
                : settings.rewardId
                  ? 'Recompensa enlazada. El texto que escriba quien la canjee se lee en voz alta.'
                  : 'Crea en Twitch una recompensa que pida texto al espectador. Pulsa «Detectar recompensa» y canjéala una vez para enlazarla.'
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              {settings.rewardId ? (
                <>
                  <code className="cab-url cab-mono">{settings.rewardId}</code>
                  <button type="button" className="cab-btn2" onClick={removeReward}>
                    Quitar
                  </button>
                </>
              ) : detect.detecting ? (
                <button type="button" className="cab-btn2" onClick={detect.cancel}>
                  Dejar de escuchar
                </button>
              ) : (
                <button type="button" className="cab-btn2" onClick={() => detect.start(settings.channel)} disabled={!hasChannel}>
                  Detectar recompensa
                </button>
              )}
            </div>
            {detect.message && !detect.detecting && !settings.rewardId && (
              <span className="cab-error" role="alert">
                {detect.message}
              </span>
            )}
            {!hasChannel && !settings.rewardId && (
              <span className="cab-hint">
                Para detectarla hace falta el canal. Escríbelo en{' '}
                <a className="studio-link" href="#dashboard">
                  Inicio
                </a>
                .
              </span>
            )}
            {rewardUndo.pending && (
              <UndoNote
                label={rewardUndo.pending.label}
                onUndo={() => {
                  update({ rewardId: rewardUndo.pending?.snapshot ?? '' });
                  rewardUndo.clear();
                }}
              />
            )}
          </Field>

          <Field label="Bits mínimos" htmlFor={`${uid}-bits`} hint="Un cheer con al menos estos bits lee su mensaje. Con 0 queda desactivado.">
            <input
              id={`${uid}-bits`}
              type="number"
              inputMode="numeric"
              min={LIMITS.bits.min}
              max={LIMITS.bits.max}
              step={50}
              value={settings.minBits}
              onChange={(e) => update({ minBits: Math.max(0, Math.min(LIMITS.bits.max, parseInt(e.target.value, 10) || 0)) })}
              className="cab-inp cab-mono"
              style={{ maxWidth: 160 }}
            />
          </Field>
        </div>
      </details>
    </>
  );
};
