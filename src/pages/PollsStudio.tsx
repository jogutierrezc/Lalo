/**
 * src/pages/PollsStudio.tsx
 *
 * Estudio de Batallas sobre la plantilla común del panel: a la izquierda se
 * prepara la batalla, a la derecha el monitor 16:9 queda siempre a la vista.
 *
 * - La batalla se inicia, se pausa y se reinicia bajo el monitor.
 * - Cargar una plantilla o reiniciar los votos se puede deshacer.
 * - Los votos de prueba, los comandos y el locutor están plegados en «Más».
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import {
  DEFAULT_BATTLE_PRESETS,
  PollBattlePreset,
  PollOption,
  PollSettings,
  POLL_THEMES,
} from '../types/polls';
import { usePollsSettings } from '../hooks/usePollsSettings';
import { BattleBarView } from '../components/polls/BattleBarView';
import { speakPollEmotionCue } from '../utils/pollsAudio';
import { loadSettings, saveSettings } from '../types/settings';
import { useVoiceCatalogue } from '../hooks/useVoiceCatalogue';
import { Field, Toggle, UndoNote, useUndo } from '../components/studio/StudioKit';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import { useCloudSession } from '../hooks/useCloudSession';
import '../styles/capas.css';

const SWATCHES: [{ color: string; name: string }[], { color: string; name: string }[]] = [
  [
    { color: '#00e5ff', name: 'Cian' },
    { color: '#0284c7', name: 'Azul' },
    { color: '#10b981', name: 'Esmeralda' },
    { color: '#a855f7', name: 'Morado' },
    { color: '#f59e0b', name: 'Oro' },
  ],
  [
    { color: '#ff0055', name: 'Rosa' },
    { color: '#ef4444', name: 'Rojo' },
    { color: '#f59e0b', name: 'Ámbar' },
    { color: '#8b5cf6', name: 'Violeta' },
    { color: '#ec4899', name: 'Fucsia' },
  ],
];

const DURATIONS = [15, 30, 45, 60, 90, 120];

const PRESET_NAMES: Record<PollBattlePreset['category'], string> = {
  gamer: 'Juegos',
  castigos: 'Castigos',
  irl: 'Comida',
  show: 'Juicio final',
};

type BattleSnapshot = Pick<PollSettings, 'activeBattleTitle' | 'durationSec' | 'options'> & {
  where: 'plantilla' | 'reinicio';
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
/** Lo que se oye: la frase sin las marcas de emoción entre corchetes. */
const spoken = (text: string) => text.replace(/\[[^\]]+\]/g, '').trim();

