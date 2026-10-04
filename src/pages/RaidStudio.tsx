/**
 * src/pages/RaidStudio.tsx
 *
 * Estudio de la capa «Saludo de raid» sobre la plantilla común del panel: a la
 * izquierda se ajusta, a la derecha el monitor 16:9 queda siempre a la vista.
 *
 * - Bajo el monitor hay un botón por cada cosa que dispara el saludo: una raid,
 *   !so, !clip, un canal sin cortos y !cortar. Usan datos de ejemplo y funcionan
 *   aunque el servidor no tenga el secreto de Twitch.
 * - Con el servidor configurado, se puede escribir un canal o el enlace de un
 *   corto real para ver el reproductor de Twitch en el monitor.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, Range, Toggle } from '../components/studio/StudioKit';
import { GuidedTour, TourStep, isTourDone } from '../components/GuidedTour';
import { RaidLayer, RaidLayerHandle } from '../components/raid/RaidLayer';
import { useRaidSettings } from '../hooks/useRaidSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { DEFAULT_RAID_TEMPLATE, RAID_FRAMES, RAID_LIMITS, encodeRaidSettings, normalizeRaidSettings } from '../types/raid';
import { loadSettings } from '../types/settings';
import { RaidSampleKind, normalizeLogin, parseClipRef, readClipResponse, sampleGreeting, welcomeText } from '../utils/raidLogic';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import '../styles/raid.css';

const TOUR_ID = 'raid';

const RAID_TOUR_STEPS: TourStep[] = [
  {
    badge: 'Bienvenida',
    title: 'Saludo de raid',
    body: 'Cuando otro canal te manda una raid, aparece una placa con su nombre y cuántas personas llegan, junto a un corto de ese canal.',
  },
  {
    target: 'raid-rules',
    badge: 'Reglas',
    title: 'Cuándo aparece',
    body: 'Decide el tamaño mínimo de la raid, cuánto dura el corto como mucho y si tu voz da la bienvenida.',
  },
  {
    target: 'raid-commands',
    badge: 'Moderación',
    title: 'Comandos del chat',
    body: 'Tú y tus moderadores pueden saludar a un canal, poner un corto concreto o retirarlo. Los nombres se pueden cambiar.',
  },
  {
    target: 'raid-monitor',
    badge: 'Monitor',
    title: 'Prueba y copia la URL',
    body: 'Cada botón simula una cosa que dispara el saludo. Cuando te guste, copia la URL y pégala en OBS.',
  },
];

type ServerState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'missing'; missing: string[] }
  | { kind: 'unknown' };

const TESTS: { kind: RaidSampleKind; label: string; log: string }[] = [
  { kind: 'raid', label: 'Llega una raid', log: 'Raid de StreamerHost con 48 personas: se busca su corto más visto y sale junto al saludo.' },
  { kind: 'so', label: 'Un mod escribe !so canal', log: 'Un moderador saluda a pau_rl: el mismo saludo, sin esperar a una raid.' },
  { kind: 'clip', label: 'Un mod escribe !clip enlace', log: 'Un moderador envía el enlace de un corto: se reproduce ese corto concreto.' },
  { kind: 'none', label: 'Canal sin cortos', log: 'El canal no tiene cortos: sale la placa sola.' },
];

export const RaidStudio: React.FC = () => {
  const { raidSettings, saved, updateSettings, updateCommands } = useRaidSettings();
  const cloud = useCloudSession();
  const uid = useId();

  const [tourOpen, setTourOpen] = useState(false);
  const [copied, setCopied] = useState<'url' | 'demo' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [server, setServer] = useState<ServerState>({ kind: 'checking' });
  const [real, setReal] = useState('');

  const layerRef = useRef<RaidLayerHandle | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [voice] = useState(loadSettings);
  const channel = voice.channel;
  // El monitor usa los ajustes ya validados, igual que los recibirá OBS
  const clean = useMemo(() => normalizeRaidSettings(raidSettings), [raidSettings]);

  // La guía se abre sola la primera vez
  useEffect(() => {
    if (isTourDone(TOUR_ID)) return;
    const timer = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  // ¿Puede el servidor buscar cortos? Solo pregunta si tiene la configuración: no llama a Twitch
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/twitch/clip?check=1', { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        const found = readClipResponse(body);
        if (found.state === 'not_configured') setServer({ kind: 'missing', missing: found.missing });
        else if (res.ok && (body as { configured?: unknown } | null)?.configured === true) setServer({ kind: 'ready' });
        else setServer({ kind: 'unknown' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setServer({ kind: 'unknown' });
      });
    return () => controller.abort();
  }, []);

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 7000);
  };

  // ---------- Pruebas ----------
  const missingText = server.kind === 'missing' ? server.missing.join(' y ') || 'la configuración de Twitch' : '';
  const sampleNote =
    server.kind === 'missing'
      ? `El servidor no está configurado: falta ${missingText}. Aquí iría el corto.`
      : server.kind === 'ready'
        ? 'Corto de muestra. Para ver uno real, escribe un canal bajo los botones.'
        : 'Corto de muestra: no se pudo preguntar al servidor si puede buscar cortos.';

  const realClip = real.includes('/') ? parseClipRef(real) : null;
  const realLogin = real.includes('/') ? '' : normalizeLogin(real);

  const runTest = (kind: RaidSampleKind, log: string) => {
    const id = `prueba-${kind}-${Date.now()}`;
    if (server.kind === 'ready' && kind === 'clip' && realClip) {
      layerRef.current?.test({ id, kind: 'clip', clipId: realClip, by: 'mar_ia' });
      say('Se pide ese corto a Twitch y se reproduce en el monitor. Si no arranca solo, púlsalo: fuera de OBS el navegador puede impedirlo.');
      return;
    }
    if (server.kind === 'ready' && (kind === 'raid' || kind === 'so') && realLogin) {
      layerRef.current?.test(
        kind === 'raid'
          ? { id, kind: 'raid', channel: realLogin, login: realLogin, viewers: 48 }
          : { id, kind: 'so', channel: realLogin, login: realLogin, by: 'mar_ia' }
      );
      say(`Se busca en Twitch el corto más visto de ${realLogin} en los últimos ${clean.clipDays} días.`);
      return;
    }
    layerRef.current?.test(sampleGreeting(kind, sampleNote));
    say(kind === 'raid' && clean.voice ? `${log} La voz diría: «${welcomeText(clean.voiceTemplate, 'StreamerHost', 48)}»` : log);
  };

  // Al abrir, un saludo de ejemplo para que el monitor no esté vacío
  const greetedRef = useRef(false);
  useEffect(() => {
    if (server.kind === 'checking' || greetedRef.current) return;
    greetedRef.current = true;
    layerRef.current?.test(sampleGreeting('raid', sampleNote));
  }, [server.kind, sampleNote]);

  const cut = () => {
    const removed = layerRef.current?.cut();
    say(removed ? `Un moderador escribió ${clean.commands.cut}: el saludo sale de inmediato.` : 'No hay ningún saludo en pantalla.');
  };

  // ---------- URL de OBS ----------
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const copyUrl = (withDemo: boolean) => {
    const tts = loadSettings();
    const extra: Record<string, string> =
      cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : { rs: encodeRaidSettings(clean) };
    if (withDemo) extra.demo = '1';
    const url = buildSuiteWidgetUrl(baseUrl, 'raid', tts.channel, tts, extra);
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(withDemo ? 'demo' : 'url');
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(null), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  const frame = RAID_FRAMES.find((item) => item.id === raidSettings.frame) || RAID_FRAMES[0];
  const fixCommands = () => updateSettings({ commands: clean.commands });
  const commandFields = [
    ['so', 'Saludar a un canal', `${clean.commands.so} canal`],
    ['clip', 'Poner un corto', `${clean.commands.clip} enlace`],
    ['cut', 'Retirar el saludo', clean.commands.cut],
  ] as const;

  return (
    <div className="cab" style={{ paddingBottom: tourOpen ? 220 : undefined }}>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="raid" channel={channel} saved={saved} onOpenTour={() => setTourOpen(true)} tourAvailable={!tourOpen} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="grid gap-5">
            {/* ---------- Reglas ---------- */}
            <section className="cab-mod" data-tour="raid-rules">
              <h2>Cuándo aparece</h2>
              <div className="cab-field">
                <Toggle label="Saludar las raids y aceptar los comandos" checked={raidSettings.enabled} onChange={(enabled) => updateSettings({ enabled })} />
                <span className="cab-hint">Apagado, la capa no hace nada aunque esté en OBS. Las pruebas de esta página siguen funcionando.</span>
              </div>
              <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                <Field
                  label="Tamaño mínimo de la raid"
                  htmlFor={`${uid}-min`}
                  hint="Personas que tienen que llegar para que salga el saludo."
                >
                  <input
                    id={`${uid}-min`}
                    type="number"
                    className="cab-inp"
                    min={RAID_LIMITS.minViewers.min}
                    max={RAID_LIMITS.minViewers.max}
                    value={raidSettings.minViewers}
                    onChange={(e) => updateSettings({ minViewers: Number(e.target.value) })}
                    onBlur={() => updateSettings({ minViewers: clean.minViewers })}
                  />
                </Field>
                <Field label="Duración máxima del corto" hint="Un corto más largo se retira al llegar a este tiempo.">
                  <Range
                    label="Duración máxima del corto"
                    min={RAID_LIMITS.maxClipSeconds.min}
                    max={RAID_LIMITS.maxClipSeconds.max}
                    value={clean.maxClipSeconds}
                    format={(value) => `${value} s`}
                    onChange={(maxClipSeconds) => updateSettings({ maxClipSeconds })}
                  />
                </Field>
                <Field
                  label="De qué días se elige el corto"
                  htmlFor={`${uid}-days`}
                  hint="Sale el corto más visto de estos últimos días. Si no hay ninguno, el más visto de siempre."
                >
                  <input
                    id={`${uid}-days`}
                    type="number"
                    className="cab-inp"
                    min={RAID_LIMITS.clipDays.min}
                    max={RAID_LIMITS.clipDays.max}
                    value={raidSettings.clipDays}
                    onChange={(e) => updateSettings({ clipDays: Number(e.target.value) })}
                    onBlur={() => updateSettings({ clipDays: clean.clipDays })}
                  />
                </Field>
              </div>
              <div className="cab-field">
                <Toggle label="Mostrar también en «Todo en uno»" checked={raidSettings.inAll} onChange={(inAll) => updateSettings({ inAll })} />
                <span className="cab-hint">La fuente «Saludo de raid» lo muestra siempre.</span>
              </div>
              <p className="cab-note" role="status">
                {server.kind === 'checking' && 'Comprobando si el servidor puede buscar cortos en Twitch.'}
                {server.kind === 'ready' && 'El servidor puede buscar cortos en Twitch.'}
                {server.kind === 'missing' &&
                  `El servidor aún no puede buscar cortos: le falta ${missingText}. Mientras tanto, el saludo sale con la placa sola. Quien administra el servidor la añade en sus variables de entorno.`}
                {server.kind === 'unknown' &&
                  'No se pudo preguntar al servidor si puede buscar cortos. En local hace falta arrancarlo con «npm run dev:all». Sin él, el saludo sale con la placa sola.'}
              </p>
            </section>

            {/* ---------- Voz ---------- */}
            <section className="cab-mod">
              <h2>Bienvenida con voz</h2>
              <div className="cab-field">
                <Toggle label="La voz da la bienvenida en las raids" checked={raidSettings.voice} onChange={(voiceOn) => updateSettings({ voice: voiceOn })} />
                <span className="cab-hint">
                  Usa la voz que tengas elegida en «Voz del chat» y espera su turno en la misma cola. En los saludos por
                  comando no habla.
                </span>
              </div>
              <Field
                label="Qué dice"
                htmlFor={`${uid}-tpl`}
                hint={`Escribe {canal} y {personas} donde quieras el nombre y el número. Ahora diría: «${welcomeText(clean.voiceTemplate, 'StreamerHost', 48)}»`}
              >
                <input
                  id={`${uid}-tpl`}
                  type="text"
                  className="cab-inp"
                  maxLength={RAID_LIMITS.template}
                  value={raidSettings.voiceTemplate}
                  placeholder={DEFAULT_RAID_TEMPLATE}
                  disabled={!raidSettings.voice}
                  onChange={(e) => updateSettings({ voiceTemplate: e.target.value })}
                  onBlur={() => updateSettings({ voiceTemplate: clean.voiceTemplate })}
                />
              </Field>
            </section>

            {/* ---------- Marco ---------- */}
            <section className="cab-mod">
              <h2>Marco</h2>
              <div className="cab-field">
                <div className="cab-seg" role="group" aria-label="Marco del saludo">
                  {RAID_FRAMES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={raidSettings.frame === item.id}
                      onClick={() => {
                        updateSettings({ frame: item.id });
                        layerRef.current?.test(sampleGreeting('raid', sampleNote));
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
                  <button type="button" className="raid-soon" aria-pressed={false} disabled>
                    Marco subido
                  </button>
                </div>
                <span className="cab-hint">{frame.hint}</span>
              </div>
              <p className="cab-hint">
                «Marco subido» (tu propia imagen, GIF, WebP, SVG o vídeo) llegará cuando las capas puedan leer los
                archivos que subes a tu espacio.
              </p>
            </section>

            {/* ---------- Comandos ---------- */}
            <section className="cab-mod" data-tour="raid-commands">
              <h2>Comandos de moderación</h2>
              <p className="cab-hint">Solo los aceptan el streamer y los moderadores. Escríbelos en el chat de tu canal.</p>
              <div className="raid-cmds">
                {commandFields.map(([key, label, example]) => (
                  <Field key={key} label={label} htmlFor={`${uid}-cmd-${key}`} hint={`En el chat: ${example}`}>
                    <input
                      id={`${uid}-cmd-${key}`}
                      type="text"
                      className="cab-inp cab-mono"
                      maxLength={16}
                      spellCheck={false}
                      autoComplete="off"
                      value={raidSettings.commands[key]}
                      onChange={(e) => updateCommands({ [key]: e.target.value })}
                      onBlur={fixCommands}
                    />
                  </Field>
                ))}
              </div>
              <Field
                label="Espera de cada comando"
                hint="Tiempo entre un uso y el siguiente del mismo comando. Retirar el saludo no tiene espera."
              >
                <Range
                  label="Espera de cada comando"
                  min={RAID_LIMITS.cooldownSec.min}
                  max={120}
                  step={5}
                  value={Math.min(120, clean.cooldownSec)}
                  format={(value) => (value ? `${value} s` : 'Sin espera')}
                  onChange={(cooldownSec) => updateSettings({ cooldownSec })}
                />
              </Field>
              <p className="cab-note">
                Si llega un saludo mientras otro está en pantalla, espera su turno. Como mucho esperan cinco; los demás
                se descartan.
              </p>
            </section>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4" data-tour="raid-monitor">
            <h2>Monitor</h2>
            <div className="cab-stage">
              <RaidLayer ref={layerRef} settings={clean} isStudio onStatus={say} />
            </div>

            <div className="cab-field">
              <span className="cab-label">Qué lo dispara</span>
              <div className="raid-sim">
                {TESTS.map((test) => (
                  <button key={test.kind} type="button" className="cab-btn2 cab-btn-sm" onClick={() => runTest(test.kind, test.log)}>
                    {test.label}
                  </button>
                ))}
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={cut}>
                  Un mod escribe {clean.commands.cut}
                </button>
              </div>
            </div>

            <Field
              label="Probar con un canal o un corto real (opcional)"
              htmlFor={`${uid}-real`}
              hint={
                server.kind === 'ready'
                  ? 'Escribe un canal y pulsa «Llega una raid» o «!so», o pega el enlace de un corto y pulsa «!clip».'
                  : 'Disponible cuando el servidor pueda buscar cortos. Hasta entonces, las pruebas usan datos de ejemplo.'
              }
            >
              <input
                id={`${uid}-real`}
                type="text"
                className="cab-inp"
                spellCheck={false}
                autoComplete="off"
                placeholder="canal o https://clips.twitch.tv/..."
                value={real}
                disabled={server.kind !== 'ready'}
                onChange={(e) => setReal(e.target.value)}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" onClick={() => copyUrl(false)}>
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'url' ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={() => copyUrl(true)}>
                {copied === 'demo' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'demo' ? 'URL copiada' : 'Copiar URL con saludo de muestra'}</span>
              </button>
            </div>
            <p className="cab-hint" role="status">
              {status ||
                (channel
                  ? 'Las pruebas usan datos de ejemplo. La URL con saludo de muestra sirve para colocar la capa en OBS; al terminar, cámbiala por la normal.'
                  : 'Falta tu canal: escríbelo en Inicio antes de copiar la URL.')}
            </p>
          </section>
        </div>
      </div>

      {tourOpen && <GuidedTour steps={RAID_TOUR_STEPS} onClose={() => setTourOpen(false)} id={TOUR_ID} appName="Raids" />}
    </div>
  );
};
