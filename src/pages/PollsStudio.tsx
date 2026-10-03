/**
 * src/pages/PollsStudio.tsx
 *
 * Módulo 7: Estudio de Batallas & Encuestas en Vivo (Polls & Versus Studio).
 * Implementación con estética broadcast Impeccable, física fluida GSAP,
 * sincronización reactiva hacia OBS mediante BroadcastChannel y locución TTS
 * modulada con etiquetas emocionales de IA ([emocionado], [susurro], [triunfal]).
 */

import React, { useState } from 'react';
import {
  Check,
  Copy,
  Flame,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Swords,
  Trophy,
  Tv,
  Volume2,
  Zap,
} from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { DEFAULT_BATTLE_PRESETS, PollBattlePreset } from '../types/polls';
import { usePollsSettings } from '../hooks/usePollsSettings';
import { BattleBarView } from '../components/polls/BattleBarView';
import { speakPollEmotionCue } from '../utils/pollsAudio';
import { loadSettings, PRESET_VOICES } from '../types/settings';

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
  } = usePollsSettings();

  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [isSpeakingEmotion, setIsSpeakingEmotion] = useState<string | null>(null);
  const [simulationNotice, setSimulationNotice] = useState<string | null>(null);

  const ttsSettings = loadSettings();
  const activeVoiceName = PRESET_VOICES.find((v) => v.id === ttsSettings.referenceId)?.name || 'Voz Personalizada';

  // Simular ráfaga masiva de votos
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
    speakPollEmotionCue(
      text,
      emotionTag,
      undefined,
      () => setIsSpeakingEmotion(null)
    );
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const obsWidgetUrl = `${baseUrl}/#widget?app=polls&channel=${settings.channel}`;

  return (
    <div className="cab min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-6">
        {/* Barra superior de navegación de la Suite */}
        <SuiteNav
          currentApp="encuestas"
          channel={settings.channel}
          saved={saved}
          tourAvailable={false}
        />

        {/* Cabecera del Módulo con estilo Impeccable */}
        <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-2 text-cyan-400">
              <Swords className="h-4 w-4" />
              <span className="cab-caps text-xs font-black tracking-widest uppercase">
                MÓDULO 7 · MESA DE CONTROL BROADCAST
              </span>
            </div>
            <h1 className="cab-caps mt-1 text-3xl font-extrabold tracking-tight text-white">
              Batallas & Encuestas Cinemáticas en Vivo
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-slate-400">
              Enfrentamiento en tiempo real con barras líquidas reactivas GSAP, ticks de audio por frecuencia y locución con modulación emocional de IA.
            </p>
          </div>

          {/* Estado de sincronización / canal */}
          <div className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/90 px-3.5 py-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold text-slate-300">
              SINCRONIZADO CON OBS
            </span>
          </div>
        </div>

        {/* Notificación temporal de simulación */}
        {simulationNotice && (
          <div className="flex items-center gap-2 rounded border border-cyan-500/40 bg-cyan-950/40 px-3.5 py-2 text-xs font-bold text-cyan-300 animate-in fade-in">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span>{simulationNotice}</span>
          </div>
        )}

        {/* Monitor 16:9 de Emisión OBS (Stage Central) */}
        <section
          className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-slate-800 bg-slate-950 p-6 md:p-10 shadow-2xl"
          style={{ minHeight: 380 }}
        >
          {/* Grilla sutil de fondo broadcast */}
          <div
            className="pointer-events-none absolute inset-0 opacity-15"
            style={{
              backgroundImage:
                'linear-gradient(to right, #334155 1px, transparent 1px), linear-gradient(to bottom, #334155 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />

          {/* Badge superior del monitor */}
          <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded bg-slate-900/90 px-2.5 py-1 text-[10px] font-black tracking-wider text-slate-400 border border-slate-800">
            <Tv className="h-3 w-3 text-cyan-400" />
            <span>16:9 OBS LIVE MONITOR</span>
          </div>

          {/* Componente de Batalla Renderizado en Vivo */}
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
        </section>

        {/* MESA DE CONTROL Y SIMULACIÓN INTERACTIVA */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Panel Izquierdo: Simulador de Votación & Batalla (7 columnas) */}
          <div className="flex flex-col gap-6 lg:col-span-7">
            {/* Simulador de Votos Directos */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-black tracking-wider text-white uppercase">
                    Simulador Interactivo de Votación
                  </h3>
                </div>
                <span className="text-xs text-slate-400">Pulsa para probar físicas y sonido</span>
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
                  <span className="mt-1 text-base font-black text-white">{settings.options[0].label}</span>
                  <span className="mt-2 rounded bg-cyan-500 px-3 py-1 font-mono text-xs font-black text-slate-950 shadow">
                    +1 Voto (!voto 1)
                  </span>
                </button>

                {/* Opción 2 Voto */}
                <button
                  type="button"
                  onClick={() => castVote(1, 'AdminStudio')}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-rose-500/40 bg-rose-950/30 p-4 transition-all hover:border-rose-400 hover:bg-rose-900/40 active:scale-[0.97]"
                >
                  <span className="text-xs font-bold text-rose-400 uppercase">Votar Opción 2</span>
                  <span className="mt-1 text-base font-black text-white">{settings.options[1].label}</span>
                  <span className="mt-2 rounded bg-rose-500 px-3 py-1 font-mono text-xs font-black text-white shadow">
                    +1 Voto (!voto 2)
                  </span>
                </button>
              </div>

              {/* Acciones de Flujo: Ráfaga, Iniciar, Pausar, Reiniciar */}
              <div className="mt-4 flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleBurstVotes}
                  className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3.5 py-2 text-xs font-bold text-amber-300 hover:bg-amber-900/40 active:scale-[0.97]"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span>Ráfaga de Votos (+Aleatorio)</span>
                </button>

                <button
                  type="button"
                  onClick={() => (isActive ? pauseBattle() : startBattle())}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all active:scale-[0.97] ${
                    isActive
                      ? 'border border-amber-500 bg-amber-500 text-slate-950'
                      : 'border border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-500'
                  }`}
                >
                  <Play className={`h-3.5 w-3.5 fill-current ${isActive ? 'rotate-90' : ''}`} />
                  <span>{isActive ? 'Pausar Temporizador' : 'Iniciar Batalla'}</span>
                </button>

                <button
                  type="button"
                  onClick={resetBattle}
                  className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 active:scale-[0.97]"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                  <span>Reiniciar Votos</span>
                </button>
              </div>
            </div>

            {/* Presets Listos para Usar */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-black tracking-wider text-white uppercase">
                    Plantillas de Batalla Preconfiguradas
                  </h3>
                </div>
                <span className="text-xs text-slate-400">Selecciona para cargar al instante</span>
              </div>

              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {DEFAULT_BATTLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className="flex flex-col items-start rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-left transition-all hover:border-slate-700 hover:bg-slate-900 active:scale-[0.98]"
                  >
                    <span className="text-xs font-black text-white">{preset.title}</span>
                    <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-slate-400">
                      <span className="text-cyan-400">{preset.optionA.label}</span>
                      <span className="text-slate-500">vs</span>
                      <span className="text-rose-400">{preset.optionB.label}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Panel Derecho: Locutor Emocional TTS & Audio (5 columnas) */}
          <div className="flex flex-col gap-6 lg:col-span-5">
            {/* Tarjeta de Locución Emocional TTS */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-rose-400" />
                  <h3 className="text-sm font-black tracking-wider text-white uppercase">
                    Locutor TTS con Emociones Predefinidas
                  </h3>
                </div>
                <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                  FISH AUDIO READY
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs text-slate-400">Voz configurada en TTS:</span>
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

              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                El locutor anuncia eventos clave usando tags emocionales predefinidos. Haz clic en "Escuchar" para comprobar cómo modula la voz:
              </p>

              <div className="mt-4 flex flex-col gap-3">
                {/* 1. Cambio de Líder */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
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
                      className="flex items-center gap-1.5 rounded bg-cyan-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-cyan-400 active:scale-[0.97]"
                    >
                      <Volume2 className="h-3 w-3" />
                      <span>{isSpeakingEmotion === 'lead' ? 'Hablando...' : 'Escuchar'}</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-300 font-medium">
                    "¡Atención! ¡La opción Azul ha tomado la delantera en la votación!"
                  </p>
                </div>

                {/* 2. Cuenta Regresiva Final */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
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
                      className="flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 active:scale-[0.97]"
                    >
                      <Volume2 className="h-3 w-3" />
                      <span>{isSpeakingEmotion === 'countdown' ? 'Hablando...' : 'Escuchar'}</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-300 font-medium">
                    "Quedan solo 10 segundos, ¡emitan sus votos en el chat!"
                  </p>
                </div>

                {/* 3. Victoria Triunfal */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
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
                      className="flex items-center gap-1.5 rounded bg-rose-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-400 active:scale-[0.97]"
                    >
                      <Volume2 className="h-3 w-3" />
                      <span>{isSpeakingEmotion === 'winner' ? 'Hablando...' : 'Escuchar'}</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-300 font-medium">
                    "¡Tiempo finalizado! La opción ganadora indiscutible es..."
                  </p>
                </div>
              </div>
            </div>

            {/* Panel de Integración con OBS Studio */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Tv className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
                  <h3 className="text-sm font-black tracking-wider text-white uppercase">
                    Fuente de Navegador OBS
                  </h3>
                </div>
                <span className="text-[11px] font-bold text-emerald-400">1920 × 1080</span>
              </div>

              <p className="mt-2 text-xs text-slate-400">
                Pega este enlace en una Fuente Navegador en OBS Studio para que las batallas se rendericen automáticamente sobre tu transmisión:
              </p>

              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  value={obsWidgetUrl}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-300"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(obsWidgetUrl);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 2000);
                  }}
                  className="flex items-center gap-1 rounded bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700"
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
