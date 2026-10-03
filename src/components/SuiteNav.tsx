/**
 * src/components/SuiteNav.tsx
 *
 * Barra de navegación principal de Lalo Stream Suite.
 * Conecta las herramientas de la suite (Catálogo, TTS, Alertas) y proporciona
 * acceso rápido al estado de transmisión, copia de URLs para OBS y tema.
 */

import React, { useState, useRef } from 'react';
import gsap from 'gsap';
import {
  BellRing,
  Bot,
  Check,
  Coins,
  Copy,
  Gamepad2,
  Layers,
  LayoutGrid,
  Mic,
  RefreshCw,
  Swords,
  Target,
  Tv,
} from 'lucide-react';
import { ThemeSwitch } from './ThemeSwitch';
import { buildSuiteWidgetUrl, WidgetAppType } from '../utils/widgetUrl';
import { loadSettings } from '../types/settings';
import { postBus } from '../utils/bus';
import { playAlertAudio } from '../utils/alertsAudio';
import { ObsSyncNotice } from './ObsSyncNotice';

export type SuiteApp =
  | 'catalogo'
  | 'tts'
  | 'control'
  | 'alertas'
  | 'recompensas'
  | 'twitchio'
  | 'metas'
  | 'ruleta'
  | 'encuestas';

interface SuiteNavProps {
  currentApp: SuiteApp;
  channel?: string;
  saved?: boolean;
  onOpenTour?: () => void;
  tourAvailable?: boolean;
}

