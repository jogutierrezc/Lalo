/**
 * src/pages/PetsStudio.tsx
 *
 * Página «Mascotas» sobre la plantilla común del panel: a la izquierda se
 * ajusta, en pestañas, y a la derecha el monitor 16:9 queda siempre a la vista.
 *
 * - Personaje: uno de los de Lalo (con color) o el propio, con una imagen en
 *   reposo y otra hablando. Nombre y voz.
 * - Activadores: a qué reacciona, con qué frases y cada cuánto.
 * - En pantalla: dónde sale, cómo se mueve y cómo se ve el texto.
 * - Cada «Probar» reproduce la reacción en el monitor con datos de ejemplo y la
 *   envía a las fuentes de OBS abiertas en este navegador. En el monitor la voz
 *   no suena: se ve el movimiento y el texto.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Copy, Pencil, Play } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, Range, Toggle } from '../components/studio/StudioKit';
import { MediaField, MediaValue } from '../components/recompensas/MediaField';
import { PetFigure } from '../components/mascotas/PetFigure';
import { PetLayer, PetLayerHandle } from '../components/mascotas/PetLayer';
import { usePetsSettings } from '../hooks/usePetsSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { useVoiceCatalogue } from '../hooks/useVoiceCatalogue';
import { releaseMedia, resolveMediaUrl } from '../lib/mediaRef';
import {
  PET_BUBBLES,
  PET_COLORS,
  PET_ENTERS,
  PET_FXS,
  PET_IDLES,
  PET_KINDS,
  PET_LIMITS,
  PET_POSITIONS,
  PET_STAYS,
  PET_TRIGGERS,
  PET_TURNS,
  PetImage,
  PetTriggerId,
  encodePetsSettings,
  normalizePetsSettings,
} from '../types/pets';
import { loadSettings } from '../types/settings';
import { postBus } from '../utils/bus';
import { SAMPLE_CUES } from '../utils/petsLogic';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import '../styles/mascotas.css';

type Tab = 'personaje' | 'activadores' | 'pantalla';
const TABS: { id: Tab; name: string }[] = [
  { id: 'personaje', name: 'Personaje' },
  { id: 'activadores', name: 'Activadores' },
  { id: 'pantalla', name: 'En pantalla' },
];
const IMAGE_TYPES = 'image/png,image/gif,image/webp,image/svg+xml';

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

const toImage = (next: MediaValue): PetImage => ({ url: next.url ?? '', name: next.name ?? '', mediaId: next.mediaId ?? '' });
const toValue = (image: PetImage | null): MediaValue =>
  image ? { url: image.url, name: image.name, mediaId: image.mediaId || undefined } : {};

export const PetsStudio: React.FC = () => {
  const { settings, saved, updateSettings, updateTrigger } = usePetsSettings();
  const cloud = useCloudSession();
  const voiceList = useVoiceCatalogue();
  const uid = useId();

  const [tab, setTab] = useState<Tab>('personaje');
  const [open, setOpen] = useState<PetTriggerId | null>(null);
  const [copied, setCopied] = useState<'url' | 'demo' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const layerRef = useRef<PetLayerHandle | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [voice] = useState(loadSettings);
  const channel = voice.channel;
  // El monitor usa los ajustes ya validados, igual que los recibirá OBS
  const clean = useMemo(() => normalizePetsSettings(settings), [settings]);
  const cloudOn = cloud.enabled && cloud.profile?.status === 'active';

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
    statusTimer.current = setTimeout(() => setStatus(null), 7000);
  };

  // ---------- Pruebas ----------
  const runTest = (id: PetTriggerId) => {
    layerRef.current?.test(SAMPLE_CUES[id]);
    // Las fuentes de OBS abiertas en este navegador la reproducen también, con voz
    postBus({ type: 'PETS_TEST', trigger: id });
  };

  // Al abrir, una reacción de ejemplo para que el monitor no esté vacío
  useEffect(() => {
    const timer = setTimeout(() => layerRef.current?.test(SAMPLE_CUES.points), 600);
    return () => clearTimeout(timer);
  }, []);

  // ---------- Personaje propio ----------
  const release = (mediaId: string) => void releaseMedia(mediaId);
  const setIdleImage = (next: MediaValue | null) => {
    if (next?.url) {
      updateSettings({ idleImage: toImage(next), kind: 'custom' });
      return;
    }
    // Sin imagen de reposo no hay personaje propio: se vuelve a uno de Lalo
    if (settings.talkImage?.mediaId) release(settings.talkImage.mediaId);
    updateSettings({ idleImage: null, talkImage: null, kind: settings.kind === 'custom' ? 'chispa' : settings.kind });
  };
  const setTalkImage = (next: MediaValue | null) => updateSettings({ talkImage: next?.url ? toImage(next) : null });

  // ---------- URL de OBS ----------
  const copyUrl = (withDemo: boolean) => {
    const tts = loadSettings();
    // Con cuenta va la clave y, de reserva, los ajustes: si la nube no responde, la fuente usa los de la URL
    const extra: Record<string, string> = {
      ...(cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : {}),
      ps: encodePetsSettings(clean),
    };
    if (withDemo) extra.demo = '1';
    const url = buildSuiteWidgetUrl(window.location.origin, 'pets', tts.channel, tts, extra);
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(withDemo ? 'demo' : 'url');
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(null), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  const idleUrl = settings.idleImage ? resolveMediaUrl(settings.idleImage.url) || undefined : undefined;
  const turn = PET_TURNS.find((item) => item.id === settings.turn) ?? PET_TURNS[0];
  const voices = voiceList.catalogue.voices;

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="mascotas" channel={channel} saved={saved} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid gap-5">
            <div className="pt-tabs" role="tablist" aria-label="Secciones de Mascotas">
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
              {/* ================= Personaje ================= */}
              {tab === 'personaje' && (
                <>
                  <section className="cab-mod">
                    <h2>Personaje</h2>
                    <div className="cab-field">
                      <Toggle label="La mascota reacciona en directo" checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} />
                      <span className="cab-hint">Apagada no hace nada aunque esté en OBS. Las pruebas de esta página siguen funcionando.</span>
                    </div>
                    <div className="cab-field">
                      <span className="cab-label">Personajes de Lalo</span>
                      <div className="pt-gal">
                        {PET_KINDS.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={settings.kind === item.id}
                            onClick={() => {
                              // El nombre sigue al personaje mientras sea el de serie
                              const stock = PET_KINDS.some((kind) => kind.name === settings.name);
                              updateSettings({ kind: item.id, ...(stock ? { name: item.name } : {}) });
                            }}
                          >
                            <PetFigure kind={item.id} color={clean.color} />
                            {item.name}
                          </button>
                        ))}
                        {idleUrl && (
                          <button type="button" aria-pressed={settings.kind === 'custom'} onClick={() => updateSettings({ kind: 'custom' })}>
                            <PetFigure kind="custom" color={clean.color} idleUrl={idleUrl} />
                            El tuyo
                          </button>
                        )}
                      </div>
                      <span className="cab-hint">Son figuras de muestra, con ojos y boca animados. El arte final de la galería se dibuja aparte.</span>
                    </div>
                    <div className="cab-field">
                      <span className="cab-label" id={`${uid}-color`}>
                        Color
                      </span>
                      <div className="pt-sw" role="group" aria-labelledby={`${uid}-color`}>
                        {PET_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            style={{ background: color }}
                            aria-pressed={clean.color === color}
                            aria-label={`Color ${color}`}
                            onClick={() => updateSettings({ color })}
                          />
                        ))}
                      </div>
                      <span className="cab-hint">Tiñe a los personajes de Lalo, las chispas y la etiqueta del rótulo.</span>
                    </div>
                  </section>

                  <section className="cab-mod">
                    <h2>Tu propio personaje</h2>
                    <p className="cab-hint">
                      PNG, GIF, WebP o SVG con fondo transparente. Con una sola imagen, el personaje se mueve al hablar. Con dos, Lalo
                      las alterna al ritmo de la voz; si la de hablar es un GIF, se ve mientras dure la frase.
                    </p>
                    <Field label="En reposo">
                      <MediaField
                        id={`${uid}-idle`}
                        accept={IMAGE_TYPES}
                        value={toValue(settings.idleImage)}
                        cloudOn={cloudOn}
                        emptyHint="Sin imagen: se usa un personaje de Lalo."
                        onChange={setIdleImage}
                        onRelease={release}
                      />
                    </Field>
                    {settings.idleImage && (
                      <Field label="Hablando (opcional)">
                        <MediaField
                          id={`${uid}-talk`}
                          accept={IMAGE_TYPES}
                          value={toValue(settings.talkImage)}
                          cloudOn={cloudOn}
                          emptyHint="Sin imagen de hablar: el personaje se mueve con la voz."
                          onChange={setTalkImage}
                          onRelease={release}
                        />
                      </Field>
                    )}
                  </section>

                  <section className="cab-mod">
                    <h2>Nombre y voz</h2>
                    <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                      <Field label="Nombre" htmlFor={`${uid}-name`} hint="Sale en el texto y sirve para llamarla en el chat.">
                        <input
                          id={`${uid}-name`}
                          type="text"
                          className="cab-inp"
                          maxLength={PET_LIMITS.name}
                          value={settings.name}
                          onChange={(e) => updateSettings({ name: e.target.value })}
                          onBlur={() => updateSettings({ name: clean.name })}
                        />
                      </Field>
                      <Field
                        label="Voz"
                        htmlFor={`${uid}-voice`}
                        hint="Con una voz distinta, el chat distingue quién habla. Usa el mismo motor que la Voz del chat."
                      >
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
                    </div>
                  </section>
                </>
              )}

              {/* ================= Activadores ================= */}
              {tab === 'activadores' && (
                <>
                  <section className="cab-mod">
                    <h2>Cuándo reacciona</h2>
                    <div className="pt-trs">
                      {PET_TRIGGERS.map((item) => {
                        const trigger = settings.triggers[item.id];
                        const isOpen = open === item.id;
                        return (
                          <div key={item.id} className="pt-tr">
                            <div className="pt-tr-h">
                              <input
                                type="checkbox"
                                className="cab-tog"
                                checked={trigger.on}
                                aria-label={`Activar: ${item.name}`}
                                onChange={(e) => updateTrigger(item.id, { on: e.target.checked })}
                              />
                              <div>
                                <b>{item.name}</b>
                                <p className="cab-hint">{item.hint}</p>
                              </div>
                              <div className="pt-tr-a">
                                <button
                                  type="button"
                                  className="cab-btn2 cab-btn-sm"
                                  aria-expanded={isOpen}
                                  aria-controls={`${uid}-tr-${item.id}`}
                                  onClick={() => setOpen(isOpen ? null : item.id)}
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
                              <div className="pt-tr-b" id={`${uid}-tr-${item.id}`}>
                                <Field
                                  label="Frases"
                                  htmlFor={`${uid}-lines-${item.id}`}
                                  hint={`Una por línea; la mascota elige una al azar.${item.vars ? ` Variables: ${item.vars} {nombre}` : ''}`}
                                >
                                  <textarea
                                    id={`${uid}-lines-${item.id}`}
                                    className="cab-inp"
                                    rows={3}
                                    value={trigger.lines.join('\n')}
                                    onChange={(e) => updateTrigger(item.id, { lines: e.target.value.split('\n') })}
                                    onBlur={() => updateTrigger(item.id, { lines: clean.triggers[item.id].lines })}
                                  />
                                </Field>
                                <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                                  <Field label="Espera entre reacciones (s)" htmlFor={`${uid}-cd-${item.id}`}>
                                    <input
                                      id={`${uid}-cd-${item.id}`}
                                      type="number"
                                      className="cab-inp"
                                      min={PET_LIMITS.cooldownSec.min}
                                      max={PET_LIMITS.cooldownSec.max}
                                      value={trigger.cooldownSec}
                                      onChange={(e) => updateTrigger(item.id, { cooldownSec: Number(e.target.value) })}
                                      onBlur={() => updateTrigger(item.id, { cooldownSec: clean.triggers[item.id].cooldownSec })}
                                    />
                                  </Field>
                                  {item.id === 'bits' && (
                                    <Field label="Bits mínimos" htmlFor={`${uid}-minbits`}>
                                      <input
                                        id={`${uid}-minbits`}
                                        type="number"
                                        className="cab-inp"
                                        min={PET_LIMITS.minBits.min}
                                        max={PET_LIMITS.minBits.max}
                                        value={settings.minBits}
                                        onChange={(e) => updateSettings({ minBits: Number(e.target.value) })}
                                        onBlur={() => updateSettings({ minBits: clean.minBits })}
                                      />
                                    </Field>
                                  )}
                                  {item.id === 'mention' && (
                                    <Field label="Comando" htmlFor={`${uid}-cmd`} hint={`En el chat: ${clean.command} o su nombre, ${clean.name}.`}>
                                      <input
                                        id={`${uid}-cmd`}
                                        type="text"
                                        className="cab-inp cab-mono"
                                        maxLength={16}
                                        spellCheck={false}
                                        autoComplete="off"
                                        value={settings.command}
                                        onChange={(e) => updateSettings({ command: e.target.value })}
                                        onBlur={() => updateSettings({ command: clean.command })}
                                      />
                                    </Field>
                                  )}
                                  {item.id === 'quiet' && (
                                    <Field label="Minutos sin mensajes" htmlFor={`${uid}-quiet`}>
                                      <input
                                        id={`${uid}-quiet`}
                                        type="number"
                                        className="cab-inp"
                                        min={PET_LIMITS.quietMinutes.min}
                                        max={PET_LIMITS.quietMinutes.max}
                                        value={settings.quietMinutes}
                                        onChange={(e) => updateSettings({ quietMinutes: Number(e.target.value) })}
                                        onBlur={() => updateSettings({ quietMinutes: clean.quietMinutes })}
                                      />
                                    </Field>
                                  )}
                                </div>
                                {item.id === 'points' && (
                                  <div className="cab-field">
                                    <Toggle
                                      label="No anunciar los canjes que piden texto"
                                      checked={settings.skipTextRedemptions}
                                      onChange={(skipTextRedemptions) => updateSettings({ skipTextRedemptions })}
                                    />
                                    <span className="cab-hint">Esos canjes ya los lee la Voz del chat; así no se oyen dos veces.</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="cab-mod">
                    <h2>Turnos con la Voz del chat</h2>
                    <div className="cab-field">
                      <Seg label="Turno de la mascota" value={settings.turn} options={PET_TURNS} onChange={(next) => updateSettings({ turn: next })} />
                      <span className="cab-hint">{turn.hint}</span>
                    </div>
                  </section>
                </>
              )}

              {/* ================= En pantalla ================= */}
              {tab === 'pantalla' && (
                <>
                  <section className="cab-mod">
                    <h2>Dónde y cuándo se ve</h2>
                    <Field label="Posición">
                      <Seg label="Posición" value={settings.pos} options={PET_POSITIONS} onChange={(pos) => updateSettings({ pos })} />
                    </Field>
                    <Field label="Presencia">
                      <Seg label="Presencia" value={settings.stay} options={PET_STAYS} onChange={(stay) => updateSettings({ stay })} />
                    </Field>
                    <Field label="Tamaño">
                      <Range
                        label="Tamaño"
                        min={PET_LIMITS.size.min}
                        max={PET_LIMITS.size.max}
                        step={0.5}
                        value={clean.size}
                        format={(value) => `${Math.round(value * 40)} px a 1080p`}
                        onChange={(size) => updateSettings({ size })}
                      />
                    </Field>
                    <div className="cab-field">
                      <Toggle label="Mostrar también en «Todo en uno»" checked={settings.inAll} onChange={(inAll) => updateSettings({ inAll })} />
                      <span className="cab-hint">La fuente «Mascota» la muestra siempre. No actives las dos a la vez en OBS o hablará dos veces.</span>
                    </div>
                  </section>

                  <section className="cab-mod">
                    <h2>Movimiento</h2>
                    <Field label="Entrada y salida">
                      <Seg
                        label="Entrada y salida"
                        value={settings.enter}
                        options={PET_ENTERS}
                        onChange={(enter) => {
                          updateSettings({ enter });
                          // El monitor recibe el ajuste nuevo en el siguiente pintado
                          setTimeout(() => layerRef.current?.preview('enter'), 60);
                        }}
                      />
                    </Field>
                    <Field label="En reposo">
                      <Seg label="En reposo" value={settings.idle} options={PET_IDLES} onChange={(idle) => updateSettings({ idle })} />
                    </Field>
                    <Field label="Efecto al activarse" hint="Con «reducir movimiento» activo en el sistema, todo pasa a fundidos.">
                      <Seg
                        label="Efecto al activarse"
                        value={settings.fx}
                        options={PET_FXS}
                        onChange={(fx) => {
                          updateSettings({ fx });
                          setTimeout(() => layerRef.current?.preview('fx'), 60);
                        }}
                      />
                    </Field>
                  </section>

                  <section className="cab-mod">
                    <h2>Texto en pantalla</h2>
                    <div className="cab-field">
                      <Seg label="Estilo del texto" value={settings.bubble} options={PET_BUBBLES} onChange={(bubble) => updateSettings({ bubble })} />
                      <span className="cab-hint">Las palabras aparecen al ritmo de la voz. Con «Solo voz» no sale texto.</span>
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4">
            <h2>Monitor</h2>
            <div className="cab-stage">
              <PetLayer ref={layerRef} settings={clean} isStudio onStatus={say} />
            </div>

            <div className="cab-field">
              <span className="cab-label">Qué la despierta</span>
              <div className="flex flex-wrap gap-2">
                {PET_TRIGGERS.map((item) => (
                  <button key={item.id} type="button" className="cab-btn2 cab-btn-sm" onClick={() => runTest(item.id)}>
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
                <span>{copied === 'demo' ? 'URL copiada' : 'Copiar URL con reacciones de muestra'}</span>
              </button>
            </div>
            <p className="cab-hint" role="status">
              {status ||
                (channel
                  ? 'Las pruebas usan datos de ejemplo. En el monitor la voz no suena: se oye en la fuente de OBS.'
                  : 'Falta tu canal: escríbelo en Inicio antes de copiar la URL.')}
            </p>
            <p className="cab-note">
              Los canjes de puntos y los Power-ups llegan por el canal de eventos: enciéndelo en «Power-ups». Los bits, las llamadas
              en el chat y las raids llegan por el chat y no necesitan nada más.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
