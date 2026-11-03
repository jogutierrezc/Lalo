/**
 * src/pages/GameStudio.tsx
 *
 * Ventana «Alertas de juego» de Tally Studio, con pestañas Conexión | Alertas |
 * En pantalla | Voz y sonido. A la derecha, el monitor 16:9, el botón de
 * prueba de cada alerta y la URL de OBS quedan fijos en todas las pestañas.
 *
 * - Conexión: la ficha de Riot Games (Riot ID, permisos, política de uso y el
 *   aviso de no afiliación) y cómo llegan las alertas reales.
 * - Alertas: cuáles salen en directo, con qué título y con qué emoción las lee
 *   la voz.
 * - En pantalla: posición, tamaño, duración, color y energía de la placa «Grieta».
 * - Voz y sonido: quién anuncia la alerta (nadie, la voz o la mascota), con qué
 *   voz y con qué sonido.
 * - Cada «Probar» reproduce la alerta en el monitor con datos de ejemplo y la
 *   envía a las fuentes de OBS abiertas en este navegador. En el monitor no
 *   suena nada: se ve el movimiento y se lee lo que diría la voz.
 *
 * Aquí no se dibuja ningún logotipo de Riot ni de sus juegos.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pencil, Play } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { GameAlertLayer, GameAlertLayerHandle } from '../components/juego/GameAlertLayer';
import { RiotCard } from '../components/integraciones/RiotCard';
import { Ajuste, BotonCopiar, Deslizador, Escenario, Modulo, Nota, Opcion, Pista } from '../components/enpantalla/kit';
import { VentanaPestanas } from '../components/enpantalla/VentanaPestanas';
import { Boton, Segmented, Switch } from '../components/tally-ui';
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

export type GameTab = 'conexion' | 'alertas' | 'pantalla' | 'voz';
export const GAME_TABS: { id: GameTab; label: string }[] = [
  { id: 'conexion', label: 'Conexión' },
  { id: 'alertas', label: 'Alertas' },
  { id: 'pantalla', label: 'En pantalla' },
  { id: 'voz', label: 'Voz y sonido' },
];

interface SegProps<T extends string> {
  label: string;
  value: T;
  options: readonly { id: T; name: string }[];
  onChange: (next: T) => void;
}
function Seg<T extends string>({ label, value, options, onChange }: SegProps<T>) {
  return <Segmented label={label} value={value} options={options.map((option) => ({ value: option.id, label: option.name }))} onChange={onChange} />;
}

export const GameStudio: React.FC = () => {
  const { settings, saved, updateSettings, updateAlert } = useGameSettings();
  const cloud = useCloudSession();
  const voiceList = useVoiceCatalogue();
  const uid = useId();

  const [tab, setTab] = useState<GameTab>('conexion');
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

  const conexion = (
    <>
      <RiotCard enVentana />
      <Nota>
        {cloudOn
          ? 'Las alertas reales salen de tu cuenta de Riot: vincúlala en esta pestaña. Llegan al terminar la partida o al consultarla, no al instante.'
          : 'Las alertas reales necesitan una cuenta de Tally Studio con la nube encendida y tu Riot ID vinculado en esta pestaña. Sin eso, la fuente solo enseña las pruebas y las alertas de muestra.'}
      </Nota>
    </>
  );

  const alertas = (
    <Modulo title="Qué alertas salen">
      <Opcion
        label="Las alertas de juego salen en directo"
        checked={settings.enabled}
        onChange={(enabled) => updateSettings({ enabled })}
        hint={
          <>
            Apagadas no sale ninguna aunque la fuente esté en OBS. Las pruebas de esta página siguen funcionando. Solo League of Legends, con la
            cuenta de Riot que vincules en la pestaña{' '}
            <button type="button" className="ept-link" onClick={() => setTab('conexion')}>
              Conexión
            </button>
            .
          </>
        }
      />
      {GAME_GROUPS.map((group) => (
        <div key={group.id} className="ept-ajuste">
          <h4 className="ept-grp">{group.name}</h4>
          <div className="ept-als">
            {GAME_ALERTS.filter((item) => item.group === group.id).map((item) => {
              const alert = settings.alerts[item.id];
              const isOpen = open === item.id;
              return (
                <div key={item.id} className="ept-al">
                  <div className="ept-al-h">
                    <Switch label={`Mostrar en directo: ${item.name}`} checked={alert.on} onChange={(on) => updateAlert(item.id, { on })} />
                    <div className="ept-al-t">
                      <b>{item.name}</b>
                      <p className="ept-hint">{item.hint}</p>
                    </div>
                    <div className="ept-al-a">
                      <Boton
                        pequeno
                        aria-expanded={isOpen}
                        aria-controls={`${uid}-al-${item.id}`}
                        onClick={() => {
                          setOpen(isOpen ? null : item.id);
                          setPicked(item.id);
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        <span>Editar</span>
                      </Boton>
                      <Boton variante="principal" pequeno onClick={() => runTest(item.id)}>
                        <Play className="h-4 w-4" aria-hidden="true" />
                        <span>Probar</span>
                      </Boton>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="ept-al-b" id={`${uid}-al-${item.id}`}>
                      <div className="ept-two">
                        <Ajuste
                          label="Título"
                          htmlFor={`${uid}-title-${item.id}`}
                          hint={`Vacío vuelve al de serie. Variables: ${item.vars}. Con un título propio, la voz lee ese título.`}
                        >
                          <input
                            id={`${uid}-title-${item.id}`}
                            type="text"
                            className="ept-inp"
                            maxLength={GAME_LIMITS.title}
                            placeholder={alertView(SAMPLE_ALERTS[item.id], { ...clean, alerts: { ...clean.alerts, [item.id]: { ...clean.alerts[item.id], title: '' } } }).title}
                            value={alert.title}
                            onChange={(e) => updateAlert(item.id, { title: e.target.value })}
                            onBlur={() => updateAlert(item.id, { title: clean.alerts[item.id].title })}
                          />
                        </Ajuste>
                        <Ajuste label="Emoción de la voz" htmlFor={`${uid}-emo-${item.id}`} hint="El tono con el que se lee esta alerta.">
                          <select
                            id={`${uid}-emo-${item.id}`}
                            className="ept-inp"
                            value={clean.alerts[item.id].emotion}
                            onChange={(e) => updateAlert(item.id, { emotion: e.target.value })}
                          >
                            {GAME_EMOTIONS.map((emotion) => (
                              <option key={emotion.id} value={emotion.id}>
                                {emotion.name}
                              </option>
                            ))}
                          </select>
                        </Ajuste>
                      </div>
                      {item.id === 'streak' && (
                        <Ajuste label="Victorias seguidas para avisar" htmlFor={`${uid}-streak`}>
                          <input
                            id={`${uid}-streak`}
                            type="number"
                            className="ept-inp"
                            min={GAME_LIMITS.streakMin.min}
                            max={GAME_LIMITS.streakMin.max}
                            value={settings.streakMin}
                            onChange={(e) => updateSettings({ streakMin: Number(e.target.value) })}
                            onBlur={() => updateSettings({ streakMin: clean.streakMin })}
                          />
                        </Ajuste>
                      )}
                      <Pista>La voz diría: «{stripEmotionTags(announceText(SAMPLE_ALERTS[item.id], clean))}»</Pista>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Modulo>
  );

  const pantalla = (
    <>
      <Modulo title="Dónde y cuánto se ve">
        <Ajuste label="Posición">
          <Seg label="Posición" value={settings.pos} options={GAME_POSITIONS} onChange={(pos) => updateSettings({ pos })} />
        </Ajuste>
        <div className="ept-two">
          <Deslizador
            label="Tamaño"
            min={GAME_LIMITS.size.min}
            max={GAME_LIMITS.size.max}
            step={5}
            value={clean.size}
            format={(value) => `${value} %`}
            onChange={(size) => updateSettings({ size })}
          />
          <Deslizador
            label="Duración"
            min={GAME_LIMITS.durationSec.min}
            max={GAME_LIMITS.durationSec.max}
            value={clean.durationSec}
            format={(value) => `${value} s`}
            onChange={(durationSec) => updateSettings({ durationSec })}
          />
        </div>
        <Opcion
          label="Mostrar también en «Todo en uno»"
          checked={settings.inAll}
          onChange={(inAll) => updateSettings({ inAll })}
          hint="La fuente «Alertas de juego» las muestra siempre. No actives las dos a la vez en OBS o cada alerta saldrá y sonará dos veces."
        />
      </Modulo>

      <Modulo title="Placa">
        <Ajuste
          label="Color"
          hint="«Según la alerta» usa verde para victorias, rojo para derrotas, dorado para el rango, morado para las jugadas y azul para los avisos."
        >
          <div className="ept-fila">
            <Seg label="Modo de color" value={settings.colorMode} options={GAME_COLOR_MODES} onChange={(colorMode) => updateSettings({ colorMode })} />
            <input
              type="color"
              className="ept-color"
              aria-label="Color fijo"
              value={clean.color}
              onChange={(e) => updateSettings({ color: e.target.value, colorMode: 'fixed' })}
            />
          </div>
        </Ajuste>
        <Ajuste label="Energía del movimiento" hint="Con «reducir movimiento» activo en el sistema, todo pasa a fundidos.">
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
        </Ajuste>
        <Opcion label="Mostrar estadísticas" checked={settings.showStats} onChange={(showStats) => updateSettings({ showStats })} />
        <Opcion label="Mostrar el nombre del juego" checked={settings.showGame} onChange={(showGame) => updateSettings({ showGame })} />
      </Modulo>
    </>
  );

  const vozYSonido = (
    <>
      <Modulo title="Quién la anuncia">
        <Ajuste label="Quién anuncia" hint={announcer.hint}>
          <Seg label="Quién anuncia" value={settings.announcer} options={GAME_ANNOUNCERS} onChange={(next) => updateSettings({ announcer: next })} />
        </Ajuste>
        {settings.announcer !== 'nadie' && (
          <Ajuste
            label="Con qué voz"
            hint={
              settings.announcer === 'mascota'
                ? 'Cuando la dice la mascota, usa la suya. Esta voz es la de reserva, para la fuente en la que no esté la mascota.'
                : 'Usa el mismo motor que la Voz del chat. La emoción de cada alerta se elige en «Alertas».'
            }
          >
            <Seg label="Con qué voz" value={settings.voiceSource} options={GAME_VOICE_SOURCES} onChange={(voiceSource) => updateSettings({ voiceSource })} />
          </Ajuste>
        )}
        {settings.announcer !== 'nadie' && settings.voiceSource === 'pet' && (
          <Pista>
            {pets.voiceId
              ? `La mascota (${pets.name}) tiene su propia voz: se usa esa.`
              : `La mascota (${pets.name}) usa la misma que la Voz del chat, así que sonará esa.`}{' '}
            <a className="ept-link" href="#mascotas">
              Mascotas
            </a>
          </Pista>
        )}
        {settings.announcer !== 'nadie' && settings.voiceSource === 'catalogue' && (
          <Ajuste label="Voz del catálogo" htmlFor={`${uid}-voice`}>
            <select id={`${uid}-voice`} className="ept-inp" value={clean.voiceId} onChange={(e) => updateSettings({ voiceId: e.target.value })}>
              <option value="">La misma que la Voz del chat</option>
              {voices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {clean.voiceId && !voices.some((item) => item.id === clean.voiceId) && <option value={clean.voiceId}>Voz personalizada</option>}
            </select>
          </Ajuste>
        )}
      </Modulo>

      <Modulo title="Sonido">
        <Ajuste label="Al salir la placa" htmlFor={`${uid}-sound`} hint="Suena en la fuente de OBS, antes de la voz. Al elegirlo se oye aquí una vez.">
          <select
            id={`${uid}-sound`}
            className="ept-inp"
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
        </Ajuste>
        {clean.sound !== 'none' && (
          <Deslizador
            label="Volumen"
            min={0}
            max={1}
            step={0.05}
            value={clean.soundVolume}
            format={(value) => `${Math.round(value * 100)} %`}
            onChange={(soundVolume) => updateSettings({ soundVolume })}
          />
        )}
      </Modulo>
    </>
  );

  const fijo = (
    <Modulo title="Monitor">
      <Escenario>
        <GameAlertLayer ref={layerRef} settings={clean} isStudio rest={picked} onAnnounce={announced} onStatus={say} />
      </Escenario>

      <Ajuste label="Probar una alerta">
        <div className="ept-btns">
          {GAME_ALERTS.map((item) => (
            <Boton key={item.id} pequeno aria-pressed={picked === item.id} onClick={() => runTest(item.id)}>
              {item.name}
            </Boton>
          ))}
        </div>
      </Ajuste>

      <div className="ept-btns">
        <BotonCopiar principal copiado={copied === 'url'} texto="Copiar URL para OBS" textoCopiado="URL copiada" onClick={() => copyUrl(false)} />
        <BotonCopiar copiado={copied === 'demo'} texto="Copiar URL con alertas de muestra" textoCopiado="URL copiada" onClick={() => copyUrl(true)} />
      </div>
      <Pista role="status">
        {status ||
          (channel
            ? 'Las pruebas usan datos de ejemplo. En el monitor no suena nada: el sonido y la voz salen por la fuente de OBS.'
            : 'Falta tu canal: escríbelo en Inicio antes de copiar la URL.')}
      </Pista>
    </Modulo>
  );

  return (
    <VentanaPestanas
      idBase="juego"
      etiqueta="Secciones de Alertas de juego"
      barra={<SuiteNav currentApp="juego" channel={channel} saved={saved} />}
      tabs={GAME_TABS}
      value={tab}
      onChange={(id) => setTab(id as GameTab)}
      paneles={{ conexion, alertas, pantalla, voz: vozYSonido }}
      fijo={fijo}
    />
  );
};
