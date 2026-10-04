/**
 * src/pages/MusicStudio.tsx
 *
 * Estudio de la capa «Ahora suena» sobre la plantilla común del panel: a la
 * izquierda se ajusta, a la derecha el monitor 16:9 queda siempre a la vista.
 *
 * - El monitor pinta la capa real (la misma que OBS) con canciones de ejemplo
 *   inventadas y portadas dibujadas con CSS. No hace falta conectar nada.
 * - Cada prueba llega también a las fuentes abiertas en este navegador.
 * - «Mostrar ahora / Ocultar ahora» viaja además con los ajustes, para llegar a
 *   un OBS que esté en otro equipo (con cuenta en la nube).
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { MusicOverlay, type MusicOverlayHandle } from '../components/integraciones/MusicOverlay';
import { Field, Range, Toggle } from '../components/studio/StudioKit';
import { useCloudSession } from '../hooks/useCloudSession';
import { useMusicSettings } from '../hooks/useIntegrationSettings';
import { spotifyStatus } from '../lib/integrationsApi';
import {
  DEFAULT_MUSIC_COMMANDS,
  MUSIC_DESIGNS,
  MUSIC_LIMITS,
  MUSIC_SHOW,
  SIX_POSITIONS,
  encodeMusicSettings,
  normalizeMusicSettings,
  type MusicSettings,
} from '../types/music';
import { loadSettings } from '../types/settings';
import { postBus } from '../utils/bus';
import { SAMPLE_TRACKS, type MusicStep } from '../utils/musicRules';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import '../styles/integraciones.css';

type TestId = 'next' | 'pause' | 'resume' | 'long' | 'stop';
const TESTS: { id: TestId; label: string }[] = [
  { id: 'next', label: 'Cambia la canción' },
  { id: 'pause', label: 'Pausa' },
  { id: 'resume', label: 'Reanuda' },
  { id: 'long', label: 'Canción con título largo' },
  { id: 'stop', label: 'Deja de sonar' },
];
const BACKGROUNDS = [
  { id: 'juego', name: 'Oscuro' },
  { id: 'claro', name: 'Claro' },
  { id: 'ruido', name: 'Muy cargado' },
];

const WHY: Record<'no_music' | 'paused', string> = {
  no_music: 'Ahora no suena nada: no hay canción que mostrar.',
  paused: 'Está en pausa y elegiste que en pausa se oculte. Pulsa «Reanuda».',
};

export const MusicStudio: React.FC = () => {
  const { settings, saved, update } = useMusicSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const [voice] = useState(loadSettings);
  const clean = useMemo(() => normalizeMusicSettings(settings), [settings]);

  const overlay = useRef<MusicOverlayHandle | null>(null);
  const sample = useRef(0);
  const [visible, setVisible] = useState(false);
  const [bg, setBg] = useState('juego');
  const [status, setStatus] = useState('La capa aparece al abrir la página con el diseño guardado.');
  const [copied, setCopied] = useState<'url' | 'demo' | null>(null);
  const [account, setAccount] = useState<string | null>(null);

  // La canción de ejemplo con la que arranca el monitor
  useEffect(() => {
    const track = SAMPLE_TRACKS[0];
    const timer = setTimeout(() => overlay.current?.input({ type: 'song', trackId: track.id }, track, 62000), 80);
    return () => clearTimeout(timer);
  }, []);

  // Estado de la conexión real, solo para decirlo
  useEffect(() => {
    if (!cloud.enabled) return;
    let alive = true;
    spotifyStatus().then((result) => {
      if (!alive) return;
      if (!result.ok) return setAccount(result.message);
      if (!result.data.configured) return setAccount(`Al servidor de Lalo le falta configuración para Spotify (${result.data.missing.join(', ')}).`);
      setAccount(
        result.data.state === 'connected'
          ? `Spotify conectado${result.data.accountName ? ` como ${result.data.accountName}` : ''}: en OBS la capa enseña lo que suena de verdad.`
          : result.data.state === 'expired'
            ? 'El permiso de Spotify caducó: vuelve a conectar en Integraciones.'
            : 'Spotify aún no está conectado: hazlo en Integraciones.'
      );
    });
    return () => {
      alive = false;
    };
  }, [cloud.enabled]);

  const secsText = `${clean.secs} s`;

  const song = (index: number) => {
    sample.current = index;
    const track = SAMPLE_TRACKS[index];
    const was = overlay.current?.state();
    overlay.current?.input({ type: 'song', trackId: track.id }, track, 0);
    postBus({ type: 'MUSIC_TEST', action: 'song', sample: index });
    if (was?.vis) setStatus('Cambio de canción: la capa hace la transición sin salir.');
    else if (clean.show === 'oculto') setStatus('La canción cambió, pero la capa está en «Oculta». Solo aparece con el botón o con el comando.');
    else setStatus(clean.show === 'cambio' ? `Canción nueva: la capa aparece ${secsText}.` : 'Canción nueva.');
  };

  const runTest = (id: TestId) => {
    const layer = overlay.current;
    if (!layer) return;
    if (id === 'next') return song((sample.current + 1) % 3);
    if (id === 'long') return song(3);
    const before = layer.state();
    if (id === 'pause') {
      if (!before.music) return setStatus(WHY.no_music);
      layer.input({ type: 'pause' });
      postBus({ type: 'MUSIC_TEST', action: 'pause' });
      return setStatus(clean.pause === 'ocultar' ? 'Pausa: la capa se oculta.' : before.vis ? 'Pausa: la capa se queda atenuada.' : 'Pausa. La capa no estaba en pantalla.');
    }
    if (id === 'resume') {
      const step = layer.input({ type: 'resume' });
      postBus({ type: 'MUSIC_TEST', action: 'resume' });
      return setStatus(!before.trackId ? WHY.no_music : step.state.vis ? 'Vuelve a sonar.' : 'Vuelve a sonar. La capa sigue oculta.');
    }
    layer.input({ type: 'stop' });
    postBus({ type: 'MUSIC_TEST', action: 'stop' });
    setStatus('Spotify dice que no suena nada: la capa se retira.');
  };

  const shownText = (step: MusicStep, who: string): string => {
    if (step.refused) return `${who}${WHY[step.refused]}`;
    return `${who}${clean.show === 'cambio' ? `la capa aparece ${secsText}.` : 'la capa aparece y se queda.'}`;
  };

  /** El botón del creador en el panel. */
  const liveToggle = () => {
    const layer = overlay.current;
    if (!layer) return;
    const action = layer.state().vis ? 'hide' : 'show';
    const step = layer.input({ type: 'live', action });
    postBus({ type: 'MUSIC_TEST', action });
    // Con los ajustes viaja a las fuentes de OBS de otros equipos
    update({ live: { action, at: Date.now() } });
    setStatus(action === 'hide' ? 'Ocultada desde el panel.' : step.refused ? WHY[step.refused] : 'Mostrada desde el panel.');
  };

  /** Simula a un moderador escribiendo el comando en el chat. */
  const command = (action: 'show' | 'hide') => {
    const step = overlay.current?.input({ type: 'live', action });
    postBus({ type: 'MUSIC_TEST', action });
    if (!step) return;
    setStatus(action === 'hide' ? `${clean.commands.hide}: la capa se retira.` : shownText(step, `${clean.commands.show}: `));
  };

  const channel = voice.channel;
  const copyUrl = async (demo: boolean) => {
    const extra: Record<string, string> = { ms: encodeMusicSettings(clean) };
    if (cloud.profile?.status === 'active') extra.k = cloud.profile.widget_key;
    if (demo) extra.demo = '1';
    try {
      await navigator.clipboard.writeText(buildSuiteWidgetUrl(window.location.origin, 'music', channel, undefined, extra));
      setCopied(demo ? 'demo' : 'url');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setStatus('No se pudo copiar la URL.');
    }
  };

  const set = <K extends keyof MusicSettings>(key: K, value: MusicSettings[K]) => update({ [key]: value } as Partial<MusicSettings>);
  const design = MUSIC_DESIGNS.find((item) => item.id === clean.design) ?? MUSIC_DESIGNS[0];
  const showInfo = MUSIC_SHOW.find((item) => item.id === clean.show) ?? MUSIC_SHOW[0];

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="musica" channel={channel} saved={saved} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid gap-5">
            <section className="cab-mod">
              <h2>Diseño</h2>
              <div className="itg-dz" role="group" aria-label="Diseño de la capa">
                {MUSIC_DESIGNS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={clean.design === item.id}
                    onClick={() => {
                      set('design', item.id);
                      setStatus(`Diseño «${item.name}».`);
                    }}
                  >
                    <b>{item.name}</b>
                    <span>{item.note}</span>
                  </button>
                ))}
              </div>
              <p className="cab-hint">{design.hint}</p>
            </section>

            <section className="cab-mod">
              <h2>Mostrar</h2>
              <div className="cab-seg" role="group" aria-label="Cuándo se muestra">
                {MUSIC_SHOW.map((item) => (
                  <button key={item.id} type="button" aria-pressed={clean.show === item.id} onClick={() => set('show', item.id)}>
                    {item.name}
                  </button>
                ))}
              </div>
              {clean.show === 'cambio' && (
                <Field label="Segundos en pantalla">
                  <Range
                    label="Segundos en pantalla"
                    min={MUSIC_LIMITS.secs.min}
                    max={MUSIC_LIMITS.secs.max}
                    value={clean.secs}
                    format={(value) => `${value} s`}
                    onChange={(secs) => set('secs', secs)}
                  />
                </Field>
              )}
              <p className="cab-hint">{showInfo.hint}</p>
              <Field label="Si pones pausa">
                <div className="cab-seg" role="group" aria-label="Si pones pausa">
                  <button type="button" aria-pressed={clean.pause === 'atenuar'} onClick={() => set('pause', 'atenuar')}>
                    Se queda atenuada
                  </button>
                  <button type="button" aria-pressed={clean.pause === 'ocultar'} onClick={() => set('pause', 'ocultar')}>
                    Se oculta
                  </button>
                </div>
              </Field>
            </section>

            <section className="cab-mod">
              <h2>Posición y tamaño</h2>
              <div className="itg-two">
                <Field label="Posición">
                  <div className="itg-six" role="group" aria-label="Posición">
                    {SIX_POSITIONS.map((item) => (
                      <button key={item.id} type="button" aria-label={item.name} aria-pressed={clean.pos === item.id} onClick={() => set('pos', item.id)} />
                    ))}
                  </div>
                </Field>
                <Field label="Tamaño">
                  <Range
                    label="Tamaño"
                    min={MUSIC_LIMITS.size.min}
                    max={MUSIC_LIMITS.size.max}
                    step={5}
                    value={clean.size}
                    format={(value) => `${value}%`}
                    onChange={(size) => set('size', size)}
                  />
                </Field>
              </div>
            </section>

            <section className="cab-mod">
              <h2>Qué se ve</h2>
              <Toggle label="Portada" checked={settings.art} onChange={(art) => set('art', art)} />
              <Toggle label="Barra de progreso y tiempo" checked={settings.bar} onChange={(bar) => set('bar', bar)} />
              <Toggle label="Artista" checked={settings.artist} onChange={(artist) => set('artist', artist)} />
              <Toggle label="Álbum" checked={settings.album} onChange={(album) => set('album', album)} />
              <Field label="Color de acento">
                <div className="ic-row">
                  <div className="cab-seg" role="group" aria-label="Color de acento">
                    <button type="button" aria-pressed={clean.accent === 'cover'} onClick={() => set('accent', 'cover')}>
                      El de la portada
                    </button>
                    <button type="button" aria-pressed={clean.accent === 'fixed'} onClick={() => set('accent', 'fixed')}>
                      Fijo
                    </button>
                  </div>
                  <input
                    type="color"
                    className="itg-color"
                    aria-label="Color fijo"
                    value={clean.color}
                    disabled={clean.accent !== 'fixed'}
                    onChange={(e) => set('color', e.target.value)}
                  />
                </div>
              </Field>
              <p className="cab-hint">
                El título y el artista de la canción son lo mínimo: sin ellos la capa no tendría sentido. En «Línea» no hay portada. Un archivo local de
                tu equipo sale sin portada, y si la portada no deja leer su color se usa el fijo.
              </p>
            </section>

            <section className="cab-mod">
              <h2>Comandos del chat</h2>
              <p className="cab-hint">Solo los aceptan el streamer y los moderadores. Escríbelos en el chat de tu canal.</p>
              <div className="itg-two">
                <Field label="Mostrar la canción" htmlFor={`${uid}-show`}>
                  <input
                    id={`${uid}-show`}
                    type="text"
                    className="cab-inp cab-mono"
                    maxLength={25}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={DEFAULT_MUSIC_COMMANDS.show}
                    value={settings.commands.show}
                    onChange={(e) => update({ commands: { ...settings.commands, show: e.target.value } })}
                    onBlur={() => update({ commands: clean.commands })}
                  />
                </Field>
                <Field label="Ocultarla" htmlFor={`${uid}-hide`}>
                  <input
                    id={`${uid}-hide`}
                    type="text"
                    className="cab-inp cab-mono"
                    maxLength={25}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={DEFAULT_MUSIC_COMMANDS.hide}
                    value={settings.commands.hide}
                    onChange={(e) => update({ commands: { ...settings.commands, hide: e.target.value } })}
                    onBlur={() => update({ commands: clean.commands })}
                  />
                </Field>
              </div>
              <p className="cab-hint">Los comandos los lee la fuente de OBS que muestra la capa, por el chat de tu canal. No responden en el chat.</p>
            </section>

            <section className="cab-mod">
              <h2>Fuente de OBS</h2>
              <div className="cab-field">
                <Toggle label="Mostrar también en «Todo en uno»" checked={settings.inAll} onChange={(inAll) => set('inAll', inAll)} />
                <span className="cab-hint">La fuente «Ahora suena» la muestra siempre.</span>
              </div>
              <p className="cab-note" role="status">
                {cloud.enabled
                  ? account || 'Comprobando la conexión con Spotify.'
                  : 'La canción real necesita la nube y el servidor de Lalo: sin ellos, la fuente de OBS solo enseña canciones de ejemplo con la URL de muestra. El diseño y los ajustes sí viajan en la URL.'}{' '}
                <a className="studio-link" href="#integraciones">
                  Integraciones
                </a>
              </p>
            </section>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4">
            <h2>Monitor</h2>
            <div className="cab-stage itg-stage" data-bg={bg}>
              <MusicOverlay ref={overlay} settings={clean} onVisible={setVisible} onTimeout={() => setStatus(`Pasaron ${secsText}: la capa se retira hasta la próxima canción.`)} />
            </div>
            <p className="cab-hint" role="status">
              {status}
            </p>

            <div className="cab-field">
              <span className="cab-label">Pruebas</span>
              <div className="itg-tests">
                {TESTS.map((test) => (
                  <button key={test.id} type="button" className="cab-btn2 cab-btn-sm" onClick={() => runTest(test.id)}>
                    {test.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cab-field">
              <span className="cab-label">En directo</span>
              <div className="itg-tests">
                <button type="button" className="cab-btn cab-btn-sm" onClick={liveToggle}>
                  {visible ? 'Ocultar ahora' : 'Mostrar ahora'}
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm itg-cmd" onClick={() => command('show')}>
                  {clean.commands.show}
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm itg-cmd" onClick={() => command('hide')}>
                  {clean.commands.hide}
                </button>
              </div>
              <span className="cab-hint">
                El primer botón es el tuyo: actúa sobre la capa en directo. Los otros dos simulan a un moderador escribiendo el comando en el chat.
              </span>
            </div>

            <Field label="Fondo de la escena">
              <div className="cab-seg" role="group" aria-label="Fondo de la escena">
                {BACKGROUNDS.map((item) => (
                  <button key={item.id} type="button" aria-pressed={bg === item.id} onClick={() => setBg(item.id)}>
                    {item.name}
                  </button>
                ))}
              </div>
            </Field>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" onClick={() => copyUrl(false)}>
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'url' ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={() => copyUrl(true)}>
                {copied === 'demo' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'demo' ? 'URL copiada' : 'Copiar URL con canción de muestra'}</span>
              </button>
            </div>
            <p className="cab-hint">
              Las canciones, los artistas y las portadas de esta página son inventados. El recuadro punteado «Spotify» es el sitio del logotipo oficial:
              la capa lo carga cuando se añade el archivo, y hasta entonces no se dibuja ni se imita.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
