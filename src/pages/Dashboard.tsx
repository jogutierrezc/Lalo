/**
 * Dashboard.tsx
 *
 * Panel de Control para el Streamer diseñado bajo el estándar "Impeccable UI":
 * - Modo oscuro nativo con glassmorphism sutil y bordes refinados de 1px.
 * - Jerarquía tipográfica estricta con contrastes accesibles y anillos de enfoque visibles.
 * - Configuración en tiempo real del canal de Twitch, Fish Audio API y voces.
 * - Banco de pruebas para disparar mensajes simulados y verificar el pipeline TTS.
 */

import React, { useState, useEffect } from 'react';
import {
  Tv,
  Key,
  Mic2,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  Play,
  Sliders,
  Radio,
  Layers,
  ShieldCheck
} from 'lucide-react';
import { loadSettings, saveSettings, TTSSettings } from '../types/settings';
import { sanitizeTwitchMessage } from '../utils/twitchSanitizer';

// Voces de referencia de muestra de Fish Audio (o custom reference_ids)
const PRESET_VOICES = [
  { id: '7f92f8afb8ec43bf81429cc1c9199cb1', name: 'Español — Narrador Dinámico (Voz 1)', lang: 'es-ES' },
  { id: '9f5e2786a4104724a2efdc22b31f7cf6', name: 'Español — Amigable & Streamer (Voz 2)', lang: 'es-LATAM' },
  { id: 'e1d2c3b4a5f607182930415263748596', name: 'Español — Robot Cyberpunk AI', lang: 'es' },
  { id: 'custom', name: '+ Usar reference_id personalizado...', lang: 'custom' },
];