export const SuiteNav: React.FC<SuiteNavProps> = ({
  currentApp,
  channel = 'laloplay_',
  saved = true,
  onOpenTour,
  tourAvailable = false,
}) => {
  const [obsMenuOpen, setObsMenuOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [syncingObs, setSyncingObs] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [activeNotice, setActiveNotice] = useState<{ appType: string; url: string } | null>(null);
  const syncBtnRef = useRef<HTMLButtonElement | null>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const getWidgetUrl = (mode: WidgetAppType) => {
    const ttsSettings = loadSettings();
    return buildSuiteWidgetUrl(baseUrl, mode, channel || ttsSettings.channel, ttsSettings);
  };

  const handleCopy = (mode: WidgetAppType) => {
    const url = getWidgetUrl(mode);
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedKey(mode);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Disparador de sincronización en vivo y recarga de enlaces de OBS
  const triggerObsSync = async (specificApp?: WidgetAppType) => {
    if (syncingObs) return;
    setSyncingObs(true);
    setSyncSuccess(false);

    const ttsSettings = loadSettings();
    const targetApp: WidgetAppType =
      specificApp ||
      (currentApp === 'ruleta'
        ? 'roulette'
        : currentApp === 'alertas'
        ? 'alerts'
        : currentApp === 'metas'
        ? 'goals'
        : currentApp === 'encuestas'
        ? 'polls'
        : currentApp === 'tts'
        ? 'tts'
        : 'all');

    const activeUrl = buildSuiteWidgetUrl(baseUrl, targetApp, channel || ttsSettings.channel, ttsSettings);

    // 1. Emitir señal de recarga inmediata vía BroadcastChannel
    postBus({ type: 'FORCE_RELOAD' });
    postBus({
      type: 'SETTINGS_UPDATE',
      settings: { ...ttsSettings, channel: channel || ttsSettings.channel },
    });

    // 2. Notificar al backend / serverless para que el poller de OBS CEF lo detecte
    try {
      await fetch('/api/obs/reload', { method: 'POST' }).catch(() =>
        fetch('/api/version', { method: 'POST' })
      );
    } catch {
      // Continuar si la red está en local o desconectada
    }

    // 3. Copiar enlace actualizado al portapapeles para conveniencia del streamer
    try {
      await navigator.clipboard.writeText(activeUrl);
    } catch {
      // Portapapeles no disponible
    }

    // Micro-retraso táctil perceptivo (Emil Kowalski speed perception: 220ms)
    await new Promise((resolve) => setTimeout(resolve, 220));

    setSyncingObs(false);
    setSyncSuccess(true);

    // 4. Feedback acústico sintetizado (Web Audio API synth-bell)
    playAlertAudio('synth-bell', 0.45);

    // 5. Micro-rebote de inercia físico con GSAP en el botón
    if (syncBtnRef.current) {
      gsap.fromTo(
        syncBtnRef.current,
        { scale: 0.94 },
        { scale: 1, duration: 0.35, ease: 'back.out(2.2)' }
      );
    }

    // 6. Desplegar aviso cinematográfico HUD optimizado con GSAP
    setActiveNotice({
      appType: targetApp.toUpperCase(),
      url: activeUrl,
    });

    setTimeout(() => {
      setSyncSuccess(false);
    }, 2800);
  };

  const isTTSActive = currentApp === 'tts' || currentApp === 'control';

  return (
    <header className="border-b border-[color:var(--cb-line)] pb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {/* Marca de la Suite & Tally */}
        <div className="flex items-center gap-3">
          <a
            href="#dashboard"
            className="group flex items-center gap-2 text-inherit no-underline transition-opacity hover:opacity-90 active:scale-[0.98]"
            title="Ir al Dashboard de la Suite"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--ui,#9146ff)] font-mono text-sm font-black text-[color:var(--ui-ink,#fff)] shadow-sm">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <span className="cab-caps block text-xs tracking-wider text-[color:var(--cb-mut)]">
                LALO STREAM SUITE
              </span>
              <span className="cab-caps text-base font-extrabold tracking-tight text-[color:var(--cb-fg)]">
                ESTACIÓN CENTRAL
              </span>
            </div>
          </a>

          <div className="hidden h-5 w-[1px] bg-[color:var(--cb-line)] sm:block" />

          {/* LED Tally indicador de emisión */}
          <div className="hidden items-center gap-1.5 rounded-full border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2.5 py-1 sm:inline-flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]">
              ESTUDIO ACTIVO
            </span>
          </div>
        </div>

        {/* Selector de Aplicaciones (Segmented Switcher de Cabina) */}
        <nav
          className="cab-seg flex items-center p-1"
          aria-label="Aplicaciones de la Suite"
          data-tour="nav"
        >
          {/* 1. Dashboard Central */}
          <a
            href="#dashboard"
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider no-underline transition-all active:scale-[0.97] ${
              currentApp === 'catalogo'
                ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)] shadow-sm'
                : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
            }`}
            aria-current={currentApp === 'catalogo' ? 'page' : undefined}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </a>

          {/* 2. TTS */}
          <a
            href="#tts"
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider no-underline transition-colors ${
              isTTSActive
                ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)] shadow-sm'
                : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
            }`}
            aria-current={isTTSActive ? 'page' : undefined}
          >
            <Mic className="h-3.5 w-3.5" />
            <span>TTS</span>
          </a>

          {/* 3. Alertas */}
          <a
            href="#alertas"
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider no-underline transition-colors ${
              currentApp === 'alertas'
                ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)] shadow-sm'
                : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
            }`}
            aria-current={currentApp === 'alertas' ? 'page' : undefined}
          >
            <BellRing className="h-3.5 w-3.5" />
            <span>Alertas</span>
          </a>

          {/* 4. Recompensas & FX */}
          <a
            href="#recompensas"
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider no-underline transition-colors ${
              currentApp === 'recompensas'
                ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)] shadow-sm'
                : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
            }`}
            aria-current={currentApp === 'recompensas' ? 'page' : undefined}
          >
            <Coins className="h-3.5 w-3.5 text-amber-400" />
            <span>Recompensas</span>
            <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-black text-amber-300">
              NUEVO
            </span>
          </a>

          {/* 5. TwitchIO Bot */}
          <a
            href="#twitchio"
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider no-underline transition-colors ${
              currentApp === 'twitchio'
                ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)] shadow-sm'
                : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
            }`}
            aria-current={currentApp === 'twitchio' ? 'page' : undefined}
          >
            <Bot className="h-3.5 w-3.5 text-[color:var(--ui,#9146ff)]" />
            <span>Bot</span>
            <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-1 py-0.2 text-[9px] font-bold text-emerald-400">
              TwitchIO
            </span>
          </a>

          {/* 6. Metas Comunitarias & Marcadores */}
          <a
            href="#metas"
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider no-underline transition-colors ${
              currentApp === 'metas'
                ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)] shadow-sm'
                : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
            }`}
            aria-current={currentApp === 'metas' ? 'page' : undefined}
          >
            <Target className="h-3.5 w-3.5 text-rose-400" />
            <span>Metas</span>
            <span className="rounded bg-rose-500/20 px-1 py-0.2 text-[9px] font-black text-rose-300">
              FX
            </span>
          </a>

          {/* 7. Ruleta de Castigos & Retos */}
          <a
            href="#ruleta"
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider no-underline transition-colors ${
              currentApp === 'ruleta'
                ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)] shadow-sm'
                : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
            }`}
            aria-current={currentApp === 'ruleta' ? 'page' : undefined}
          >
            <Gamepad2 className="h-3.5 w-3.5 text-rose-500" />
            <span>Ruleta</span>
            <span className="rounded bg-rose-500/20 px-1 py-0.2 text-[9px] font-black text-rose-400">
              NUEVO
            </span>
          </a>

          {/* 8. Batallas & Encuestas en Vivo */}
          <a
            href="#encuestas"
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider no-underline transition-colors ${
              currentApp === 'encuestas'
                ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)] shadow-sm'
                : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
            }`}
            aria-current={currentApp === 'encuestas' ? 'page' : undefined}
          >
            <Swords className="h-3.5 w-3.5 text-cyan-400" />
            <span>Batallas</span>
            <span className="rounded bg-cyan-500/20 px-1 py-0.2 text-[9px] font-black text-cyan-300">
              PREVIEW
            </span>
          </a>
        </nav>

        {/* Acciones de la derecha: Actualizar OBS, Widgets OBS, Canal, Guía, Tema */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* Canal actual */}
          <span className="cab-caps hidden text-xs text-[color:var(--cb-mut)] lg:inline-block">
            Canal:{' '}
            <b className="cab-mono text-[color:var(--cb-fg)]">
              {channel || 'sin canal'}
            </b>
          </span>

          {/* BOTÓN PRINCIPAL SUPERIOR: ACTUALIZAR OBS (Craft Impeccable & Emil Kowalski) */}
          <button
            ref={syncBtnRef}
            type="button"
            className={`group relative flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-bold select-none transition-all duration-150 active:scale-[0.96] active:translate-y-[0.5px] ${
              syncSuccess
                ? 'border border-emerald-400/80 bg-gradient-to-b from-emerald-950/80 to-slate-950 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.45),inset_0_1px_0_rgba(255,255,255,0.25)]'
                : syncingObs
                ? 'border border-cyan-400/80 bg-cyan-950/80 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                : 'border border-cyan-500/40 bg-gradient-to-b from-cyan-950/40 via-slate-950/80 to-slate-950 text-cyan-200 hover:border-cyan-400 hover:text-white hover:shadow-[0_0_14px_rgba(6,182,212,0.25),inset_0_1px_0_rgba(255,255,255,0.18)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_8px_rgba(0,0,0,0.5)]'
            }`}
            onClick={() => triggerObsSync()}
            disabled={syncingObs}
            title="Sincronizar y recargar overlays en OBS Studio (Actualiza parámetros y copia enlace)"
            data-tour="obs-sync"
          >
            {/* Esquinas angulares micro-hardware */}
            <div
              className={`pointer-events-none absolute -top-px -left-px h-1.5 w-1.5 border-t border-l rounded-tl transition-colors ${
                syncSuccess ? 'border-emerald-400' : 'border-cyan-400'
              }`}
            />
            <div
              className={`pointer-events-none absolute -bottom-px -right-px h-1.5 w-1.5 border-b border-r rounded-br transition-colors ${
                syncSuccess ? 'border-emerald-400' : 'border-cyan-400'
              }`}
            />

            {/* Icono con rotación y morphing fluido */}
            {syncSuccess ? (
              <Check className="h-3.5 w-3.5 text-emerald-400 stroke-[2.5] transition-transform animate-in zoom-in-75 duration-200" />
            ) : (
              <RefreshCw
                className={`h-3.5 w-3.5 transition-transform duration-300 ${
                  syncingObs
                    ? 'animate-spin text-cyan-300'
                    : 'text-cyan-400 group-hover:rotate-90'
                }`}
              />
            )}

            {/* Texto con morphing de estado */}
            <span className="tracking-tight">
              {syncingObs
                ? 'Sincronizando...'
                : syncSuccess
                ? '¡OBS Sincronizado!'
                : 'Actualizar OBS'}
            </span>

            {/* LED Tally indicador de estado en vivo */}
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  syncSuccess
                    ? 'bg-emerald-400 animate-ping'
                    : syncingObs
                    ? 'bg-cyan-400 animate-ping'
                    : 'bg-cyan-500/50'
                }`}
              />
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  syncSuccess
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : syncingObs
                    ? 'bg-cyan-300 shadow-[0_0_8px_#67e8f9]'
                    : 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]'
                }`}
              />
            </span>
          </button>

          {/* Menú rápido OBS Sources */}
          <div className="relative" data-tour="obs-menu">
            <button
              type="button"
              className="cab-btn2 !h-8 !px-2.5 !text-xs font-bold"
              onClick={() => setObsMenuOpen(!obsMenuOpen)}
              title="Copiar fuentes de navegador para OBS Studio"
            >
              <Tv className="h-3.5 w-3.5 text-[color:var(--ui,#9146ff)]" />
              <span>Widgets OBS</span>
            </button>

            {obsMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setObsMenuOpen(false)}
                />
                <div
                  className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3 shadow-2xl backdrop-blur-xl"
                  style={{
                    animation: 'fadeIn 0.15s cubic-bezier(0.23, 1, 0.32, 1)',
                  }}
                >
                  <div className="mb-2.5 flex items-center justify-between border-b border-[color:var(--cb-line)] pb-1.5">
                    <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]">
                      FUENTES DE NAVEGADOR (OBS STUDIO)
                    </span>
                    <Tv className="h-3.5 w-3.5 text-[color:var(--cb-mut)]" />
                  </div>

                  {/* Tarjeta de Acción Rápida: Sincronización en Vivo */}
                  <div className="mb-2.5 rounded-lg border border-cyan-500/30 bg-cyan-950/40 p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
                        <RefreshCw className={`h-3 w-3 ${syncingObs ? 'animate-spin' : ''}`} />
                        Sincronización en Vivo
                      </span>
                      <span className="text-[9px] font-extrabold uppercase tracking-wider rounded bg-cyan-500/20 px-1 py-0.2 text-cyan-300">
                        1-Click
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 mb-2 leading-relaxed">
                      ¿Cambiaste voz, volumen o diseño? Envía los cambios al enlace que tiene OBS sin interrumpir el stream.
                    </p>
                    <button
                      type="button"
                      className="w-full flex items-center justify-center gap-2 rounded bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] px-2.5 py-1.5 text-xs font-black text-slate-950 transition-all shadow"
                      onClick={() => triggerObsSync()}
                      disabled={syncingObs}
                    >
                      <RefreshCw className={`h-3 w-3 ${syncingObs ? 'animate-spin' : ''}`} />
                      <span>{syncingObs ? 'Enviando a OBS...' : syncSuccess ? '¡Actualizado en OBS!' : 'Enviar Actualización a OBS'}</span>
                    </button>
                  </div>

                  {/* Listado de Overlays Configurados */}
                  <div className="grid gap-1.5 max-h-80 overflow-y-auto pr-1">
                    {/* Opción 1: TTS Widget */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-[color:var(--cb-fg)] truncate">
                          Overlay TTS
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)] truncate">
                          Lectura con voz configurada
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className="cab-btn2 !h-7 !px-2 !text-[11px]"
                          onClick={() => handleCopy('tts')}
                          title="Copiar enlace con parámetros completos"
                        >
                          {copiedKey === 'tts' ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedKey === 'tts' ? 'Copiado' : 'Copiar'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Opción 2: Ruleta & Castigos */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-[color:var(--cb-fg)] truncate">
                          Overlay Ruleta
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)] truncate">
                          Retos, castigos y ruleta 3D
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className="cab-btn2 !h-7 !px-2 !text-[11px]"
                          onClick={() => handleCopy('roulette')}
                          title="Copiar enlace del overlay de ruleta"
                        >
                          {copiedKey === 'roulette' ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedKey === 'roulette' ? 'Copiado' : 'Copiar'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Opción 3: Alertas Widget */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-[color:var(--cb-fg)] truncate">
                          Overlay Alertas
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)] truncate">
                          Follows, subs, bits, raids
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className="cab-btn2 !h-7 !px-2 !text-[11px]"
                          onClick={() => handleCopy('alerts')}
                          title="Copiar enlace de alertas"
                        >
                          {copiedKey === 'alerts' ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedKey === 'alerts' ? 'Copiado' : 'Copiar'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Opción 4: Metas Comunitarias */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-[color:var(--cb-fg)] truncate">
                          Overlay Metas
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)] truncate">
                          Sub goals, follow goals
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className="cab-btn2 !h-7 !px-2 !text-[11px]"
                          onClick={() => handleCopy('goals')}
                          title="Copiar enlace de metas"
                        >
                          {copiedKey === 'goals' ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedKey === 'goals' ? 'Copiado' : 'Copiar'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Opción 5: Batallas Esports */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-[color:var(--cb-fg)] truncate">
                          Overlay Batallas
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)] truncate">
                          Encuestas versus esports
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className="cab-btn2 !h-7 !px-2 !text-[11px]"
                          onClick={() => handleCopy('polls')}
                          title="Copiar enlace de batallas"
                        >
                          {copiedKey === 'polls' ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedKey === 'polls' ? 'Copiado' : 'Copiar'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Opción 6: Todo-en-uno */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-[color:var(--cb-fg)] truncate">
                          Todo-en-Uno (Suite)
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)] truncate">
                          TTS + Alertas + Ruleta en 1 fuente
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className="cab-btn2 !h-7 !px-2 !text-[11px]"
                          onClick={() => handleCopy('all')}
                          title="Copiar enlace todo-en-uno"
                        >
                          {copiedKey === 'all' ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedKey === 'all' ? 'Copiado' : 'Copiar'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <p className="mt-2.5 text-center text-[10px] text-[color:var(--cb-mut)] leading-tight">
                    Resolución recomendada en OBS: 1920 × 1080.<br />
                    En OBS, activa «Actualizar el navegador al activar escena».
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Subnavegación si TTS está activo: Ajustes / Control */}
          {isTTSActive && (
            <div className="cab-seg hidden items-center p-0.5 sm:inline-flex">
              <a
                href="#ajustes"
                className={`px-2 py-1 text-[11px] font-bold uppercase no-underline transition-colors ${
                  currentApp === 'tts'
                    ? 'rounded bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)]'
                    : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
                }`}
              >
                Ajustes
              </a>
              <a
                href="#control"
                className={`px-2 py-1 text-[11px] font-bold uppercase no-underline transition-colors ${
                  currentApp === 'control'
                    ? 'rounded bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)]'
                    : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
                }`}
              >
                Control
              </a>
            </div>
          )}

          {/* Theme switch */}
          <ThemeSwitch />

          {/* Botón de Guía (si está disponible) */}
          {tourAvailable && onOpenTour && (
            <button
              type="button"
              className="cab-btn2 !h-8 !px-2.5 !text-xs font-bold"
              onClick={onOpenTour}
            >
              Guía
            </button>
          )}

          {/* Estado de guardado */}
          <span
            className="cab-caps hidden text-[11px] text-[color:var(--cb-mut)] xl:inline-block"
            role="status"
          >
            {saved ? 'Cambios guardados' : 'Guardando...'}
          </span>
        </div>
      </div>

      {/* Aviso HUD de confirmación cinemático optimizado con GSAP */}
      {activeNotice && (
        <ObsSyncNotice
          appType={activeNotice.appType}
          url={activeNotice.url}
          onDismiss={() => setActiveNotice(null)}
        />
      )}
    </header>
  );
};