export const PollsStudio: React.FC = () => {
  const {
    settings,
    saved,
    timeLeft,
    isActive,
    winner,
    castVote,
    startBattle,
    pauseBattle,
    resetBattle,
    loadPreset,
    updateSettings,
  } = usePollsSettings();
  const cloud = useCloudSession();
  const uid = useId();

  const [copiedUrl, setCopiedUrl] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const undo = useUndo<BattleSnapshot>();
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voteCount = useRef(0);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
    },
    []
  );

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3500);
  };

  const [optionA, optionB] = settings.options;
  const totalVotes = optionA.votes + optionB.votes;

  // ---------- Batalla ----------
  const patchOption = (index: 0 | 1, value: Partial<PollOption>) => {
    const next: [PollOption, PollOption] = [settings.options[0], settings.options[1]];
    next[index] = { ...next[index], ...value };
    updateSettings({ options: next });
  };

  const snapshot = (where: BattleSnapshot['where']): BattleSnapshot => ({
    where,
    activeBattleTitle: settings.activeBattleTitle,
    durationSec: settings.durationSec,
    options: settings.options,
  });

  const applyPreset = (preset: PollBattlePreset) => {
    undo.offer(`Se cargó la plantilla «${PRESET_NAMES[preset.category]}» y reemplazó tu batalla.`, snapshot('plantilla'));
    loadPreset(preset);
  };

  const reset = () => {
    if (totalVotes > 0) undo.offer('Se reiniciaron los votos.', snapshot('reinicio'));
    resetBattle();
  };

  const restore = () => {
    if (!undo.pending) return;
    const { activeBattleTitle, durationSec, options } = undo.pending.snapshot;
    updateSettings({ activeBattleTitle, durationSec, options });
    undo.clear();
  };

  // ---------- Probar sin chat ----------
  // Cada voto de prueba es de un espectador distinto: así siempre suma
  const testVoter = () => {
    voteCount.current += 1;
    return `prueba_${Date.now()}_${voteCount.current}`;
  };

  const burst = () => {
    const votesA = Math.floor(Math.random() * 5) + 2;
    const votesB = Math.floor(Math.random() * 5) + 2;
    for (let i = 0; i < votesA; i++) castVote(0, testVoter());
    for (let i = 0; i < votesB; i++) castVote(1, testVoter());
    say(`Ráfaga de prueba: ${votesA} votos a la opción 1 y ${votesB} a la opción 2.`);
  };

  // ---------- Locutor ----------
  const announcer = settings.ttsAnnouncer;
  // El nombre sale del catálogo. Si la voz guardada ya no está en él, se pasa a la voz por defecto
  const voiceList = useVoiceCatalogue(loadSettings().referenceId, (defaultId) =>
    saveSettings({ ...loadSettings(), referenceId: defaultId })
  );
  const voiceName =
    voiceList.catalogue.voices.find((voice) => voice.id === loadSettings().referenceId)?.name || 'voz personalizada';
  const lead = optionB.votes > optionA.votes ? optionB : optionA;
  const leadPct = totalVotes > 0 ? Math.round((lead.votes / totalVotes) * 100) : 50;
  const lines = [
    {
      key: 'lead',
      when: 'Cuando cambia quien va ganando',
      text: announcer.leadChangeText.replace('{ganador}', lead.label),
      emotion: announcer.leadChangeEmotion,
    },
    {
      key: 'countdown',
      when: 'Cuando quedan 10 segundos',
      text: announcer.countdownText,
      emotion: announcer.countdownEmotion,
    },
    {
      key: 'winner',
      when: 'Al terminar',
      text: announcer.winnerAnnouncementText
        .replace('{ganador}', lead.label)
        .replace('{porcentaje}', String(leadPct)),
      emotion: announcer.winnerEmotion,
    },
    {
      key: 'tie',
      when: 'Si termina en empate',
      text: announcer.tieText,
      emotion: announcer.tieEmotion,
    },
  ];

  const listen = (key: string, text: string, emotion: string) => {
    setSpeaking(key);
    speakPollEmotionCue(text, emotion, undefined, () => setSpeaking(null)).catch(() => setSpeaking(null));
  };

  // ---------- URL de OBS ----------
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const copyWidgetUrl = () => {
    const url = buildSuiteWidgetUrl(baseUrl, 'polls', settings.channel, loadSettings(), {
      theme: settings.theme,
      ...(cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : {}),
    });
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  // ---------- Estado del reloj ----------
  const paused = !isActive && !winner && timeLeft > 0 && timeLeft < settings.durationSec;
  const timeText = isActive
    ? `Quedan ${clock(timeLeft)}`
    : winner
    ? 'Batalla terminada'
    : paused
    ? `En pausa con ${clock(timeLeft)}. Al iniciar, el reloj empieza de nuevo.`
    : `Dura ${clock(settings.durationSec)}`;

  const undoNote = (where: BattleSnapshot['where']) =>
    undo.pending?.snapshot.where === where && <UndoNote label={undo.pending.label} onUndo={restore} />;

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="encuestas" channel={settings.channel} saved={saved} tourAvailable={false} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
          <div className="grid gap-5">
            {/* ---------- Batalla ---------- */}
            <section className="cab-mod">
              <h2>Batalla</h2>
              <Field label="Pregunta" htmlFor={`${uid}-title`}>
                <input
                  id={`${uid}-title`}
                  className="cab-inp"
                  value={settings.activeBattleTitle}
                  placeholder="¿A qué jugamos en el próximo bloque?"
                  onChange={(e) => updateSettings({ activeBattleTitle: e.target.value })}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                {([0, 1] as const).map((index) => {
                  const option = settings.options[index];
                  return (
                    <Field
                      key={option.id}
                      label={`Opción ${index + 1}`}
                      htmlFor={`${uid}-option-${index}`}
                      hint={`El chat la vota escribiendo ${index + 1}.`}
                    >
                      <input
                        id={`${uid}-option-${index}`}
                        className="cab-inp"
                        value={option.label}
                        onChange={(e) => patchOption(index, { label: e.target.value })}
                      />
                      <div className="cab-sw" role="group" aria-label={`Color de la opción ${index + 1}`}>
                        {SWATCHES[index].map((swatch) => (
                          <button
                            key={swatch.color}
                            type="button"
                            style={{ background: swatch.color }}
                            aria-label={swatch.name}
                            aria-pressed={option.color === swatch.color}
                            onClick={() => patchOption(index, { color: swatch.color })}
                          />
                        ))}
                        <input
                          type="color"
                          value={option.color}
                          aria-label="Otro color"
                          onChange={(e) => patchOption(index, { color: e.target.value })}
                        />
                      </div>
                    </Field>
                  );
                })}
              </div>

              <Field
                label="Duración"
                hint={
                  DURATIONS.includes(settings.durationSec) ? undefined : `Ahora dura ${settings.durationSec} segundos.`
                }
              >
                <div className="cab-seg" role="group" aria-label="Duración de la batalla">
                  {DURATIONS.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      aria-pressed={settings.durationSec === seconds}
                      onClick={() => updateSettings({ durationSec: seconds })}
                    >
                      {seconds} s
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Plantillas" hint="Una plantilla reemplaza la pregunta, las opciones y los votos.">
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_BATTLE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="cab-btn2 cab-btn-sm"
                      title={`${preset.optionA.label} contra ${preset.optionB.label}`}
                      onClick={() => applyPreset(preset)}
                    >
                      {PRESET_NAMES[preset.category]}
                    </button>
                  ))}
                </div>
              </Field>
              {undoNote('plantilla')}
            </section>

            {/* ---------- Aspecto ---------- */}
            <section className="cab-mod">
              <h2>Aspecto</h2>
              <Field label="Tema" hint="Cambia colores, radio y tipografía de la placa.">
                <div className="cab-seg" role="group" aria-label="Tema de la batalla">
                  {POLL_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      aria-pressed={settings.theme === theme.id}
                      title={theme.description}
                      onClick={() => updateSettings({ theme: theme.id })}
                    >
                      {theme.name}
                    </button>
                  ))}
                </div>
              </Field>
            </section>

            {/* ---------- Más ---------- */}
            <section className="cab-mod">
              <h2>Más</h2>

              <details className="studio-details">
                <summary>Probar sin chat</summary>
                <div>
                  <div className="flex flex-wrap gap-2">
                    {([0, 1] as const).map((index) => (
                      <button
                        key={index}
                        type="button"
                        className="cab-btn2"
                        onClick={() => castVote(index, testVoter())}
                      >
                        <i className="capas-dot" style={{ background: settings.options[index].color }} />
                        <span>Voto a {index + 1}</span>
                      </button>
                    ))}
                    <button type="button" className="cab-btn2" onClick={burst}>
                      Ráfaga
                    </button>
                  </div>
                  <p className="cab-hint">
                    Suman votos a la batalla actual, igual que si llegaran del chat. «Reiniciar» los pone a cero.
                  </p>
                </div>
              </details>

              <details className="studio-details">
                <summary>Reglas y sonido</summary>
                <div>
                  <Toggle
                    label="Permitir cambiar de voto"
                    checked={settings.allowVoteChange}
                    onChange={(next) => updateSettings({ allowVoteChange: next })}
                  />
                  <Toggle
                    label="Sonidos al votar, al cambiar el líder y al terminar"
                    checked={settings.audioEffectsEnabled}
                    onChange={(next) => updateSettings({ audioEffectsEnabled: next })}
                  />
                </div>
              </details>

              <details className="studio-details">
                <summary>Comandos para moderadores</summary>
                <div>
                  <ul className="cab-cmds">
                    <li>
                      <code className="cab-mono">!poll "Pregunta" "Opción 1" "Opción 2" 45</code>
                      <br />
                      Crea una batalla de 45 segundos.
                    </li>
                    <li>
                      <code className="cab-mono">!poll Valorant | Minecraft | 60</code>
                      <br />
                      Lo mismo en corto. También vale <code className="cab-mono">!poll Gatos vs Perros 30</code>.
                    </li>
                    <li>
                      <code className="cab-mono">!poll preset gamer 60</code>
                      <br />
                      Carga una plantilla: <code className="cab-mono">gamer</code>,{' '}
                      <code className="cab-mono">castigos</code>, <code className="cab-mono">comida</code> o{' '}
                      <code className="cab-mono">juicio</code>.
                    </li>
                    <li>
                      <code className="cab-mono">!poll 45</code>
                      <br />
                      Inicia la batalla actual durante 45 segundos.
                    </li>
                    <li>
                      <code className="cab-mono">!poll stop</code>
                      <br />
                      La detiene antes de tiempo.
                    </li>
                  </ul>
                  <p className="cab-note">
                    El chat vota escribiendo <span className="cab-mono">1</span> o <span className="cab-mono">2</span>.
                    También valen <span className="cab-mono">!1</span>, <span className="cab-mono">!2</span> y{' '}
                    <span className="cab-mono">!voto 1</span>.
                  </p>
                </div>
              </details>

              <details className="studio-details">
                <summary>Locutor</summary>
                <div>
                  <Toggle
                    label="Anunciar la batalla con voz"
                    checked={announcer.enabled}
                    onChange={(next) => updateSettings({ ttsAnnouncer: { ...announcer, enabled: next } })}
                  />
                  <p className="cab-hint">
                    La voz es la de «Voz del chat»: {voiceName}.{' '}
                    <a className="studio-link" href="#tts">
                      Cambiarla
                    </a>
                  </p>
                  {lines.map((line) => (
                    <div key={line.key} className="capas-line">
                      <p className="cab-label">{line.when}</p>
                      <p>{spoken(line.text)}</p>
                      <button
                        type="button"
                        className="cab-btn2 cab-btn-sm"
                        disabled={speaking !== null}
                        aria-label={`Escuchar: ${line.when}`}
                        onClick={() => listen(line.key, line.text, line.emotion)}
                      >
                        <Volume2 className="h-4 w-4" />
                        <span>{speaking === line.key ? 'Sonando' : 'Escuchar'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4">
            <h2>Monitor</h2>
            <div className="cab-stage items-center justify-center">
              <BattleBarView
                title={settings.activeBattleTitle}
                optionA={optionA}
                optionB={optionB}
                theme={settings.theme}
                timeLeftSec={timeLeft}
                totalDurationSec={settings.durationSec}
                isActive={isActive}
                winner={winner}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="cab-btn flex-1"
                onClick={() => (isActive ? pauseBattle() : startBattle())}
              >
                {isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{isActive ? 'Pausar' : 'Iniciar batalla'}</span>
              </button>
              <button type="button" className="cab-btn2" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
                <span>Reiniciar</span>
              </button>
            </div>
            <p className="capas-time">{timeText}</p>
            {undoNote('reinicio')}

            <button type="button" className="cab-btn2" onClick={copyWidgetUrl}>
              {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{copiedUrl ? 'URL copiada' : 'Copiar URL para OBS'}</span>
            </button>
            <p className="cab-hint" role="status">
              {status || 'La batalla se ve aquí y en las fuentes de OBS que estén abiertas.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