export const Dashboard: React.FC = () => {
  const [settings, setSettings] = useState<TTSSettings>(loadSettings);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Estados del banco de pruebas
  const [testText, setTestText] = useState('¡Hola chat! Este es un mensaje de prueba con el comando !s');
  const [testUser, setTestUser] = useState('SuperViewer');
  const [testPreview, setTestPreview] = useState<string | null>(null);

  // URL del Widget para OBS
  const widgetUrl = `${window.location.origin}/#widget`;

  // Guardar configuración
  const handleSave = () => {
    saveSettings(settings);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  // Copiar URL para OBS
  const copyWidgetUrl = () => {
    navigator.clipboard.writeText(widgetUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2200);
  };

  // Previsualizar sanitización en tiempo real
  useEffect(() => {
    const raw = testText.trim().startsWith('!s ') ? testText : `!s ${testText}`;
    const res = sanitizeTwitchMessage(raw, { username: testUser });
    setTestPreview(res ? res.cleanText : '(Mensaje descartado por filtro)');
  }, [testText, testUser]);

  // Disparar mensaje de prueba al widget
  const triggerTestTTS = () => {
    handleSave();
    const raw = testText.trim().startsWith('!s ') ? testText : `!s ${testText}`;
    const win = window as unknown as { __LALO_TTS_TEST_TRIGGER__?: (text: string, user: string) => void };
    if (typeof win.__LALO_TTS_TEST_TRIGGER__ === 'function') {
      win.__LALO_TTS_TEST_TRIGGER__(raw, testUser);
    } else {
      // Disparar evento personalizado para pestañas separadas
      window.dispatchEvent(
        new CustomEvent('lalo-tts-test', {
          detail: { text: raw, user: testUser },
        })
      );
      alert(`Mensaje enviado a la cola. Abre ${widgetUrl} en OBS o en otra pestaña para escuchar.`);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 p-6 md:p-10 font-sans selection:bg-purple-500/30">
      {/* Header Superior */}
      <header className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-white/5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-glow-purple">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Twitch TTS Controller <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">v1.0</span>
              </h1>
              <p className="text-sm text-zinc-400">
                Sistema de voz en tiempo real con Fish Audio AI para OBS Studio
              </p>
            </div>
          </div>
        </div>

        {/* Acciones principales: Guardar y Enlace OBS */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={copyWidgetUrl}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-card glass-card-hover text-sm font-medium text-zinc-200 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            title="Copiar URL para OBS Browser Source"
          >
            {copiedUrl ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-purple-400" />}
            <span>{copiedUrl ? '¡Copiado para OBS!' : 'Copiar URL de OBS'}</span>
          </button>

          <a
            href="#widget"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-card glass-card-hover text-sm font-medium text-zinc-200 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          >
            <ExternalLink className="w-4 h-4 text-zinc-400" />
            <span>Abrir Widget</span>
          </a>

          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-sm font-semibold text-white shadow-glow-purple transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-purple-400"
          >
            {isSaved ? <Check className="w-4 h-4 text-white" /> : <ShieldCheck className="w-4 h-4 text-white" />}
            <span>{isSaved ? 'Guardado' : 'Guardar Cambios'}</span>
          </button>
        </div>
      </header>

      {/* Grid Principal de Configuración */}
      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
        {/* Columna Izquierda: Configuración de Canales y API (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Tarjeta 1: Twitch Chat Source */}
          <div className="glass-panel rounded-2xl p-6 shadow-glass relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Tv className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-semibold text-white tracking-tight">Canal de Twitch</h2>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                <Radio className="w-3 h-3 animate-pulse" />
                Trigger: !s
              </span>
            </div>

            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              El bot se conectará de forma anónima al chat público de Twitch. Solo leerá los mensajes que comiencen con el prefijo estricto <code className="text-purple-300 font-bold bg-white/5 px-1 py-0.5 rounded">!s </code>.
            </p>

            <div className="space-y-3">
              <label className="text-xs font-medium text-zinc-300">Nombre del canal de Twitch</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm">twitch.tv/</span>
                <input
                  type="text"
                  value={settings.channel}
                  onChange={(e) => setSettings({ ...settings, channel: e.target.value.toLowerCase().trim() })}
                  placeholder="ej: ibai, auronplay, jagc"
                  className="w-full bg-[#121218] border border-white/10 rounded-xl pl-28 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all font-mono"
                />
              </div>
            </div>
          </div>

          {/* Tarjeta 2: Conexión con Fish Audio */}
          <div className="glass-panel rounded-2xl p-6 shadow-glass relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Key className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-semibold text-white tracking-tight">Fish Audio API</h2>
              </div>
              <a
                href="https://fish.audio"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <span>Obtener API Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              Por arquitectura de seguridad (CWE-312/OWASP), tu API Key se almacena exclusivamente en el servidor dentro de <code className="text-purple-300 font-mono bg-white/5 px-1 py-0.5 rounded">.env</code> (<code className="text-purple-300 font-mono bg-white/5 px-1 py-0.5 rounded">FISH_AUDIO_API_KEY</code>) y nunca viaja en el navegador.
            </p>

            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/20 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="text-zinc-200 font-medium">Clave Protegida en Servidor Node / Vercel</p>
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    Si no hay clave configurada en <code className="text-purple-300 font-mono">.env</code>, el servidor activa automáticamente el <strong>Modo Simulación</strong> para pruebas locales y en OBS sin interrupciones.
                  </p>
                </div>
              </div>

              {/* Selector de Voz */}
              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1.5">Voz Clonada / Modelo (Reference ID)</label>
                <select
                  value={PRESET_VOICES.some(v => v.id === settings.referenceId) ? settings.referenceId : 'custom'}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') {
                      setSettings({ ...settings, referenceId: e.target.value });
                    }
                  }}
                  className="w-full bg-[#121218] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all mb-2"
                >
                  {PRESET_VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id} className="bg-zinc-900 text-white">
                      {voice.name}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={settings.referenceId}
                  onChange={(e) => setSettings({ ...settings, referenceId: e.target.value.trim() })}
                  placeholder="ID de voz personalizado (ej. 7f92f8afb8ec43bf81429cc1c9199cb1)"
                  className="w-full bg-[#121218] border border-white/10 rounded-xl px-4 py-2 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Tarjeta 3: Ajustes de Audio */}
          <div className="glass-panel rounded-2xl p-6 shadow-glass">
            <div className="flex items-center gap-2.5 mb-5">
              <Sliders className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-semibold text-white tracking-tight">Parámetros de Audio</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Volumen */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-300">Volumen General</span>
                  <span className="text-purple-400 font-mono font-bold">{Math.round(settings.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.volume}
                  onChange={(e) => setSettings({ ...settings, volume: parseFloat(e.target.value) })}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              {/* Velocidad */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-300">Velocidad de Reproducción</span>
                  <span className="text-purple-400 font-mono font-bold">{settings.speed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.75"
                  max="1.5"
                  step="0.05"
                  value={settings.speed}
                  onChange={(e) => setSettings({ ...settings, speed: parseFloat(e.target.value) })}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Banco de Pruebas y Monitor (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Tarjeta de Pruebas en Vivo */}
          <div className="glass-panel rounded-2xl p-6 shadow-glass border border-purple-500/20 relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Mic2 className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-semibold text-white">Banco de Pruebas</h3>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono bg-white/5 px-2 py-0.5 rounded">Simulador</span>
            </div>

            <p className="text-xs text-zinc-400 mb-4">
              Prueba cómo el sistema sanitiza y encola un mensaje simulando una llegada desde el chat de Twitch.
            </p>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs text-zinc-300 block mb-1">Usuario Simulador</label>
                <input
                  type="text"
                  value={testUser}
                  onChange={(e) => setTestUser(e.target.value)}
                  className="w-full bg-[#121218] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-300 block mb-1">Mensaje Bruto de Chat</label>
                <textarea
                  rows={3}
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  className="w-full bg-[#121218] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none font-mono"
                  placeholder="!s mensaje de prueba..."
                />
              </div>

              {/* Resultado del Sanitizer */}
              <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs">
                <span className="text-[10px] uppercase font-mono text-zinc-500 block mb-1">Texto Sanitizado para TTS:</span>
                <p className="text-purple-200 italic font-mono text-xs">
                  {testPreview || 'Escribe un mensaje para previsualizar...'}
                </p>
              </div>

              <button
                onClick={triggerTestTTS}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-glow-purple transition-all active:scale-[0.98]"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Disparar Síntesis al Widget</span>
              </button>
            </div>
          </div>

          {/* Guía Rápida para OBS Studio */}
          <div className="glass-panel rounded-2xl p-6 shadow-glass text-xs space-y-3">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold text-sm">
              <Layers className="w-4 h-4 text-purple-400" />
              <span>Instrucciones para OBS Studio</span>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-zinc-400 leading-relaxed">
              <li>En OBS Studio, añade una nueva fuente: <strong className="text-zinc-200">Navegador (Browser Source)</strong>.</li>
              <li>Pega la URL del widget: <code className="text-purple-300 bg-white/5 px-1 py-0.5 rounded">{widgetUrl}</code>.</li>
              <li>Establece el ancho en <strong className="text-zinc-200">800</strong> y alto en <strong className="text-zinc-200">600</strong> (o 1920x1080).</li>
              <li>Marca la opción <strong className="text-zinc-200">"Controlar audio a través de OBS"</strong> si deseas monitorear el volumen en el mezclador de OBS.</li>
              <li>¡Listo! El overlay permanecerá invisible hasta que alguien escriba <code className="text-purple-300 font-bold">!s [mensaje]</code>.</li>
            </ol>
          </div>
        </div>
      </main>
    </div>
  );
};
