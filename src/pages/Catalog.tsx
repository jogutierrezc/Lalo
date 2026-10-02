/**
 * src/pages/Catalog.tsx
 *
 * Catálogo central de aplicaciones de Lalo Stream Suite.
 * Diseñado con estética Cabina broadcast (mesa de mezclas de hardware),
 * animaciones staggered con GSAP (useGSAP), micro-interacciones pulidas de
 * acuerdo a los principios de Emil Kowalski y modo Operate de Impeccable.
 */

import React, { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  BellRing,
  Bot,
  Check,
  Coins,
  Copy,
  Gamepad2,
  LayoutGrid,
  Mic,
  Play,
  Settings,
  Sliders,
  Sparkles,
  Target,
  Tv,
  Volume2,
} from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { useSettings } from '../hooks/useSettings';
import { playAlertAudio } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';

gsap.registerPlugin(useGSAP);

export const Catalog: React.FC = () => {
  const { settings, update, saved } = useSettings();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [quickTestMsg, setQuickTestMsg] = useState<string | null>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Animación de entrada escalonada (stagger) para las tarjetas del catálogo
  useGSAP(
    () => {
      // Respetar prefers-reduced-motion
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) return;

      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

      tl.fromTo(
        '.catalog-header',
        { opacity: 0, y: -15 },
        { opacity: 1, y: 0, duration: 0.35, clearProps: 'transform,opacity' }
      ).fromTo(
        '.suite-card',
        { opacity: 0, y: 25, scale: 0.96 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.38,
          stagger: 0.05,
          clearProps: 'transform,opacity',
        },
        '-=0.15'
      );
    },
    { scope: containerRef }
  );

  const copyUrl = (key: string, url: string) => {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const triggerQuickAlertTest = () => {
    playAlertAudio('synth-bell', 0.85);
    postBus({
      type: 'ALERT_TRIGGER',
      alert: {
        id: `test-${Date.now()}`,
        eventType: 'follow',
        user: settings.channel || 'NuevoSeguidor',
        detail: '¡Acaba de seguirte!',
        text: '¡Gracias por unirte a la tripulación!',
        style: settings.alertStyle,
        accent: settings.accent,
        soundType: 'synth-bell',
        duration: 4,
      },
    });
    setQuickTestMsg('¡Alerta de prueba enviada al bus y reproducida!');
    setTimeout(() => setQuickTestMsg(null), 2800);
  };

  const rootStyle = {
    '--acc': settings.accent,
    '--acc-ink': '#ffffff',
  } as React.CSSProperties;

  return (
    <div ref={containerRef} className="cab" style={rootStyle}>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6">
        {/* Barra de navegación superior de la Suite */}
        <SuiteNav currentApp="catalogo" channel={settings.channel} saved={saved} />

        {/* Cabecera del Dashboard */}
        <div className="catalog-header flex flex-col justify-between gap-4 border-b border-[color:var(--cb-line)] pb-5 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-2 text-[color:var(--cb-mut)]">
              <LayoutGrid className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
              <span className="cab-caps text-xs font-bold tracking-widest">
                DASHBOARD · ESTACIÓN CENTRAL DE HERRAMIENTAS
              </span>
            </div>
            <h1
              className="cab-caps mt-1 text-3xl font-extrabold tracking-tight"
              style={{ fontStretch: '75%' }}
            >
              Lalo Stream Suite
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[color:var(--cb-mut)]">
              Mesa de control integral para transmisiones en directo. Selecciona una
              herramienta para configurar su audio, apariencia visual e integración con OBS Studio.
            </p>
          </div>

          {/* Selector rápido del canal de Twitch */}
          <div className="flex flex-col gap-1.5 rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3 sm:min-w-[260px]">
            <label
              htmlFor="suite-channel"
              className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]"
            >
              Canal de emisión
            </label>
            <div className="relative">
              <span className="cab-mono pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[color:var(--cb-mut)]">
                twitch.tv/
              </span>
              <input
                id="suite-channel"
                type="text"
                value={settings.channel}
                onChange={(e) =>
                  update({ channel: e.target.value.toLowerCase().trim() })
                }
                placeholder="tu_canal"
                className="cab-inp cab-mono !h-8 text-xs font-bold"
                style={{ paddingLeft: 84 }}
              />
            </div>
          </div>
        </div>

        {/* Notificación temporal de test */}
        {quickTestMsg && (
          <div className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-300">
            <Check className="h-4 w-4 text-emerald-400" />
            <span>{quickTestMsg}</span>
          </div>
        )}

        {/* Grid de Aplicaciones del Catálogo */}
        <section aria-label="Aplicaciones disponibles">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {/* 1. Lalo TTS */}
            <article className="suite-card group relative flex flex-col justify-between rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5 transition-all duration-200 hover:border-[color:var(--cb-fg)]">
              <div>
                {/* Cabecera de la tarjeta */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[color:var(--cb-surface)] text-[color:var(--ui,#9146ff)] transition-transform duration-150 group-hover:scale-105">
                    <Mic className="h-6 w-6" />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                      EN VIVO
                    </span>
                    <span className="rounded bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--cb-mut)]">
                      IA PRO FREE
                    </span>
                  </div>
                </div>

                {/* Título y descripción */}
                <h2
                  className="cab-caps mt-4 text-xl font-extrabold text-[color:var(--cb-fg)]"
                  style={{ fontStretch: '75%' }}
                >
                  Voz en Vivo (TTS)
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                  Lectura inteligente del chat de Twitch con voces clonadas por IA (Fish Audio),
                  emociones vocales dinámicas, moderación en vivo y cola FIFO blindada para OBS.
                </p>

                {/* Badges de capacidades */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    4 Estilos de Alerta
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Trigger !s
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Moderación & Puntos
                  </span>
                </div>
              </div>

              {/* Acciones directas */}
              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[color:var(--cb-line)] pt-4">
                <a
                  href="#tts"
                  className="cab-btn !h-9 flex-1 !text-xs font-bold no-underline"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>Ajustes</span>
                </a>
                <a
                  href="#control"
                  className="cab-btn2 !h-9 !px-3 !text-xs font-bold no-underline"
                  title="Abrir mesa de control durante el stream"
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>En vivo</span>
                </a>
                <button
                  type="button"
                  className="cab-btn2 !h-9 !px-2.5 !text-xs"
                  onClick={() =>
                    copyUrl('tts', `${baseUrl}/#widget?channel=${settings.channel}`)
                  }
                  title="Copiar URL del Widget para OBS"
                >
                  {copiedKey === 'tts' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </article>

            {/* 2. Lalo Alertas */}
            <article className="suite-card group relative flex flex-col justify-between rounded-md border border-[color:var(--ui,#9146ff)]/50 bg-[color:var(--cb-panel)] p-5 shadow-lg shadow-[color:var(--ui,#9146ff)]/5 transition-all duration-200 hover:border-[color:var(--ui,#9146ff)]">
              <div>
                {/* Cabecera de la tarjeta */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[color:var(--ui,#9146ff)]/15 text-[color:var(--ui,#9146ff)] transition-transform duration-150 group-hover:scale-105">
                    <BellRing className="h-6 w-6" />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-[color:var(--ui,#9146ff)] px-2 py-0.5 text-[10px] font-black text-white">
                      NUEVO
                    </span>
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                      DISPONIBLE
                    </span>
                  </div>
                </div>

                {/* Título y descripción */}
                <h2
                  className="cab-caps mt-4 text-xl font-extrabold text-[color:var(--cb-fg)]"
                  style={{ fontStretch: '75%' }}
                >
                  Alertas de Stream
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                  Alertas cinemáticas para nuevos Followers, Suscripciones, Bits y Raids.
                  Motor de sonido Web Audio instantáneo y sincronización visual con la cabina.
                </p>

                {/* Badges de capacidades */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Follows / Subs / Bits
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Audio Chimes Nativo
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Física GSAP
                  </span>
                </div>
              </div>

              {/* Acciones directas */}
              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[color:var(--cb-line)] pt-4">
                <a
                  href="#alertas"
                  className="cab-btn !h-9 flex-1 !text-xs font-bold no-underline"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Estudio de Alertas</span>
                </a>
                <button
                  type="button"
                  className="cab-btn2 !h-9 !px-3 !text-xs font-bold"
                  onClick={triggerQuickAlertTest}
                  title="Lanzar un sonido y alerta de prueba rápida"
                >
                  <Volume2 className="h-3.5 w-3.5 text-[color:var(--ui,#9146ff)]" />
                  <span>Probar</span>
                </button>
                <button
                  type="button"
                  className="cab-btn2 !h-9 !px-2.5 !text-xs"
                  onClick={() =>
                    copyUrl(
                      'alerts',
                      `${baseUrl}/#widget?app=alerts&channel=${settings.channel}`
                    )
                  }
                  title="Copiar URL del Widget de Alertas para OBS"
                >
                  {copiedKey === 'alerts' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </article>

            {/* 3. Lalo Bot & EventSub Engine (Powered by TwitchIO) */}
            <article className="suite-card group relative flex flex-col justify-between rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5 transition-all duration-200 hover:border-emerald-400/80">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400 transition-transform duration-150 group-hover:scale-105">
                    <Bot className="h-6 w-6" />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                      DISPONIBLE
                    </span>
                    <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--cb-mut)]">
                      POWERED BY TWITCHIO
                    </span>
                  </div>
                </div>

                <h2
                  className="cab-caps mt-4 text-xl font-extrabold text-[color:var(--cb-fg)]"
                  style={{ fontStretch: '75%' }}
                >
                  Bot & EventSub Engine
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                  Basado en el framework asíncrono <b className="text-[color:var(--cb-fg)]">TwitchIO</b> (por PythonistaGuild & EvieePy). Despachador de comandos personalizados, EventSub y moderación en tiempo real.
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    TwitchIO (MIT)
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    EventSub WebSockets
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    PythonistaGuild
                  </span>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[color:var(--cb-line)] pt-4">
                <a
                  href="#twitchio"
                  className="cab-btn !h-9 flex-1 !text-xs font-bold no-underline"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>Estudio TwitchIO</span>
                </a>
                <a
                  href="https://github.com/TwitchIO/TwitchIO"
                  target="_blank"
                  rel="noreferrer"
                  className="cab-btn2 !h-9 !px-3 !text-xs font-bold no-underline"
                  title="Ver repositorio original de TwitchIO en GitHub"
                >
                  <span>GitHub</span>
                </a>
              </div>
            </article>

            {/* 4. Puntos de Canal & FX Personalizados */}
            <article className="suite-card group relative flex flex-col justify-between rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5 transition-all duration-200 hover:border-amber-400/80">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-amber-500/15 text-amber-400 transition-transform duration-150 group-hover:scale-105">
                    <Coins className="h-6 w-6" />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-400">
                      MÓDULO 4
                    </span>
                    <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--cb-mut)]">
                      ESTILO STREAMELEMENTS
                    </span>
                  </div>
                </div>

                <h2
                  className="cab-caps mt-4 text-xl font-extrabold text-[color:var(--cb-fg)]"
                  style={{ fontStretch: '75%' }}
                >
                  Puntos de Canal & FX
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                  Redenciones interactivas con EventSub. Lanza vídeos transparentes (WebM con canal alfa), memes en pantalla, sacudidas de cámara, sonidos personalizados y triggers de OBS Studio.
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    Videos WebM Alfa
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    EventSub Rewards
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Triggers OBS Studio
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Sonidos Custom
                  </span>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[color:var(--cb-line)] pt-4">
                <a
                  href="#recompensas"
                  className="cab-btn !h-9 flex-1 !text-xs font-bold no-underline"
                >
                  <Coins className="h-3.5 w-3.5 text-amber-400" />
                  <span>Estudio Recompensas</span>
                </a>
                <button
                  type="button"
                  className="cab-btn2 !h-9 !px-3 !text-xs font-bold"
                  onClick={() => {
                    playAlertAudio('arcade-chime', 0.85);
                    postBus({
                      type: 'REWARD_TRIGGER',
                      reward: {
                        id: `reward-test-${Date.now()}`,
                        user: 'EspectadorPro',
                        rewardName: '¡Lluvia de Confeti Neón!',
                        noticeText: '¡EspectadorPro desató una lluvia de confeti en el stream!',
                        position: 'fullscreen',
                        scale: 1.0,
                        volume: 0.85,
                        screenShake: true,
                        accentColor: '#f59e0b',
                        soundType: 'arcade-chime',
                        duration: 5,
                      },
                    });
                    setQuickTestMsg('¡Redención simulada de Puntos de Canal disparada al monitor y a OBS!');
                    setTimeout(() => setQuickTestMsg(null), 3000);
                  }}
                  title="Simular una redención rápida de prueba"
                >
                  <Play className="h-3 w-3 fill-current text-amber-400" />
                  <span>Probar</span>
                </button>
                <button
                  type="button"
                  className="cab-btn2 !h-9 !px-2.5 !text-xs"
                  onClick={() =>
                    copyUrl(
                      'rewards',
                      `${baseUrl}/#widget?app=rewards&channel=${settings.channel}`
                    )
                  }
                  title="Copiar Widget OBS de Recompensas y FX"
                >
                  {copiedKey === 'rewards' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </article>

            {/* 5. Metas Comunitarias & Marcadores */}
            <article className="suite-card group relative flex flex-col justify-between rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-5 transition-all duration-200 hover:border-rose-400/80">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-rose-500/15 text-rose-400 transition-transform duration-150 group-hover:scale-105">
                    <Target className="h-6 w-6" />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-black text-rose-300">
                      MÓDULO 5
                    </span>
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                      DISPONIBLE
                    </span>
                  </div>
                </div>

                <h2
                  className="cab-caps mt-4 text-xl font-extrabold text-[color:var(--cb-fg)]"
                  style={{ fontStretch: '75%' }}
                >
                  Metas & Marcadores en Vivo
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                  Marcadores de objetivos para Suscripciones, Seguidores y Bits. Física fluida GSAP,
                  lluvia de confeti, sacudida sísmica (Screen Shake), videos de victoria y fanfarrias personalizadas al 100%.
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                    Sub & Bit Goals
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Física Fluida GSAP
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Confeti & Shake
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Fanfarria MP3
                  </span>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[color:var(--cb-line)] pt-4">
                <a
                  href="#metas"
                  className="cab-btn !h-9 flex-1 !text-xs font-bold no-underline"
                >
                  <Target className="h-3.5 w-3.5 text-rose-400" />
                  <span>Estudio de Metas</span>
                </a>
                <button
                  type="button"
                  className="cab-btn2 !h-9 !px-3 !text-xs font-bold"
                  onClick={() => {
                    playAlertAudio('retro-fanfare', 0.85);
                    postBus({
                      type: 'GOAL_CELEBRATE',
                      celebration: {
                        goalId: 'demo-goal',
                        title: 'Meta Comunitaria Demostración',
                        victorySoundType: 'retro-fanfare',
                        screenShake: true,
                        confetti: true,
                        duration: 5,
                      },
                    });
                    setQuickTestMsg('¡Celebración de Meta enviada al bus y reproducida!');
                    setTimeout(() => setQuickTestMsg(null), 2800);
                  }}
                  title="Probar celebración de meta 100%"
                >
                  <Sparkles className="h-3.5 w-3.5 text-rose-400" />
                  <span>Celebrar</span>
                </button>
                <button
                  type="button"
                  className="cab-btn2 !h-9 !px-2.5 !text-xs"
                  onClick={() =>
                    copyUrl('goals', `${baseUrl}/#widget?app=goals&channel=${settings.channel}`)
                  }
                  title="Copiar Widget OBS de Metas"
                >
                  {copiedKey === 'goals' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </article>

            {/* 5. Ruleta & Minijuegos (Próximamente) */}
            <article className="suite-card relative flex flex-col justify-between rounded-md border border-dashed border-[color:var(--cb-line)] bg-[color:var(--cb-surface)]/50 p-5 opacity-85 transition-opacity hover:opacity-100">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)]">
                    <Gamepad2 className="h-6 w-6" />
                  </div>
                  <span className="rounded bg-[color:var(--cb-surface)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--cb-mut)]">
                    Próximamente
                  </span>
                </div>

                <h2
                  className="cab-caps mt-4 text-xl font-extrabold text-[color:var(--cb-mut)]"
                  style={{ fontStretch: '75%' }}
                >
                  Ruleta & Castigos
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-[color:var(--cb-mut)]">
                  Minijuego de ruleta interactiva accionada por puntos de canal de Twitch.
                  Física de giro con inercia, desaceleración natural y efectos de victoria.
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-bg)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Puntos de Canal
                  </span>
                  <span className="rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-bg)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--cb-mut)]">
                    Física de Inercia
                  </span>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-[color:var(--cb-line)]/50 pt-4 text-xs font-semibold text-[color:var(--cb-mut)]">
                <span>En hoja de ruta de la Suite</span>
                <span className="cab-mono text-[11px]">v1.4</span>
              </div>
            </article>
          </div>
        </section>

        {/* Módulo OBS Integration Dock */}
        <section
          className="cab-mod mt-4 border border-[color:var(--cb-line)]"
          aria-label="Integración con OBS Studio"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 !text-base">
                <Tv className="h-4 w-4 text-[color:var(--ui,#9146ff)]" />
                <span>INTEGRACIÓN DIRECTA CON OBS STUDIO</span>
              </h2>
              <p className="cab-hint mt-1 text-xs">
                Añade una fuente de tipo <b>Navegador (Browser Source)</b> en OBS con resolución{' '}
                <b>1920 × 1080</b> y marca la casilla «Controlar audio mediante OBS».
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="cab-caps text-xs text-[color:var(--cb-mut)]">
                CANAL ACTIVO: <b className="text-[color:var(--cb-fg)]">{settings.channel}</b>
              </span>
            </div>
          </div>

          <div className="grid gap-3 pt-2 md:grid-cols-3">
            {/* Fuente TTS */}
            <div className="flex flex-col justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3">
              <div>
                <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]">
                  FUENTE 1: OVERLAY TTS
                </span>
                <p className="mt-1 text-xs text-[color:var(--cb-fg)]">
                  Lectura del chat !s con voces Fish Audio y animaciones de texto cinéticas.
                </p>
              </div>
              <button
                type="button"
                className="cab-btn2 mt-3 !h-8 !text-xs font-bold"
                onClick={() =>
                  copyUrl('dock-tts', `${baseUrl}/#widget?channel=${settings.channel}`)
                }
              >
                {copiedKey === 'dock-tts' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedKey === 'dock-tts' ? 'URL Copiada' : 'Copiar URL TTS'}</span>
              </button>
            </div>

            {/* Fuente Alertas */}
            <div className="flex flex-col justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3">
              <div>
                <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]">
                  FUENTE 2: OVERLAY ALERTAS
                </span>
                <p className="mt-1 text-xs text-[color:var(--cb-fg)]">
                  Alertas de Follow, Sub, Bits y Raids con sonido sintetizado e ilustraciones.
                </p>
              </div>
              <button
                type="button"
                className="cab-btn2 mt-3 !h-8 !text-xs font-bold"
                onClick={() =>
                  copyUrl(
                    'dock-alerts',
                    `${baseUrl}/#widget?app=alerts&channel=${settings.channel}`
                  )
                }
              >
                {copiedKey === 'dock-alerts' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>
                  {copiedKey === 'dock-alerts' ? 'URL Copiada' : 'Copiar URL Alertas'}
                </span>
              </button>
            </div>

            {/* Fuente Todo-en-uno */}
            <div className="flex flex-col justify-between rounded border border-[color:var(--ui,#9146ff)]/50 bg-[color:var(--cb-surface)] p-3">
              <div>
                <span className="cab-caps flex items-center justify-between text-[11px] font-bold text-[color:var(--ui,#9146ff)]">
                  <span>FUENTE UNIFICADA (SUITE)</span>
                  <span className="rounded bg-[color:var(--ui,#9146ff)] px-1.5 py-0.2 text-[9px] text-white">
                    RECOMENDADO
                  </span>
                </span>
                <p className="mt-1 text-xs text-[color:var(--cb-fg)]">
                  Una única fuente en OBS que procesa TTS y Alertas simultáneamente sin consumir recursos extra.
                </p>
              </div>
              <button
                type="button"
                className="cab-btn mt-3 !h-8 !text-xs font-bold"
                onClick={() =>
                  copyUrl('dock-all', `${baseUrl}/#widget?app=all&channel=${settings.channel}`)
                }
              >
                {copiedKey === 'dock-all' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>
                  {copiedKey === 'dock-all' ? 'URL Copiada' : 'Copiar URL Todo-en-Uno'}
                </span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
