/**
 * src/pages/GameStudio.tsx
 *
 * Página «Alertas de juego» sobre la plantilla común del panel: a la izquierda
 * se ajusta, en pestañas, y a la derecha el monitor 16:9 queda siempre a la vista.
 *
 * - Alertas: cuáles salen en directo, con qué título y con qué emoción las lee
 *   la voz.
 * - En pantalla: posición, tamaño, duración, color y energía de la placa «Grieta».
 * - Voz y sonido: quién anuncia la alerta (nadie, la voz o la mascota), con qué
 *   voz y con qué sonido.
 * - Cada «Probar» reproduce la alerta en el monitor con datos de ejemplo y la
 *   envía a las fuentes de OBS abiertas en este navegador. En el monitor no
 *   suena nada: se ve el movimiento y se lee lo que diría la voz.
 *
 * La cuenta de Riot se vincula en Integraciones. Aquí no se dibuja ningún
 * logotipo de Riot ni de sus juegos.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Copy, Pencil, Play } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, Range, Toggle } from '../components/studio/StudioKit';
import { GameAlertLayer, GameAlertLayerHandle } from '../components/juego/GameAlertLayer';
import { useGameSettings } from '../hooks/useGameSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { useVoiceCatalogue } from '../hooks/useVoiceCatalogue';
import {
  GAME_ALERTS,
  GAME_ANNOUNCERS,
  GAME_COLOR_MODES,
  GAME_EMOTIONS,
  GAME_ENERGIES,
  GAME_GROUPS,
  GAME_LIMITS,
  GAME_POSITIONS,
  GAME_SOUNDS,
  GAME_VOICE_SOURCES,
  GameAlertId,
  GameSound,
  encodeGameSettings,
  normalizeGameSettings,
} from '../types/game';
import { loadPetsSettings } from '../types/pets';
import { loadSettings } from '../types/settings';
import { playAlertAudio } from '../utils/alertsAudio';
import { postBus } from '../utils/bus';
import { stripEmotionTags } from '../utils/emotionMapper';
import { SAMPLE_ALERTS, alertView, announceText } from '../utils/gameAlerts';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import '../styles/juego.css';

type Tab = 'alertas' | 'pantalla' | 'voz';
const TABS: { id: Tab; name: string }[] = [
  { id: 'alertas', name: 'Alertas' },
  { id: 'pantalla', name: 'En pantalla' },
  { id: 'voz', name: 'Voz y sonido' },
];

interface SegProps<T extends string> {
  label: string;
  value: T;
  options: readonly { id: T; name: string }[];
  onChange: (next: T) => void;
}
function Seg<T extends string>({ label, value, options, onChange }: SegProps<T>) {
  return (
    <div className="cab-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.name}
        </button>
      ))}
    </div>
  );
}

export const GameStudio: React.FC = () => {
  const { settings, saved, updateSettings, updateAlert } = useGameSettings();
  const cloud = useCloudSession();
  const voiceList = useVoiceCatalogue();
  const uid = useId();

  const [tab, setTab] = useState<Tab>('alertas');
  const [open, setOpen] = useState<GameAlertId | null>(null);
  const [picked, setPicked] = useState<GameAlertId>('win');
  const [copied, setCopied] = useState<'url' | 'demo' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const layerRef = useRef<GameAlertLayerHandle | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [voice] = useState(loadSettings);
  const [pets] = useState(loadPetsSettings);
  const channel = voice.channel;
  // El monitor usa los ajustes ya validados, igual que los recibirá OBS
  const clean = useMemo(() => normalizeGameSettings(settings), [settings]);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 9000);
  };

  // ---------- Pruebas ----------
  const runTest = (id: GameAlertId) => {
    setPicked(id);
    layerRef.current?.test(id);
    // Las fuentes de OBS abiertas en este navegador la reproducen también, con sonido y voz
    postBus({ type: 'GAME_TEST', alert: id });
  };

  // Lo que diría quien anuncia, sin la etiqueta de emoción
  const announced = (text: string) => {
    const line = stripEmotionTags(text);
    if (clean.announcer === 'nadie') return say('Nadie la anuncia: solo sale en pantalla.');
    say(`${clean.announcer === 'mascota' ? 'La mascota diría' : 'La voz diría'}: «${line}»`);
  };

  // Al abrir, una alerta de ejemplo para ver el movimiento
  useEffect(() => {
    const timer = setTimeout(() => layerRef.current?.test('win'), 600);
    return () => clearTimeout(timer);
  }, []);

  // ---------- URL de OBS ----------
  const copyUrl = (withDemo: boolean) => {
    const tts = loadSettings();
    // Con cuenta va la clave y, de reserva, los ajustes: si la nube no responde, la fuente usa los de la URL
    const extra: Record<string, string> = {
      ...(cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : {}),
      gs: encodeGameSettings(clean),
    };
    if (withDemo) extra.demo = '1';
    const url = buildSuiteWidgetUrl(window.location.origin, 'game', tts.channel, tts, extra);
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(withDemo ? 'demo' : 'url');
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(null), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  const voices = voiceList.catalogue.voices;
  const announcer = GAME_ANNOUNCERS.find((item) => item.id === settings.announcer) ?? GAME_ANNOUNCERS[0];
  const cloudOn = cloud.enabled && cloud.profile?.status === 'active';

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="juego" channel={channel} saved={saved} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid gap-5">
            <div className="gj-tabs" role="tablist" aria-label="Secciones de Alertas de juego">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`${uid}-panel`}
                  onClick={() => setTab(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="grid gap-5">
              {/* ================= Alertas ================= */}
              {tab === 'alertas' && (
                <section className="cab-mod">
                  <h2>Qué alertas salen</h2>
                  <div className="cab-field">
                    <Toggle label="Las alertas de juego salen en directo" checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} />
                    <span className="cab-hint">
                      Apagadas no sale ninguna aunque la fuente esté en OBS. Las pruebas de esta página siguen funcionando. Solo League of Legends, con
                      la cuenta de Riot que vincules en{' '}
                      <a className="studio-link" href="#integraciones">
                        Integraciones
                      </a>
                      .
                    </span>
                  </div>
                  {GAME_GROUPS.map((group) => (
                    <div key={group.id} className="cab-field">
                      <span className="cab-label gj-grp">{group.name}</span>
                      <div className="gj-als">
                        {GAME_ALERTS.filter((item) => item.group === group.id).map((item) => {
                          const alert = settings.alerts[item.id];
                          const isOpen = open === item.id;
                          return (
                            <div key={item.id} className="gj-al">
                              <div className="gj-al-h">
                                <input
                                  type="checkbox"
                                  className="cab-tog"
                                  checked={alert.on}
                                  aria-label={`Mostrar en directo: ${item.name}`}
                                  onChange={(e) => updateAlert(item.id, { on: e.target.checked })}
                                />
                                <div>
                                  <b>{item.name}</b>
                                  <p className="cab-hint">{item.hint}</p>
                                </div>
                                <div className="gj-al-a">
                                  <button
                                    type="button"
                                    className="cab-btn2 cab-btn-sm"
                                    aria-expanded={isOpen}
                                    aria-controls={`${uid}-al-${item.id}`}
                                    onClick={() => {
                                      setOpen(isOpen ? null : item.id);
                                      setPicked(item.id);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                    <span>Editar</span>
                                  </button>
                                  <button type="button" className="cab-btn cab-btn-sm" onClick={() => runTest(item.id)}>
                                    <Play className="h-4 w-4" />
                                    <span>Probar</span>
                                  </button>
                                </div>
                              </div>
                              {isOpen && (
                                <div className="gj-al-b" id={`${uid}-al-${item.id}`}>
                                  <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                                    <Field
                                      label="Título"
                                      htmlFor={`${uid}-title-${item.id}`}
                                      hint={`Vacío vuelve al de serie. Variables: ${item.vars}. Con un título propio, la voz lee ese título.`}
                                    >
                                      <input
                                        id={`${uid}-title-${item.id}`}
                                        type="text"
                                        className="cab-inp"
                                        maxLength={GAME_LIMITS.title}
                                        placeholder={alertView(SAMPLE_ALERTS[item.id], { ...clean, alerts: { ...clean.alerts, [item.id]: { ...clean.alerts[item.id], title: '' } } }).title}
                                        value={alert.title}
                                        onChange={(e) => updateAlert(item.id, { title: e.target.value })}
                                        onBlur={() => updateAlert(item.id, { title: clean.alerts[item.id].title })}
                                      />
                                    </Field>
                                    <Field label="Emoción de la voz" htmlFor={`${uid}-emo-${item.id}`} hint="El tono con el que se lee esta alerta.">
                                      <select
                                        id={`${uid}-emo-${item.id}`}
                                        className="cab-inp"
                                        value={clean.alerts[item.id].emotion}
                                        onChange={(e) => updateAlert(item.id, { emotion: e.target.value })}
                                      >
                                        {GAME_EMOTIONS.map((emotion) => (
                                          <option key={emotion.id} value={emotion.id}>
                                            {emotion.name}
                                          </option>
                                        ))}
                                      </select>
                                    </Field>
                                  </div>
                                  {item.id === 'streak' && (
                                    <Field label="Victorias seguidas para avisar" htmlFor={`${uid}-streak`}>
                                      <input
                                        id={`${uid}-streak`}
                                        type="number"
                                        className="cab-inp"
                                        min={GAME_LIMITS.streakMin.min}
                                        max={GAME_LIMITS.streakMin.max}
                                        value={settings.streakMin}
                                        onChange={(e) => updateSettings({ streakMin: Number(e.target.value) })}
                                        onBlur={() => updateSettings({ streakMin: clean.streakMin })}
                                      />
                                    </Field>
                                  )}
                                  <p className="cab-hint">La voz diría: «{stripEmotionTags(announceText(SAMPLE_ALERTS[item.id], clean))}»</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {/* ================= En pantalla ================= */}
              {tab === 'pantalla' && (
                <>
                  <section className="cab-mod">
                    <h2>Dónde y cuánto se ve</h2>
                    <Field label="Posición">
                      <Seg label="Posición" value={settings.pos} options={GAME_POSITIONS} onChange={(pos) => updateSettings({ pos })} />
                    </Field>
                    <Field label="Tamaño">
                      <Range
                        label="Tamaño"
                        min={GAME_LIMITS.size.min}
                        max={GAME_LIMITS.size.max}
                        step={5}
                        value={clean.size}
                        format={(value) => `${value} %`}
                        onChange={(size) => updateSettings({ size })}
                      />
                    </Field>
                    <Field label="Duración">
                      <Range
                        label="Duración"
                        min={GAME_LIMITS.durationSec.min}
                        max={GAME_LIMITS.durationSec.max}
                        value={clean.durationSec}
                        format={(value) => `${value} s`}
                        onChange={(durationSec) => updateSettings({ durationSec })}
                      />
                    </Field>
                    <div className="cab-field">
                      <Toggle label="Mostrar también en «Todo en uno»" checked={settings.inAll} onChange={(inAll) => updateSettings({ inAll })} />
                      <span className="cab-hint">
                        La fuente «Alertas de juego» las muestra siempre. No actives las dos a la vez en OBS o cada alerta saldrá y sonará dos veces.
                      </span>
                    </div>
                  </section>

                  <section className="cab-mod">
                    <h2>Placa</h2>
                    <Field
                      label="Color"
                      hint="«Según la alerta» usa verde para victorias, rojo para derrotas, dorado para el rango, morado para las jugadas y azul para los avisos."
                    >
                      <div className="gj-color">
                        <Seg label="Modo de color" value={settings.colorMode} options={GAME_COLOR_MODES} onChange={(colorMode) => updateSettings({ colorMode })} />
                        <input
                          type="color"
                          className="cab-inp"
                          aria-label="Color fijo"
                          value={clean.color}
                          onChange={(e) => updateSettings({ color: e.target.value, colorMode: 'fixed' })}
                        />
                      </div>
                    </Field>
                    <Field label="Energía del movimiento" hint="Con «reducir movimiento» activo en el sistema, todo pasa a fundidos.">
                      <Seg
                        label="Energía del movimiento"
                        value={settings.energy}
                        options={GAME_ENERGIES}
                        onChange={(energy) => {
                          updateSettings({ energy });
                          // El monitor recibe el ajuste nuevo en el siguiente pintado
                          setTimeout(() => layerRef.current?.test(picked), 60);
                        }}
                      />
                    </Field>
                    <div className="cab-field">
                      <Toggle label="Mostrar estadísticas" checked={settings.showStats} onChange={(showStats) => updateSettings({ showStats })} />
                    </div>
                    <div className="cab-field">
                      <Toggle label="Mostrar el nombre del juego" checked={settings.showGame} onChange={(showGame) => updateSettings({ showGame })} />
                    </div>
                  </section>
                </>
              )}

              {/* ================= Voz y sonido ================= */}
              {tab === 'voz' && (
                <>
                  <section className="cab-mod">
                    <h2>Quién la anuncia</h2>
                    <div className="cab-field">
                      <Seg label="Quién anuncia" value={settings.announcer} options={GAME_ANNOUNCERS} onChange={(next) => updateSettings({ announcer: next })} />
                      <span className="cab-hint">{announcer.hint}</span>
                    </div>
                    {settings.announcer !== 'nadie' && (
                      <Field
                        label="Con qué voz"
                        hint={
                          settings.announcer === 'mascota'
                            ? 'Cuando la dice la mascota, usa la suya. Esta voz es la de reserva, para la fuente en la que no esté la mascota.'
                            : 'Usa el mismo motor que la Voz del chat. La emoción de cada alerta se elige en «Alertas».'
                        }
                      >
                        <Seg label="Con qué voz" value={settings.voiceSource} options={GAME_VOICE_SOURCES} onChange={(voiceSource) => updateSettings({ voiceSource })} />
                      </Field>
                    )}
                    {settings.announcer !== 'nadie' && settings.voiceSource === 'pet' && (
                      <p className="cab-hint">
                        {pets.voiceId
                          ? `La mascota (${pets.name}) tiene su propia voz: se usa esa.`
                          : `La mascota (${pets.name}) usa la misma que la Voz del chat, así que sonará esa.`}{' '}
                        <a className="studio-link" href="#mascotas">
                          Mascotas
                        </a>
                      </p>
                    )}
                    {settings.announcer !== 'nadie' && settings.voiceSource === 'catalogue' && (
                      <Field label="Voz del catálogo" htmlFor={`${uid}-voice`}>
                        <select id={`${uid}-voice`} className="cab-inp" value={clean.voiceId} onChange={(e) => updateSettings({ voiceId: e.target.value })}>
                          <option value="">La misma que la Voz del chat</option>
                          {voices.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                          {clean.voiceId && !voices.some((item) => item.id === clean.voiceId) && <option value={clean.voiceId}>Voz personalizada</option>}
                        </select>
                      </Field>
                    )}
                  </section>

                  <section className="cab-mod">
                    <h2>Sonido</h2>
                    <Field label="Al salir la placa" htmlFor={`${uid}-sound`} hint="Suena en la fuente de OBS, antes de la voz. Al elegirlo se oye aquí una vez.">
                      <select
                        id={`${uid}-sound`}
                        className="cab-inp"
                        value={clean.sound}
                        onChange={(e) => {
                          const sound = e.target.value as GameSound;
                          updateSettings({ sound });
                          playAlertAudio(sound, clean.soundVolume);
                        }}
                      >
                        {GAME_SOUNDS.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {clean.sound !== 'none' && (
                      <Field label="Volumen">
                        <Range
                          label="Volumen"
                          min={0}
                          max={1}
                          step={0.05}
                          value={clean.soundVolume}
                          format={(value) => `${Math.round(value * 100)} %`}
                          onChange={(soundVolume) => updateSettings({ soundVolume })}
                        />
                      </Field>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4">
            <h2>Monitor</h2>
            <div className="cab-stage">
              <GameAlertLayer ref={layerRef} settings={clean} isStudio rest={picked} onAnnounce={announced} onStatus={say} />
            </div>

            <div className="cab-field">
              <span className="cab-label">Probar una alerta</span>
              <div className="flex flex-wrap gap-2">
                {GAME_ALERTS.map((item) => (
                  <button key={item.id} type="button" className="cab-btn2 cab-btn-sm" aria-pressed={picked === item.id} onClick={() => runTest(item.id)}>
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" onClick={() => copyUrl(false)}>
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'url' ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={() => copyUrl(true)}>
                {copied === 'demo' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'demo' ? 'URL copiada' : 'Copiar URL con alertas de muestra'}</span>
              </button>
            </div>
            <p className="cab-hint" role="status">
              {status ||
                (channel
                  ? 'Las pruebas usan datos de ejemplo. En el monitor no suena nada: el sonido y la voz salen por la fuente de OBS.'
                  : 'Falta tu canal: escríbelo en Inicio antes de copiar la URL.')}
            </p>
            <p className="cab-note">
              {cloudOn
                ? 'Las alertas reales salen de tu cuenta de Riot: vincúlala en «Integraciones». Llegan al terminar la partida o al consultarla, no al instante.'
                : 'Las alertas reales necesitan una cuenta de Lalo con la nube encendida y tu Riot ID vinculado en «Integraciones». Sin eso, la fuente solo enseña las pruebas y las alertas de muestra.'}{' '}
              <a className="studio-link" href="#integraciones">
                Integraciones
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
