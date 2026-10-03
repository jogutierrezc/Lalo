/**
 * src/pages/PollsStudio.tsx
 *
 * Módulo 7: Estudio de Batallas & Encuestas en Vivo (Polls & Versus Studio).
 * Implementación con estética broadcast Impeccable, física fluida GSAP,
 * selector visual interactivo de 5 temas (Cabina, Neon, Esports, Cyber, Minimal),
 * editor de colores y opciones, sincronización reactiva hacia OBS mediante BroadcastChannel
 * y locución TTS modulada con etiquetas emocionales de IA ([emocionado], [susurro], [triunfal]).
 */

import React, { useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Mic,
  Palette,
  Play,
  RotateCcw,
  Shield,
  Sliders,
  Sparkles,
  Terminal,
  Trophy,
  Tv,
  Volume2,
  Zap,
} from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import {
  DEFAULT_BATTLE_PRESETS,
  PollBattlePreset,
  POLL_THEMES,
} from '../types/polls';
import { usePollsSettings } from '../hooks/usePollsSettings';
import { BattleBarView } from '../components/polls/BattleBarView';
import { speakPollEmotionCue, announceModPollStarted } from '../utils/pollsAudio';
import { loadSettings, PRESET_VOICES } from '../types/settings';

const COLOR_SWATCHES_A = [
  '#00e5ff', // Cyan
  '#0284c7', // Electric Blue
  '#10b981', // Emerald
  '#a855f7', // Purple
  '#f59e0b', // Gold
  '#38bdf8', // Sky
];

