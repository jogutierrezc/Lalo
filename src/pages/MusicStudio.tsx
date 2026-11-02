/**
 * src/pages/MusicStudio.tsx
 *
 * Ventana «Ahora suena» de Tally Studio, con pestañas Ajustes | Apariencia. El
 * monitor 16:9, las pruebas, «Mostrar ahora / Ocultar ahora», el fondo de la
 * escena y las URLs de OBS forman el panel fijo de la derecha, visible en las
 * dos pestañas.
 *
 * - Apariencia: diseño, posición y tamaño, y qué se ve.
 * - Ajustes: cuándo se muestra, comandos del chat y fuente de OBS.
 * - El monitor pinta la capa real (la misma que OBS) con canciones de ejemplo
 *   inventadas y portadas dibujadas con CSS. No hace falta conectar nada.
 * - Cada prueba llega también a las fuentes abiertas en este navegador.
 * - «Mostrar ahora / Ocultar ahora» viaja además con los ajustes, para llegar a
 *   un OBS que esté en otro equipo (con cuenta en la nube).
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SuiteNav } from '../components/SuiteNav';
import { MusicOverlay, type MusicOverlayHandle } from '../components/integraciones/MusicOverlay';
import { Ajuste, BotonCopiar, Deslizador, Escenario, Modulo, Nota, Opcion, Pista } from '../components/enpantalla/kit';
import { VentanaPestanas } from '../components/enpantalla/VentanaPestanas';
import { Boton, Segmented } from '../components/tally-ui';
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
  { value: 'juego', label: 'Oscuro' },
  { value: 'claro', label: 'Claro' },
  { value: 'ruido', label: 'Muy cargado' },
];

export type MusicTab = 'ajustes' | 'apariencia';
export const MUSIC_TABS: { id: MusicTab; label: string }[] = [
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'apariencia', label: 'Apariencia' },
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
  const [tab, setTab] = useState<MusicTab>('ajustes');
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

  const apariencia = (
    <>
      <Modulo title="Diseño">
        <div className="ept-dz" role="group" aria-label="Diseño de la capa">
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
        <Pista>{design.hint}</Pista>
      </Modulo>

      <Modulo title="Posición y tamaño">
        <div className="ept-two">
          <Ajuste label="Posición">
            <div className="ept-six" role="group" aria-label="Posición">
              {SIX_POSITIONS.map((item) => (
                <button key={item.id} type="button" aria-label={item.name} aria-pressed={clean.pos === item.id} onClick={() => set('pos', item.id)} />
              ))}
            </div>
          </Ajuste>
          <Deslizador
            label="Tamaño"
            min={MUSIC_LIMITS.size.min}
            max={MUSIC_LIMITS.size.max}
            step={5}
            value={clean.size}
            format={(value) => `${value}%`}
            onChange={(size) => set('size', size)}
          />
        </div>
      </Modulo>

      <Modulo title="Qué se ve">
        <Opcion label="Portada" checked={settings.art} onChange={(art) => set('art', art)} />
        <Opcion label="Barra de progreso y tiempo" checked={settings.bar} onChange={(bar) => set('bar', bar)} />
        <Opcion label="Artista" checked={settings.artist} onChange={(artist) => set('artist', artist)} />
        <Opcion label="Álbum" checked={settings.album} onChange={(album) => set('album', album)} />
        <Ajuste label="Color de acento">
          <div className="ept-fila">
            <Segmented
              label="Color de acento"
              value={clean.accent}
              options={[
                { value: 'cover', label: 'El de la portada' },
                { value: 'fixed', label: 'Fijo' },
              ]}
              onChange={(accent) => set('accent', accent)}
            />
            <input
              type="color"
              className="ept-color"
              aria-label="Color fijo"
              value={clean.color}
              disabled={clean.accent !== 'fixed'}
              onChange={(e) => set('color', e.target.value)}
            />
          </div>
        </Ajuste>
        <Pista>
          El título y el artista de la canción son lo mínimo: sin ellos la capa no tendría sentido. En «Línea» no hay portada. Un archivo local de tu
          equipo sale sin portada, y si la portada no deja leer su color se usa el fijo.
        </Pista>
      </Modulo>
    </>
  );

  const ajustes = (
    <>
      <Modulo title="Mostrar">
        <Ajuste label="Cuándo se muestra" hint={showInfo.hint}>
          <Segmented
            label="Cuándo se muestra"
            value={clean.show}
            options={MUSIC_SHOW.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(show) => set('show', show)}
          />
        </Ajuste>
        {clean.show === 'cambio' && (
          <Deslizador
            label="Segundos en pantalla"
            min={MUSIC_LIMITS.secs.min}
            max={MUSIC_LIMITS.secs.max}
            value={clean.secs}
            format={(value) => `${value} s`}
            onChange={(secs) => set('secs', secs)}
          />
        )}
        <Ajuste label="Si pones pausa">
          <Segmented
            label="Si pones pausa"
            value={clean.pause}
            options={[
              { value: 'atenuar', label: 'Se queda atenuada' },
              { value: 'ocultar', label: 'Se oculta' },
            ]}
            onChange={(pause) => set('pause', pause)}
          />
        </Ajuste>
      </Modulo>

      <Modulo title="Comandos del chat">
        <Pista>Solo los aceptan el streamer y los moderadores. Escríbelos en el chat de tu canal.</Pista>
        <div className="ept-two">
          <Ajuste label="Mostrar la canción" htmlFor={`${uid}-show`}>
            <input
              id={`${uid}-show`}
              type="text"
              className="ept-inp ept-mono"
              maxLength={25}
              spellCheck={false}
              autoComplete="off"
              placeholder={DEFAULT_MUSIC_COMMANDS.show}
              value={settings.commands.show}
              onChange={(e) => update({ commands: { ...settings.commands, show: e.target.value } })}
              onBlur={() => update({ commands: clean.commands })}
            />
          </Ajuste>
          <Ajuste label="Ocultarla" htmlFor={`${uid}-hide`}>
            <input
              id={`${uid}-hide`}
              type="text"
              className="ept-inp ept-mono"
              maxLength={25}
              spellCheck={false}
              autoComplete="off"
              placeholder={DEFAULT_MUSIC_COMMANDS.hide}
              value={settings.commands.hide}
              onChange={(e) => update({ commands: { ...settings.commands, hide: e.target.value } })}
              onBlur={() => update({ commands: clean.commands })}
            />
          </Ajuste>
        </div>
        <Pista>Los comandos los lee la fuente de OBS que muestra la capa, por el chat de tu canal. No responden en el chat.</Pista>
      </Modulo>

      <Modulo title="Fuente de OBS">
        <Opcion
          label="Mostrar también en «Todo en uno»"
          checked={settings.inAll}
          onChange={(inAll) => set('inAll', inAll)}
          hint="La fuente «Ahora suena» la muestra siempre."
        />
        <Nota role="status">
          {cloud.enabled
            ? account || 'Comprobando la conexión con Spotify.'
            : 'La canción real necesita la nube y el servidor de Lalo: sin ellos, la fuente de OBS solo enseña canciones de ejemplo con la URL de muestra. El diseño y los ajustes sí viajan en la URL.'}{' '}
          <a className="ept-link" href="#integraciones">
            Integraciones
          </a>
        </Nota>
      </Modulo>
    </>
  );

  const fijo = (
    <Modulo title="Monitor">
      <Escenario className="itg-stage" data-bg={bg}>
        <MusicOverlay ref={overlay} settings={clean} onVisible={setVisible} onTimeout={() => setStatus(`Pasaron ${secsText}: la capa se retira hasta la próxima canción.`)} />
      </Escenario>
      <Pista role="status">{status}</Pista>

      <Ajuste label="Pruebas">
        <div className="ept-btns">
          {TESTS.map((test) => (
            <Boton key={test.id} pequeno onClick={() => runTest(test.id)}>
              {test.label}
            </Boton>
          ))}
        </div>
      </Ajuste>

      <Ajuste
        label="En directo"
        hint="El primer botón es el tuyo: actúa sobre la capa en directo. Los otros dos simulan a un moderador escribiendo el comando en el chat."
      >
        <div className="ept-btns">
          <Boton variante="principal" pequeno onClick={liveToggle}>
            {visible ? 'Ocultar ahora' : 'Mostrar ahora'}
          </Boton>
          <Boton pequeno className="ept-mono" onClick={() => command('show')}>
            {clean.commands.show}
          </Boton>
          <Boton pequeno className="ept-mono" onClick={() => command('hide')}>
            {clean.commands.hide}
          </Boton>
        </div>
      </Ajuste>

      <Ajuste label="Fondo de la escena">
        <Segmented label="Fondo de la escena" value={bg} options={BACKGROUNDS} onChange={setBg} />
      </Ajuste>

      <div className="ept-btns">
        <BotonCopiar principal copiado={copied === 'url'} texto="Copiar URL para OBS" textoCopiado="URL copiada" onClick={() => copyUrl(false)} />
        <BotonCopiar copiado={copied === 'demo'} texto="Copiar URL con canción de muestra" textoCopiado="URL copiada" onClick={() => copyUrl(true)} />
      </div>
      <Pista>
        Las canciones, los artistas y las portadas de esta página son inventados. El recuadro punteado «Spotify» es el sitio del logotipo oficial: la
        capa lo carga cuando se añade el archivo, y hasta entonces no se dibuja ni se imita.
      </Pista>
    </Modulo>
  );

  return (
    <VentanaPestanas
      idBase="musica"
      etiqueta="Secciones de Ahora suena"
      barra={<SuiteNav currentApp="musica" channel={channel} saved={saved} />}
      tabs={MUSIC_TABS}
      value={tab}
      onChange={(id) => setTab(id as MusicTab)}
      paneles={{ ajustes, apariencia }}
      fijo={fijo}
    />
  );
};
