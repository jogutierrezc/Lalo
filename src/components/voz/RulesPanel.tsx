/**
 * src/components/voz/RulesPanel.tsx
 *
 * Pestaña «Reglas» de Voz del chat: qué lee la voz (con comando, todo el chat,
 * solo destacados o nada), quién puede usarla, cuánto y cómo se activa. A la vista queda lo básico; los bloqueos y las formas de activarla
 * van plegados.
 */

import React, { useId, useState } from 'react';
import { X } from 'lucide-react';
import type { TTSSettings } from '../../types/settings';
import {
  DEFAULT_BOTS,
  LIMITS,
  MIN_ROLES,
  VOICE_MODES,
  VoiceMode,
  normalizeBots,
  normalizeUser,
  normalizeVoiceCommand,
  parseWordList,
} from '../../utils/moderation';
import { Field, Range, Toggle, UndoNote, useUndo } from '../studio/StudioKit';
import type { RewardDetect } from './useRewardDetect';

interface RulesPanelProps {
  settings: TTSSettings;
  update: (patch: Partial<TTSSettings>) => void;
  detect: RewardDetect;
}

const MODE_HINT: Record<VoiceMode, (command: string) => string> = {
  command: (command) =>
    `Solo se leen los mensajes que empiezan por ${command}. Es lo que menos cuota de voz gasta y lo más fácil de moderar.`,
  all: (command) =>
    `Se lee todo lo que se escribe, hasta el tope por minuto. Quien quiera asegurarse de ser leído puede seguir usando ${command}.`,
  highlights: () =>
    'Solo se leen los mensajes destacados con puntos del canal, los que llevan bits y los canjes con texto. Si tienes una recompensa enlazada, de los canjes solo cuenta esa.',
  off: () => 'La voz no lee nada del chat. Las pruebas desde el panel y las alertas siguen sonando.',
};

export const RulesPanel: React.FC<RulesPanelProps> = ({ settings, update, detect }) => {
  const uid = useId();
  const [wordsDraft, setWordsDraft] = useState(() => settings.blockedWords.join(', '));
  const [userDraft, setUserDraft] = useState('');
  const [commandDraft, setCommandDraft] = useState(settings.voiceCommand);
  const [botsDraft, setBotsDraft] = useState(() => settings.ignoredBots.join(', '));

  const mode = settings.voiceMode;
  const command = settings.voiceCommand;
  // El borrador vale si, con su ! delante, coincide con lo que se guarda
  const typed = commandDraft.trim().toLowerCase();
  const commandValid = normalizeVoiceCommand(typed) === (typed.startsWith('!') ? typed : `!${typed}`);
  const usesCommand = mode === 'command' || mode === 'all';
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
      <Field label="Qué lee la voz" hint={MODE_HINT[mode](command)}>
        <div className="cab-seg" role="group" aria-label="Qué lee la voz">
          {VOICE_MODES.map((item) => (
            <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => update({ voiceMode: item.id })}>
              {item.name}
            </button>
          ))}
        </div>
      </Field>

      {mode === 'all' && (
        <>
          <p className="cab-note" role="note">
            Leer todo el chat gasta la cuota de voz muy rápido y puede leer al aire cosas que no quieres. Por eso este modo
            nunca lee comandos, enlaces, mensajes de solo emotes ni bots, y lleva un tope por minuto. Lo que pasa del
            tope se descarta, no se guarda para después.
          </p>
          <Field label="Tope por minuto" hint="Mensajes del chat que la voz lee como mucho cada minuto.">
            <Range
              label="Tope de mensajes por minuto"
              min={LIMITS.perMinute.min}
              max={LIMITS.perMinute.max}
              value={settings.allPerMinute}
              format={(value) => `${value} por minuto`}
              onChange={(allPerMinute) => update({ allPerMinute })}
            />
          </Field>
          <Field
            label="Bots que no se leen"
            htmlFor={`${uid}-bots`}
            hint="Nombres de usuario separados por comas. Si la dejas vacía, vuelve la lista habitual."
          >
            <textarea
              id={`${uid}-bots`}
              rows={2}
              value={botsDraft}
              onChange={(e) => {
                setBotsDraft(e.target.value);
                const bots = normalizeBots(e.target.value.split(/[,\s]+/));
                update({ ignoredBots: bots.length ? bots : DEFAULT_BOTS });
              }}
              onBlur={() => setBotsDraft(settings.ignoredBots.join(', '))}
              spellCheck={false}
              className="cab-inp cab-mono"
            />
          </Field>
        </>
      )}

      {usesCommand && (
        <Field
          label="Comando de voz"
          htmlFor={`${uid}-command`}
          hint={
            commandValid
              ? 'Cámbialo por el que quieras, por ejemplo !di o !leer. Las órdenes de moderación (!s skip, !s pausa) siguen usando !s.'
              : 'Solo letras, números y guion bajo, hasta 11 caracteres. Mientras no sea válido se usa !s.'
          }
        >
          <input
            id={`${uid}-command`}
            type="text"
            value={commandDraft}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!commandValid}
            onChange={(e) => {
              setCommandDraft(e.target.value);
              update({ voiceCommand: normalizeVoiceCommand(e.target.value) });
            }}
            onBlur={() => setCommandDraft(settings.voiceCommand)}
            className="cab-inp cab-mono"
            style={{ maxWidth: 160 }}
          />
        </Field>
      )}

      <Field
        label={mode === 'all' ? 'Quién puede ser leído' : `Quién puede usar ${command}`}
        hint="Tú y tus mods siempre podéis. Los canjes de puntos y los bits no dependen de este filtro."
      >
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
        <span className="cab-hint">Los mensajes de canjes y cheers pasan delante de los demás.</span>
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
                  Comando <span className="vz-code">{command}</span>
                </>
              }
              checked={settings.commandEnabled}
              onChange={(commandEnabled) => update({ commandEnabled })}
            />
            <span className="cab-hint">
              Cualquier mensaje que empiece con {command} se lee, según las reglas de arriba. No aplica en los modos «Solo
              destacados» y «Nada».
            </span>
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