const COLOR_SWATCHES_B = [
  '#ff0055', // Rose Pink
  '#ff007f', // Acid Magenta
  '#f59e0b', // Amber
  '#ef4444', // Crimson
  '#8b5cf6', // Violet
  '#ec4899', // Hot Pink
];

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

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

  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [isSpeakingEmotion, setIsSpeakingEmotion] = useState<string | null>(null);
  const [simulationNotice, setSimulationNotice] = useState<string | null>(null);

  const ttsSettings = loadSettings();
  const activeVoiceName =
    PRESET_VOICES.find((v) => v.id === ttsSettings.referenceId)?.name || 'Voz Personalizada';

  // Simular ráfaga masiva de votos del chat
  const handleBurstVotes = () => {
    const burstA = Math.floor(Math.random() * 5) + 2;
    const burstB = Math.floor(Math.random() * 5) + 2;
    for (let i = 0; i < burstA; i++) {
      castVote(0, `ChatUserA_${Date.now()}_${i}`);
    }
    for (let i = 0; i < burstB; i++) {
      castVote(1, `ChatUserB_${Date.now()}_${i}`);
    }
    setSimulationNotice(
      `¡Ráfaga del chat recibida! +${burstA} votos para ${settings.options[0].label}, +${burstB} votos para ${settings.options[1].label}.`
    );
    setTimeout(() => setSimulationNotice(null), 3000);
  };

  // Cargar preset de batalla
  const handleSelectPreset = (preset: PollBattlePreset) => {
    loadPreset(preset);
    setSimulationNotice(`Plantilla cargada: ${preset.title}`);
    setTimeout(() => setSimulationNotice(null), 2500);
  };

  // Probar locución de emoción específica
  const handleTestEmotionVoice = (key: string, text: string, emotionTag: string) => {
    setIsSpeakingEmotion(key);
    speakPollEmotionCue(text, emotionTag, undefined, () => setIsSpeakingEmotion(null));
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const obsWidgetUrl = `${baseUrl}/#widget?app=polls&channel=${settings.channel}&theme=${settings.theme}`;

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6">
        {/* Barra superior de navegación de la Suite */}
        <SuiteNav currentApp="encuestas" channel={settings.channel} saved={saved} tourAvailable={false} />

        {/* Encabezado del Módulo */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--cb-line)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-cyan-500 px-1.5 py-0.5 text-[10px] font-black text-black">
                MÓDULO 7
              </span>
              <span className="cab-caps text-xs text-[color:var(--cb-mut)]">
                BATALLAS & ENCUESTAS BROADCAST
              </span>
            </div>
            <h1
              className="cab-caps mt-1 text-2xl font-extrabold"
              style={{ fontStretch: '70%', fontWeight: 800 }}
            >
              Batallas & Encuestas Cinemáticas en Vivo
            </h1>
            <p className="mt-1 text-xs text-[color:var(--cb-mut)]">
              Enfrentamiento en tiempo real con 5 temas visuales cinemáticos, físicas reactivas GSAP, ticks de audio por frecuencia, votación por comandos de chat y locución TTS emocional sincronizada.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="cab-btn2 !h-8 !px-3 !text-xs font-bold transition-transform active:scale-[0.97]"
              onClick={() => {
                navigator.clipboard.writeText(obsWidgetUrl);
                setCopiedUrl(true);
                setTimeout(() => setCopiedUrl(false), 2000);
              }}
              title="Copiar URL para OBS Browser Source"
            >
              {copiedUrl ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedUrl ? '¡URL Copiada!' : 'Copiar URL OBS'}</span>
            </button>
            <a
              href={obsWidgetUrl}
              target="_blank"
              rel="noreferrer"
              className="cab-btn2 !h-8 !px-3 !text-xs font-bold no-underline transition-transform active:scale-[0.97]"
              title="Abrir vista de overlay en pestaña nueva"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Ver Overlay</span>
            </a>
          </div>
        </header>

        {/* Notificación temporal de simulación */}
        {simulationNotice && (
          <div className="flex items-center gap-2 rounded border border-cyan-500/40 bg-cyan-950/40 px-3.5 py-2 text-xs font-bold text-cyan-300">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span>{simulationNotice}</span>
          </div>
        )}

        {/* MONITOR EN VIVO 16:9 DE LA BATALLA (VISTA PREVIA OBS) */}
        <section aria-label="Monitor de simulación de batallas">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <Tv className="h-4 w-4 text-[color:var(--cb-mut)]" />
              <span className="cab-caps text-xs font-extrabold text-[color:var(--cb-fg)]">
                MONITOR DE ESCENARIO 16:9 (VISTA PREVIA OBS)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="cab-mono text-xs font-bold text-cyan-400">
                TEMA ACTIVO: {settings.theme.toUpperCase()}
              </span>
            </div>
          </div>

          <div
            className="relative flex min-h-[380px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-[color:var(--cb-line)] shadow-2xl p-6 md:p-10"
            style={{
              background: 'radial-gradient(ellipse at 50% 40%, #171922 0%, #0a0b0e 100%)',
            }}
          >
            {/* Grilla técnica broadcast */}
            <div
              className="pointer-events-none absolute inset-0 opacity-15"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />

            <BattleBarView
              title={settings.activeBattleTitle}
              optionA={settings.options[0]}
              optionB={settings.options[1]}
              theme={settings.theme}
              timeLeftSec={timeLeft}
              totalDurationSec={settings.durationSec}
              isActive={isActive}
              winner={winner}
            />
          </div>
        </section>

        {/* SELECTOR VISUAL DE TEMAS DE BATALLA */}
        <div className="rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5">
          <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-cyan-400" />
              <h3 className="cab-caps text-xs font-black tracking-wider text-[color:var(--cb-fg)] uppercase">
                Temas Visuales para el Overlay de OBS
              </h3>
            </div>
            <span className="text-xs text-[color:var(--cb-mut)]">Selecciona el diseño para tu stream</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {POLL_THEMES.map((t) => {
              const isSelected = settings.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => updateSettings({ theme: t.id })}
                  className={`relative flex flex-col items-start rounded-md border p-3.5 text-left transition-all active:scale-[0.97] ${
                    isSelected
                      ? 'border-cyan-400 bg-[color:var(--cb-surface)] shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400'
                      : 'border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] hover:border-[color:var(--cb-mut)] hover:bg-[color:var(--cb-surface)]/50'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span
                      className="rounded px-2 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider"
                      style={{
                        backgroundColor: `${t.accent}20`,
                        color: t.accent,
                        border: `1px solid ${t.accent}40`,
                      }}
                    >
                      {t.badge}
                    </span>
                    {isSelected && <Check className="h-4 w-4 text-cyan-400" />}
                  </div>

                  <span className="mt-2 text-sm font-bold text-[color:var(--cb-fg)]">{t.name}</span>
                  <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--cb-mut)]">{t.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* MESA DE CONTROL Y SIMULACIÓN INTERACTIVA */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Panel Izquierdo: Simulador de Votación & Personalización (7 columnas) */}
          <div className="flex flex-col gap-6 lg:col-span-7">
            {/* Simulador de Votos Directos */}
            <div className="rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5">
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-cyan-400" />
                  <h3 className="cab-caps text-xs font-black tracking-wider text-[color:var(--cb-fg)] uppercase">
                    Simulador Interactivo de Votación
                  </h3>
                </div>
                <span className="text-xs text-[color:var(--cb-mut)]">Pulsa para probar físicas y sonido</span>
              </div>

              {/* Botones de Voto para la Opción 1 y Opción 2 */}
              <div className="mt-4 grid grid-cols-2 gap-4">
                {/* Opción 1 Voto */}
                <button
                  type="button"
                  onClick={() => castVote(0, 'AdminStudio')}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-cyan-500/40 bg-cyan-950/30 p-4 transition-all hover:border-cyan-400 hover:bg-cyan-900/40 active:scale-[0.97]"
                >
                  <span className="text-xs font-bold text-cyan-400 uppercase">Votar Opción 1</span>
                  <span className="mt-1 text-base font-black text-[color:var(--cb-fg)]">{settings.options[0].label}</span>
                  <span className="mt-2 rounded bg-cyan-500 px-3 py-1 font-mono text-xs font-black text-slate-950 shadow">
                    +1 Voto (1 o !1)
                  </span>
                </button>

                {/* Opción 2 Voto */}
                <button
                  type="button"
                  onClick={() => castVote(1, 'AdminStudio')}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-rose-500/40 bg-rose-950/30 p-4 transition-all hover:border-rose-400 hover:bg-rose-900/40 active:scale-[0.97]"
                >
                  <span className="text-xs font-bold text-rose-400 uppercase">Votar Opción 2</span>
                  <span className="mt-1 text-base font-black text-[color:var(--cb-fg)]">{settings.options[1].label}</span>
                  <span className="mt-2 rounded bg-rose-500 px-3 py-1 font-mono text-xs font-black text-white shadow">
                    +1 Voto (2 o !2)
                  </span>
                </button>
              </div>

              {/* Acciones de Flujo: Ráfaga, Iniciar, Pausar, Reiniciar */}
              <div className="mt-4 flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleBurstVotes}
                  className="cab-btn2 !h-9 !px-3.5 !text-xs font-bold text-amber-300 border-amber-500/40 hover:border-amber-400 active:scale-[0.97]"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span>Ráfaga de Votos (+Aleatorio)</span>
                </button>

                <button
                  type="button"
                  onClick={() => (isActive ? pauseBattle() : startBattle())}
                  className={`cab-btn !h-9 !px-4 !text-xs font-bold transition-all active:scale-[0.97] ${
                    isActive
                      ? '!bg-amber-500 !text-slate-950 !border-amber-400'
                      : '!bg-emerald-600 !text-white !border-emerald-500 hover:!bg-emerald-500'
                  }`}
                >
                  <Play className={`h-3.5 w-3.5 fill-current ${isActive ? 'rotate-90' : ''}`} />
                  <span>{isActive ? 'Pausar Temporizador' : 'Iniciar Batalla'}</span>
                </button>

                <button
                  type="button"
                  onClick={resetBattle}
                  className="cab-btn2 !h-9 !px-3.5 !text-xs font-bold active:scale-[0.97]"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-[color:var(--cb-mut)]" />
                  <span>Reiniciar Votos</span>
                </button>
              </div>
            </div>

            {/* Personalización de Opciones, Colores y Tiempos */}
            <div className="rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5">
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-cyan-400" />
                  <h3 className="cab-caps text-xs font-black tracking-wider text-[color:var(--cb-fg)] uppercase">
                    Personalización de la Batalla Activa
                  </h3>
                </div>
                <span className="text-xs text-[color:var(--cb-mut)]">Ajusta textos, colores y duración</span>
              </div>

              <div className="mt-4 space-y-4">
                {/* Título de la Batalla */}
                <div className="cab-field">
                  <label className="cab-label" htmlFor="poll-title-input">
                    Título o Pregunta de la Batalla
                  </label>
                  <input
                    id="poll-title-input"
                    type="text"
                    value={settings.activeBattleTitle}
                    onChange={(e) => updateSettings({ activeBattleTitle: e.target.value })}
                    className="cab-inp font-bold"
                    placeholder="Ej: ¿A qué jugamos en el próximo bloque?"
                  />
                </div>

                {/* Grid de 2 Opciones */}
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Opción 1 (Izquierda) */}
                  <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-4">
                    <span className="text-xs font-bold text-cyan-400 uppercase">Configuración Opción 1</span>
                    <input
                      type="text"
                      value={settings.options[0].label}
                      onChange={(e) => {
                        const next = [...settings.options] as [typeof settings.options[0], typeof settings.options[1]];
                        next[0] = { ...next[0], label: e.target.value };
                        updateSettings({ options: next });
                      }}
                      className="cab-inp mt-2 font-bold"
                      placeholder="Nombre opción 1"
                    />

                    {/* Muestras de Color Opción 1 */}
                    <div className="mt-3 flex items-center gap-1.5">
                      <span className="text-[11px] text-[color:var(--cb-mut)] mr-1">Color:</span>
                      {COLOR_SWATCHES_A.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            const next = [...settings.options] as [typeof settings.options[0], typeof settings.options[1]];
                            next[0] = { ...next[0], color: c };
                            updateSettings({ options: next });
                          }}
                          className={`h-5 w-5 rounded-full border-2 transition-transform active:scale-[0.9] ${
                            settings.options[0].color === c ? 'scale-125 border-white' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Opción 2 (Derecha) */}
                  <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-4">
                    <span className="text-xs font-bold text-rose-400 uppercase">Configuración Opción 2</span>
                    <input
                      type="text"
                      value={settings.options[1].label}
                      onChange={(e) => {
                        const next = [...settings.options] as [typeof settings.options[0], typeof settings.options[1]];
                        next[1] = { ...next[1], label: e.target.value };
                        updateSettings({ options: next });
                      }}
                      className="cab-inp mt-2 font-bold"
                      placeholder="Nombre opción 2"
                    />

                    {/* Muestras de Color Opción 2 */}
                    <div className="mt-3 flex items-center gap-1.5">
                      <span className="text-[11px] text-[color:var(--cb-mut)] mr-1">Color:</span>
                      {COLOR_SWATCHES_B.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            const next = [...settings.options] as [typeof settings.options[0], typeof settings.options[1]];
                            next[1] = { ...next[1], color: c };
                            updateSettings({ options: next });
                          }}
                          className={`h-5 w-5 rounded-full border-2 transition-transform active:scale-[0.9] ${
                            settings.options[1].color === c ? 'scale-125 border-white' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Duración de la Votación */}
                <div className="cab-field">
                  <div className="flex items-center justify-between">
                    <span className="cab-label">Duración Predeterminada de la Batalla</span>
                    <span className="font-mono text-xs font-bold text-cyan-400">{settings.durationSec} segundos</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {DURATION_PRESETS.map((dur) => (
                      <button
                        key={dur}
                        type="button"
                        onClick={() => updateSettings({ durationSec: dur })}
                        className={`rounded-md px-3 py-1.5 font-mono text-xs font-bold transition-all active:scale-[0.97] ${
                          settings.durationSec === dur
                            ? 'bg-cyan-500 text-slate-950 shadow-sm'
                            : 'border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-fg)] hover:border-[color:var(--cb-mut)]'
                        }`}
                      >
                        {dur}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ajustes de Reglas */}
                <div className="grid gap-3 pt-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-xs text-[color:var(--cb-fg)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.allowVoteChange}
                      onChange={(e) => updateSettings({ allowVoteChange: e.target.checked })}
                      className="rounded border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-cyan-500 focus:ring-0"
                    />
                    <span>Permitir cambiar de voto durante el tiempo</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-[color:var(--cb-fg)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.audioEffectsEnabled}
                      onChange={(e) => updateSettings({ audioEffectsEnabled: e.target.checked })}
                      className="rounded border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-cyan-500 focus:ring-0"
                    />
                    <span>Efectos de sonido táctiles (Clash & Ticks)</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Presets Listos para Usar */}
            <div className="rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5">
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-400" />
                  <h3 className="cab-caps text-xs font-black tracking-wider text-[color:var(--cb-fg)] uppercase">
                    Plantillas de Batalla Preconfiguradas
                  </h3>
                </div>
                <span className="text-xs text-[color:var(--cb-mut)]">Selecciona para cargar al instante</span>
              </div>

              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {DEFAULT_BATTLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className="flex flex-col items-start rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3 text-left transition-all hover:border-[color:var(--cb-mut)] active:scale-[0.98]"
                  >
                    <span className="text-xs font-black text-[color:var(--cb-fg)]">{preset.title}</span>
                    <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-[color:var(--cb-mut)]">
                      <span className="text-cyan-400">{preset.optionA.label}</span>
                      <span className="text-slate-500">vs</span>
                      <span className="text-rose-400">{preset.optionB.label}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Guía de Comandos para Moderadores y Streamer */}
            <div className="rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5">
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-cyan-400" />
                  <h3 className="cab-caps text-xs font-black tracking-wider text-[color:var(--cb-fg)] uppercase">
                    Comandos de Chat para Mods y Streamer
                  </h3>
                </div>
                <span className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  <Shield className="h-3 w-3" />
                  MODS & BROADCASTER
                </span>
              </div>

              <p className="mt-3 text-xs text-[color:var(--cb-mut)]">
                Los moderadores pueden activar, personalizar y detener encuestas en directo desde el chat de Twitch. El sistema preavisa por voz y en el HUD de OBS:
              </p>

              <div className="mt-3 space-y-2 text-xs">
                <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center justify-between">
                    <code className="font-mono font-bold text-cyan-300">
                      !poll "Pregunta" "Opción A" "Opción B" [tiempo]
                    </code>
                    <span className="text-[10px] font-bold text-[color:var(--cb-mut)]">Personalizado</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[color:var(--cb-mut)]">
                    Ej: <span className="text-[color:var(--cb-fg)] font-mono">!poll "¿Qué cenamos?" "Pizza" "Sushi" 45</span> (crea la votación por 45 seg).
                  </p>
                </div>

                <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center justify-between">
                    <code className="font-mono font-bold text-cyan-300">
                      !poll Opción A | Opción B | [tiempo]
                    </code>
                    <span className="text-[10px] font-bold text-[color:var(--cb-mut)]">Sintaxis Barra</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[color:var(--cb-mut)]">
                    Ej: <span className="text-[color:var(--cb-fg)] font-mono">!poll Valorant | Minecraft | 60</span> o <span className="text-[color:var(--cb-fg)] font-mono">!poll Gatos vs Perros 30</span>
                  </p>
                </div>

                <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center justify-between">
                    <code className="font-mono font-bold text-amber-300">
                      !poll preset gamer [tiempo]
                    </code>
                    <span className="text-[10px] font-bold text-[color:var(--cb-mut)]">Plantillas</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[color:var(--cb-mut)]">
                    Carga presets rápidos: <span className="text-[color:var(--cb-fg)] font-mono">gamer</span>, <span className="text-[color:var(--cb-fg)] font-mono">castigos</span>, <span className="text-[color:var(--cb-fg)] font-mono">comida</span> o <span className="text-[color:var(--cb-fg)] font-mono">juicio</span>.
                  </p>
                </div>

                <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2.5">
                  <div className="flex items-center justify-between">
                    <code className="font-mono font-bold text-emerald-300">
                      !poll [tiempo] · !poll stop
                    </code>
                    <span className="text-[10px] font-bold text-[color:var(--cb-mut)]">Control Rápido</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[color:var(--cb-mut)]">
                    <span className="text-[color:var(--cb-fg)] font-mono">!poll 45</span> inicia la encuesta actual por 45s. <span className="text-[color:var(--cb-fg)] font-mono">!poll stop</span> la finaliza antes de tiempo.
                  </p>
                </div>

                <div className="rounded-md border border-cyan-500/20 bg-cyan-950/20 p-2.5">
                  <div className="flex items-center gap-1.5 text-cyan-300 font-bold text-[11px]">
                    <Clock className="h-3.5 w-3.5" />
                    <span>¿Cómo vota el chat?</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[color:var(--cb-fg)]">
                    Los espectadores solo tienen que escribir <span className="font-mono font-black text-cyan-400">1</span> o <span className="font-mono font-black text-rose-400">2</span> en el chat (también admite <span className="font-mono">!1</span>, <span className="font-mono">!2</span>, <span className="font-mono">!voto 1</span>).
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Panel Derecho: Locutor Emocional TTS & OBS (5 columnas) */}
          <div className="flex flex-col gap-6 lg:col-span-5">
            {/* Tarjeta de Locución Emocional TTS */}
            <div className="rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5">
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-rose-400" />
                  <h3 className="cab-caps text-xs font-black tracking-wider text-[color:var(--cb-fg)] uppercase">
                    Locutor TTS con Emociones Predefinidas
                  </h3>
                </div>
                <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                  FISH AUDIO READY
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs text-[color:var(--cb-mut)]">Voz configurada en TTS:</span>
                  <span className="rounded bg-rose-500/20 px-2 py-0.5 font-mono text-xs font-bold text-rose-300">
                    {activeVoiceName}
                  </span>
                </div>
                <a
                  href="#tts"
                  className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 hover:underline"
                >
                  Cambiar en TTS →
                </a>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                El locutor anuncia eventos clave usando tags emocionales predefinidos. Haz clic en "Escuchar" para comprobar cómo modula la voz:
              </p>

              <div className="mt-4 flex flex-col gap-3">
                {/* 0. Preaviso de Moderador */}
                <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
                      [emocionado] PREAVISO DE MODERADOR
                    </span>
                    <button
                      type="button"
                      disabled={isSpeakingEmotion !== null}
                      onClick={() => {
                        setIsSpeakingEmotion('mod_announce');
                        announceModPollStarted(
                          {
                            modName: 'AlexMod',
                            title: '¿Qué jugamos hoy?',
                            optionALabel: 'Valorant',
                            optionBLabel: 'Minecraft',
                            durationSec: 45,
                            volume: 0.85,
                          },
                          undefined,
                          () => setIsSpeakingEmotion(null)
                        );
                      }}
                      className="cab-btn !h-7 !px-2.5 !text-xs font-bold active:scale-[0.97]"
                    >
                      <Volume2 className="h-3 w-3" />
                      <span>{isSpeakingEmotion === 'mod_announce' ? 'Hablando...' : 'Escuchar'}</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-[color:var(--cb-fg)] font-medium">
                    "¡Atención chat! El moderador AlexMod ha iniciado una votación: ¿Qué jugamos hoy? Para votar por Valorant, escribe 1 en el chat. Para votar por Minecraft, escribe 2..."
                  </p>
                </div>

                {/* 1. Cambio de Líder */}
                <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                      [emocionado] CAMBIO DE LÍDER
                    </span>
                    <button
                      type="button"
                      disabled={isSpeakingEmotion !== null}
                      onClick={() =>
                        handleTestEmotionVoice(
                          'lead',
                          '¡Atención! ¡La opción Azul ha tomado la delantera en la votación!',
                          '[emocionado]'
                        )
                      }
                      className="cab-btn !h-7 !px-2.5 !text-xs font-bold active:scale-[0.97]"
                    >
                      <Volume2 className="h-3 w-3" />
                      <span>{isSpeakingEmotion === 'lead' ? 'Hablando...' : 'Escuchar'}</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-[color:var(--cb-fg)] font-medium">
                    "¡Atención! ¡La opción Azul ha tomado la delantera en la votación!"
                  </p>
                </div>

                {/* 2. Cuenta Regresiva Final */}
                <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      [susurro] CUENTA REGRESIVA (10s)
                    </span>
                    <button
                      type="button"
                      disabled={isSpeakingEmotion !== null}
                      onClick={() =>
                        handleTestEmotionVoice(
                          'countdown',
                          'Quedan solo 10 segundos, ¡emitan sus votos en el chat!',
                          '[susurro]'
                        )
                      }
                      className="cab-btn !h-7 !px-2.5 !text-xs font-bold active:scale-[0.97]"
                    >
                      <Volume2 className="h-3 w-3" />
                      <span>{isSpeakingEmotion === 'countdown' ? 'Hablando...' : 'Escuchar'}</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-[color:var(--cb-fg)] font-medium">
                    "Quedan solo 10 segundos, ¡emitan sus votos en el chat!"
                  </p>
                </div>

                {/* 3. Victoria Triunfal */}
                <div className="rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                      [triunfal] ANUNCIO DE GANADOR
                    </span>
                    <button
                      type="button"
                      disabled={isSpeakingEmotion !== null}
                      onClick={() =>
                        handleTestEmotionVoice(
                          'winner',
                          '¡Tiempo finalizado! La opción ganadora indiscutible es GTA RP con 68 por ciento de los votos.',
                          '[triunfal]'
                        )
                      }
                      className="cab-btn !h-7 !px-2.5 !text-xs font-bold active:scale-[0.97]"
                    >
                      <Volume2 className="h-3 w-3" />
                      <span>{isSpeakingEmotion === 'winner' ? 'Hablando...' : 'Escuchar'}</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-[color:var(--cb-fg)] font-medium">
                    "¡Tiempo finalizado! La opción ganadora indiscutible es..."
                  </p>
                </div>
              </div>
            </div>

            {/* Panel de Integración con OBS Studio */}
            <div className="rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5">
              <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] pb-3">
                <div className="flex items-center gap-2">
                  <Tv className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
                  <h3 className="cab-caps text-xs font-black tracking-wider text-[color:var(--cb-fg)] uppercase">
                    Fuente de Navegador OBS
                  </h3>
                </div>
                <span className="text-[11px] font-bold text-emerald-400">1920 × 1080</span>
              </div>

              <p className="mt-2 text-xs text-[color:var(--cb-mut)]">
                Pega este enlace en una Fuente Navegador en OBS Studio para que las batallas se rendericen automáticamente sobre tu transmisión con el tema elegido:
              </p>

              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  value={obsWidgetUrl}
                  className="cab-inp flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(obsWidgetUrl);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 2000);
                  }}
                  className="cab-btn2 !h-9 !px-3 !text-xs font-bold active:scale-[0.97]"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedUrl ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
