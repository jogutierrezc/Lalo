/**
 * src/components/estudio/InspectorFields.tsx
 *
 * Campos del inspector de Studio y los ajustes propios de cada tipo de capa:
 * texto, forma, marco de cámara, temporizador, imagen o vídeo y la posición
 * aleatoria de alertas y saludo de raid.
 *
 * Cada campo avisa con una etiqueta de qué está cambiando: mientras se escribe
 * un número o se arrastra un color, todo cuenta como un solo paso de deshacer.
 */

import React, { useId, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { Range, Toggle } from '../studio/StudioKit';
import { MediaField, MediaValue } from '../recompensas/MediaField';
import { useCloudSession } from '../../hooks/useCloudSession';
import { releaseMedia } from '../../lib/mediaRef';
import { CHAT_FONTS, ChatFont } from '../../types/chat';
import {
  DEFAULT_CAM,
  DEFAULT_MEDIA,
  MediaProps,
  cleanMediaUrl,
  mediaKindOf,
  DEFAULT_RANDOM,
  DEFAULT_SHAPE,
  DEFAULT_TEXT,
  DEFAULT_TIMER,
  MIN_SIZE,
  STUDIO_LIMITS,
  StudioLayer,
  TextAlign,
  TextLegibility,
  TimerAtZero,
  TimerFormat,
  TimerMode,
  hasRandom,
} from '../../types/studio';

export type LayerChange = (patch: Partial<StudioLayer>, tag?: string) => void;

const L = STUDIO_LIMITS;

export const NumField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onDone: () => void;
}> = ({ label, value, min, max, step = 1, disabled, onChange, onDone }) => {
  const id = useId();
  // Mientras se escribe manda el texto; el modelo recibe el número ya dentro de sus límites
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="st-fld">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="cab-inp st-inp"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft ?? String(value)}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => {
          setDraft(event.target.value);
          const n = parseFloat(event.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => {
          setDraft(null);
          onDone();
        }}
      />
    </div>
  );
};

export const ColorField: React.FC<{ label: string; value: string; onChange: (value: string) => void; onDone: () => void }> = ({
  label,
  value,
  onChange,
  onDone,
}) => {
  const id = useId();
  return (
    <div className="st-fld">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="cab-inp st-color" type="color" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onDone} />
    </div>
  );
};

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; name: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="st-fld">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="cab-inp st-inp" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}

const WEIGHTS = [
  { id: '400', name: 'Normal' },
  { id: '600', name: 'Media' },
  { id: '700', name: 'Negrita' },
  { id: '800', name: 'Extra negrita' },
] as const;
const ALIGNS: { id: TextAlign; name: string }[] = [
  { id: 'l', name: 'Izquierda' },
  { id: 'c', name: 'Centro' },
  { id: 'r', name: 'Derecha' },
];
const LEGIBILITY: { id: TextLegibility; name: string }[] = [
  { id: 'none', name: 'Nada' },
  { id: 'shadow', name: 'Sombra' },
  { id: 'outline', name: 'Contorno' },
];
const TIMER_MODES: { id: TimerMode; name: string }[] = [
  { id: 'down', name: 'Cuenta atrás' },
  { id: 'up', name: 'Cuenta hacia arriba' },
];
const TIMER_FORMATS: { id: TimerFormat; name: string }[] = [
  { id: 'mmss', name: 'Minutos y segundos (05:00)' },
  { id: 'hmmss', name: 'Con horas (0:05:00)' },
];
const TIMER_ZERO: { id: TimerAtZero; name: string }[] = [
  { id: 'zero', name: 'Se queda en cero' },
  { id: 'text', name: 'Muestra un texto' },
  { id: 'hide', name: 'Desaparece' },
];

/** Capas cuya caja de Studio registra una prueba (ver components/estudio/boxes/). */
const TESTABLE: StudioLayer['type'][] = ['pet', 'game', 'music', 'kofi', 'kofigoal', 'kofirecent', 'reward', 'powerup', 'roulette', 'poll'];

const MEDIA_KINDS: { id: MediaProps['kind']; name: string }[] = [
  { id: 'image', name: 'Imagen (también GIF o WebP animado)' },
  { id: 'video', name: 'Vídeo' },
];
const MEDIA_FITS: { id: MediaProps['fit']; name: string }[] = [
  { id: 'contain', name: 'Entera, sin recortar' },
  { id: 'cover', name: 'Rellena la caja, recortando' },
];
const MEDIA_TYPES = 'image/png,image/gif,image/webp,image/svg+xml,video/webm,video/mp4';

