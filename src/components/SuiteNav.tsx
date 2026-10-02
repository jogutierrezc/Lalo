/**
 * src/components/SuiteNav.tsx
 *
 * Barra de navegación principal de Lalo Stream Suite.
 * Conecta las herramientas de la suite (Catálogo, TTS, Alertas) y proporciona
 * acceso rápido al estado de transmisión, copia de URLs para OBS y tema.
 */

import React, { useState } from 'react';
import {
  BellRing,
  Bot,
  Check,
  Coins,
  Copy,
  Layers,
  LayoutGrid,
  Mic,
  Target,
  Tv,
} from 'lucide-react';
import { ThemeSwitch } from './ThemeSwitch';

export type SuiteApp =
  | 'catalogo'
  | 'tts'
  | 'control'
  | 'alertas'
  | 'recompensas'
  | 'twitchio'
  | 'metas';

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

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const getWidgetUrl = (mode: 'tts' | 'alerts' | 'all') => {
    if (mode === 'tts') return `${baseUrl}/#widget?channel=${channel}`;
    if (mode === 'alerts') return `${baseUrl}/#widget?app=alerts&channel=${channel}`;
    return `${baseUrl}/#widget?app=all&channel=${channel}`;
  };

  const handleCopy = (mode: 'tts' | 'alerts' | 'all') => {
    const url = getWidgetUrl(mode);
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedKey(mode);
    setTimeout(() => setCopiedKey(null), 2000);
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
        </nav>

        {/* Acciones de la derecha: OBS Dropdown, Canal, Guía, Tema */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Canal actual */}
          <span className="cab-caps hidden text-xs text-[color:var(--cb-mut)] md:inline-block">
            Canal:{' '}
            <b className="cab-mono text-[color:var(--cb-fg)]">
              {channel || 'sin canal'}
            </b>
          </span>

          {/* Menú rápido OBS Sources */}
          <div className="relative">
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
                  className="absolute right-0 top-full z-50 mt-2 w-72 rounded-md border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-3 shadow-xl"
                  style={{
                    animation: 'fadeIn 0.15s cubic-bezier(0.23, 1, 0.32, 1)',
                  }}
                >
                  <div className="mb-2 flex items-center justify-between border-b border-[color:var(--cb-line)] pb-1.5">
                    <span className="cab-caps text-[11px] font-bold text-[color:var(--cb-mut)]">
                      FUENTES DE NAVEGADOR (OBS)
                    </span>
                    <Tv className="h-3.5 w-3.5 text-[color:var(--cb-mut)]" />
                  </div>

                  <div className="grid gap-2">
                    {/* Opción 1: TTS Widget */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div>
                        <p className="text-xs font-bold text-[color:var(--cb-fg)]">
                          Overlay TTS
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)]">
                          Lectura de chat !s
                        </p>
                      </div>
                      <button
                        type="button"
                        className="cab-btn2 !h-7 !px-2 !text-[11px]"
                        onClick={() => handleCopy('tts')}
                      >
                        {copiedKey === 'tts' ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>{copiedKey === 'tts' ? 'Copiado' : 'Copiar'}</span>
                      </button>
                    </div>

                    {/* Opción 2: Alertas Widget */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div>
                        <p className="text-xs font-bold text-[color:var(--cb-fg)]">
                          Overlay Alertas
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)]">
                          Follows, subs, bits
                        </p>
                      </div>
                      <button
                        type="button"
                        className="cab-btn2 !h-7 !px-2 !text-[11px]"
                        onClick={() => handleCopy('alerts')}
                      >
                        {copiedKey === 'alerts' ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>{copiedKey === 'alerts' ? 'Copiado' : 'Copiar'}</span>
                      </button>
                    </div>

                    {/* Opción 3: Todo-en-uno */}
                    <div className="flex items-center justify-between rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-2">
                      <div>
                        <p className="text-xs font-bold text-[color:var(--cb-fg)]">
                          Todo-en-Uno (Suite)
                        </p>
                        <p className="text-[10px] text-[color:var(--cb-mut)]">
                          TTS + Alertas en 1 fuente
                        </p>
                      </div>
                      <button
                        type="button"
                        className="cab-btn2 !h-7 !px-2 !text-[11px]"
                        onClick={() => handleCopy('all')}
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

                  <p className="mt-2 text-center text-[10px] text-[color:var(--cb-mut)]">
                    Resolución recomendada en OBS: 1920 × 1080
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
    </header>
  );
};