/**
 * Imagen o vídeo de una escena. El archivo tiene que estar en una dirección
 * pública para que OBS lo cargue: con cuenta se sube al almacén; sin ella, o si
 * ya está en otro sitio, se pega su dirección.
 */
const MediaFields: React.FC<{ layer: StudioLayer; onChange: LayerChange; onDone: () => void }> = ({ layer, onChange, onDone }) => {
  const uid = useId();
  const cloud = useCloudSession();
  const cloudOn = cloud.enabled && cloud.profile?.status === 'active';
  const m = layer.media || DEFAULT_MEDIA;
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = (patch: Partial<MediaProps>, tag?: string) => onChange({ media: { ...m, ...patch } }, tag);

  const fromUpload = (next: MediaValue | null, mime?: string) => {
    setNote(null);
    if (!next) {
      set({ url: '', name: '', mediaId: '' });
      return;
    }
    const url = cleanMediaUrl(next.url);
    if (!url) {
      // El almacén no respondió y el archivo se quedó en este navegador: OBS no podría cargarlo
      setNote('El archivo no llegó a la nube, así que OBS no podría cargarlo. Prueba otra vez o pega la dirección de un archivo ya publicado.');
      return;
    }
    set({ url, name: next.name ?? '', mediaId: next.mediaId ?? '', kind: mime?.startsWith('video/') ? 'video' : mime ? 'image' : mediaKindOf(url) });
  };

  const fromAddress = () => {
    if (draft === null) return;
    const typed = draft.trim();
    setDraft(null);
    if (typed === m.url) return;
    const url = cleanMediaUrl(typed);
    if (typed && !url) {
      setNote('Esa dirección no vale: tiene que empezar por https:// y no llevar espacios.');
      return;
    }
    setNote(null);
    // Una dirección pegada sustituye al archivo subido, que deja de usarse aquí
    if (m.mediaId) void releaseMedia(m.mediaId);
    set({ url, name: '', mediaId: '', kind: mediaKindOf(url) });
    onDone();
  };

  return (
    <div className="st-grp">
      <span className="cab-label">Imagen o vídeo</span>
      {cloudOn ? (
        <MediaField
          id={`${uid}-file`}
          accept={MEDIA_TYPES}
          value={{ url: m.url || undefined, name: m.name || (m.url ? 'archivo enlazado' : undefined), mediaId: m.mediaId || undefined }}
          cloudOn
          emptyHint="Sube un PNG, GIF, WebP, SVG, WebM o MP4."
          onChange={fromUpload}
          onRelease={(mediaId) => void releaseMedia(mediaId)}
        />
      ) : (
        <p className="cab-hint">Con una cuenta en la nube puedes subir el archivo desde aquí. Sin ella, pega la dirección de un archivo ya publicado.</p>
      )}
      <div className="st-fld">
        <label htmlFor={`${uid}-url`}>{cloudOn ? 'O pega una dirección' : 'Dirección del archivo'}</label>
        <input
          id={`${uid}-url`}
          className="cab-inp st-inp"
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="https://..."
          maxLength={600}
          value={draft ?? (m.mediaId ? '' : m.url)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={fromAddress}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      {note && (
        <p className="cab-error" role="alert">
          {note}
        </p>
      )}
      <SelectField label="Qué es" value={m.kind} options={MEDIA_KINDS} onChange={(kind) => set({ kind })} />
      <SelectField label="Cómo encaja" value={m.fit} options={MEDIA_FITS} onChange={(fit) => set({ fit })} />
      {m.kind === 'video' && (
        <>
          <Toggle label="Repetir sin parar" checked={m.loop} onChange={(loop) => set({ loop })} />
          <Toggle label="Sin sonido" checked={m.muted} onChange={(muted) => set({ muted })} />
        </>
      )}
      <p className="cab-hint">
        {m.kind === 'video'
          ? 'El vídeo arranca solo cuando OBS carga la escena; aquí se ve siempre sin sonido. Para fondo transparente usa WebM con canal alfa.'
          : 'Un GIF o un WebP animado se mueven solos, también en OBS. Con fondo transparente se integran mejor sobre el directo.'}
      </p>
    </div>
  );
};

interface TypeFieldsProps {
  layer: StudioLayer;
  onChange: LayerChange;
  onDone: () => void;
  onTest: () => void;
}

/** Ajustes propios del tipo de capa elegido. */
export const TypeFields: React.FC<TypeFieldsProps> = ({ layer, onChange, onDone, onTest }) => {
  const uid = useId();

  if (layer.type === 'text') {
    const t = layer.text || DEFAULT_TEXT;
    const set = (patch: Partial<typeof t>, tag?: string) => onChange({ text: { ...t, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Texto</span>
        <div className="st-fld">
          <label htmlFor={`${uid}-tx`}>Contenido</label>
          <textarea
            id={`${uid}-tx`}
            className="cab-inp st-inp"
            rows={2}
            maxLength={L.textLength}
            value={t.content}
            onChange={(e) => set({ content: e.target.value }, 'texto')}
            onBlur={onDone}
          />
        </div>
        <div className="st-g2">
          <SelectField<ChatFont> label="Tipografía" value={t.font} options={CHAT_FONTS} onChange={(font) => set({ font })} />
          <SelectField
            label="Grosor"
            value={String(t.weight) as (typeof WEIGHTS)[number]['id']}
            options={WEIGHTS}
            onChange={(weight) => set({ weight: Number(weight) })}
          />
          <NumField label="Tamaño" value={t.size} min={L.textSize.min} max={L.textSize.max} onChange={(size) => set({ size }, 'texto-size')} onDone={onDone} />
          <ColorField label="Color" value={t.color} onChange={(color) => set({ color }, 'texto-color')} onDone={onDone} />
          <SelectField label="Alineación" value={t.align} options={ALIGNS} onChange={(align) => set({ align })} />
          <SelectField label="Para que se lea" value={t.legibility} options={LEGIBILITY} onChange={(legibility) => set({ legibility })} />
        </div>
        <Toggle label="Todo en mayúsculas" checked={t.upper} onChange={(upper) => set({ upper })} />
      </div>
    );
  }

  if (layer.type === 'shape') {
    const s = layer.shape || DEFAULT_SHAPE;
    const set = (patch: Partial<typeof s>, tag?: string) => onChange({ shape: { ...s, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Forma</span>
        <Toggle label="Con relleno" checked={s.filled} onChange={(filled) => set({ filled })} />
        <div className="st-g2">
          <ColorField label="Relleno" value={s.fill} onChange={(fill) => set({ fill }, 'forma-fill')} onDone={onDone} />
          <ColorField label="Borde" value={s.border} onChange={(border) => set({ border }, 'forma-border')} onDone={onDone} />
          <NumField label="Grosor del borde" value={s.borderWidth} min={L.borderWidth.min} max={L.borderWidth.max} onChange={(borderWidth) => set({ borderWidth }, 'forma-bw')} onDone={onDone} />
          <NumField label="Redondeo" value={s.radius} min={L.radius.min} max={L.radius.max} onChange={(radius) => set({ radius }, 'forma-r')} onDone={onDone} />
        </div>
      </div>
    );
  }

  if (layer.type === 'cam') {
    const c = layer.cam || DEFAULT_CAM;
    const set = (patch: Partial<typeof c>, tag?: string) => onChange({ cam: { ...c, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Marco</span>
        <div className="st-g2">
          <ColorField label="Color" value={c.color} onChange={(color) => set({ color }, 'cam-color')} onDone={onDone} />
          <NumField label="Grosor" value={c.thickness} min={L.thickness.min} max={L.thickness.max} onChange={(thickness) => set({ thickness }, 'cam-th')} onDone={onDone} />
          <NumField label="Redondeo" value={c.radius} min={L.radius.min} max={L.radius.max} onChange={(radius) => set({ radius }, 'cam-r')} onDone={onDone} />
        </div>
        <Toggle label="Con etiqueta" checked={c.label} onChange={(label) => set({ label })} />
        {c.label && (
          <div className="st-fld">
            <label htmlFor={`${uid}-cl`}>Texto de la etiqueta</label>
            <input
              id={`${uid}-cl`}
              className="cab-inp st-inp"
              maxLength={L.name}
              value={c.labelText}
              onChange={(e) => set({ labelText: e.target.value }, 'cam-label')}
              onBlur={onDone}
            />
          </div>
        )}
        <p className="cab-hint">El marco solo dibuja el borde: la cámara es otra fuente de OBS, colocada debajo.</p>
      </div>
    );
  }

  if (layer.type === 'timer') {
    const t = layer.timer || DEFAULT_TIMER;
    const set = (patch: Partial<typeof t>, tag?: string) => onChange({ timer: { ...t, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Temporizador</span>
        <SelectField label="Qué cuenta" value={t.mode} options={TIMER_MODES} onChange={(mode) => set({ mode })} />
        <div className="st-g2">
          {t.mode === 'down' && (
            <NumField label="Minutos" value={t.minutes} min={L.minutes.min} max={L.minutes.max} onChange={(minutes) => set({ minutes }, 'timer-min')} onDone={onDone} />
          )}
          <ColorField label="Color" value={t.color} onChange={(color) => set({ color }, 'timer-color')} onDone={onDone} />
        </div>
        <SelectField label="Formato" value={t.format} options={TIMER_FORMATS} onChange={(format) => set({ format })} />
        {t.mode === 'down' && <SelectField label="Al llegar a cero" value={t.atZero} options={TIMER_ZERO} onChange={(atZero) => set({ atZero })} />}
        {t.mode === 'down' && t.atZero === 'text' && (
          <div className="st-fld">
            <label htmlFor={`${uid}-te`}>Texto final</label>
            <input
              id={`${uid}-te`}
              className="cab-inp st-inp"
              maxLength={40}
              value={t.endText}
              onChange={(e) => set({ endText: e.target.value }, 'timer-end')}
              onBlur={onDone}
            />
          </div>
        )}
        <Toggle label="Con placa de fondo" checked={t.plate} onChange={(plate) => set({ plate })} />
        <p className="cab-hint">El reloj arranca cuando OBS carga la escena. Aquí se ve parado en su valor inicial.</p>
      </div>
    );
  }

  if (layer.type === 'image') return <MediaFields layer={layer} onChange={onChange} onDone={onDone} />;

  if (hasRandom(layer.type)) {
    const r = layer.random || DEFAULT_RANDOM[layer.type];
    const set = (patch: Partial<typeof r>, tag?: string) => onChange({ random: { ...r, ...patch } }, tag);
    return (
      <div className="st-grp">
        <span className="cab-label">Posición aleatoria</span>
        <Toggle label="Cada aviso sale en un sitio distinto" checked={r.enabled} onChange={(enabled) => set({ enabled })} />
        {r.enabled ? (
          <>
            <p className="cab-hint">
              La caja de la capa es ahora la zona. Cada aviso aparece entero dentro de ella, con este tamaño, y nunca dos veces
              seguidas en el mismo sitio.
            </p>
            <div className="st-g2">
              <NumField label="Ancho del aviso" value={Math.min(r.w, layer.w)} min={MIN_SIZE} max={layer.w} onChange={(w) => set({ w }, 'zona-w')} onDone={onDone} />
              <NumField label="Alto del aviso" value={Math.min(r.h, layer.h)} min={MIN_SIZE} max={layer.h} onChange={(h) => set({ h }, 'zona-h')} onDone={onDone} />
            </div>
            <button type="button" className="cab-btn2 st-btn" onClick={onTest}>
              <Shuffle />
              Probar
            </button>
          </>
        ) : (
          <p className="cab-hint">Apagado, el aviso sale siempre en la caja de la capa.</p>
        )}
      </div>
    );
  }

  // Capas de Lalo que llegaron con las fases (mascota, juego, música, Ko-fi, recompensa, ruleta...):
  // su caja registra una prueba que repite su entrada o enseña otra muestra
  if (TESTABLE.includes(layer.type)) {
    return (
      <div className="st-grp">
        <span className="cab-label">Prueba</span>
        <button type="button" className="cab-btn2 st-btn" onClick={onTest}>
          <Shuffle />
          Probar
        </button>
        <p className="cab-hint">Repite la muestra en el lienzo. Lo que dice o hace la capa en directo se ajusta en su página.</p>
      </div>
    );
  }

  return null;
};

/** Deslizador con etiqueta visible, para el inspector. */
export const RangeField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  onDone: () => void;
}> = ({ label, onDone, ...range }) => (
  <div className="st-fld" onPointerUp={onDone} onKeyUp={onDone} onBlur={onDone}>
    <span>{label}</span>
    <Range label={label} {...range} />
  </div>
);
