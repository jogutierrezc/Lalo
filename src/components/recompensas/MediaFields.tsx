/**
 * src/components/recompensas/MediaFields.tsx
 *
 * Sonido y vídeo de una recompensa: qué suena, con qué volumen, qué vídeo sale
 * y dónde cae (nueve puntos, pantalla completa o posición aleatoria).
 */

import React, { useId } from 'react';
import { Play } from 'lucide-react';
import { AlertSoundType } from '../../types/alerts';
import { MAX_AUDIO_DURATION_SECONDS, MediaType, inspectAudioFile } from '../../types/mediaLibrary';
import { CustomRewardItem, REWARD_GRID_POSITIONS, REWARD_LIMITS, RewardBlendMode } from '../../types/rewards';
import { resolveMediaUrl } from '../../lib/mediaRef';
import { playAlertOrCustomSound } from '../../utils/alertsAudio';
import { ZONE_NAMES } from '../../utils/rewardPosition';
import { Field, Range, Toggle } from '../studio/StudioKit';
import { MediaField } from './MediaField';

interface MediaFieldsProps {
  reward: CustomRewardItem;
  cloudOn: boolean;
  patch: (value: Partial<CustomRewardItem>) => void;
  onRelease: (mediaId: string) => void;
  onOpenVault: (type: MediaType) => void;
}

const SOUNDS: { id: AlertSoundType; name: string }[] = [
  { id: 'arcade-chime', name: 'Arcade (0,6 s)' },
  { id: 'retro-fanfare', name: 'Fanfarria (0,6 s)' },
  { id: 'synth-bell', name: 'Campana (1,4 s)' },
  { id: 'soft-pop', name: 'Pop suave (0,25 s)' },
  { id: 'none', name: 'Sin sonido' },
];

const BLEND_MODES: { id: RewardBlendMode; label: string }[] = [
  { id: 'transparent', label: 'Vídeo con transparencia (WebM)' },
  { id: 'screen', label: 'Quitar el fondo negro' },
  { id: 'chroma-green', label: 'Quitar el fondo verde' },
];

/** Rejilla de nueve puntos. `value` y `onPick` usan el índice de la celda (0 a 8, fila por fila). */
export const NineGrid: React.FC<{ label: string; value: number | null; disabled?: boolean; onPick: (cell: number) => void }> = ({
  label,
  value,
  disabled,
  onPick,
}) => (
  <div className="rw-nine" role="group" aria-label={label}>
    {ZONE_NAMES.map((name, cell) => (
      <button key={name} type="button" aria-label={name} title={name} aria-pressed={value === cell} disabled={disabled} onClick={() => onPick(cell)} />
    ))}
  </div>
);

export const SoundFields: React.FC<MediaFieldsProps> = ({ reward, cloudOn, patch, onRelease, onOpenVault }) => {
  const uid = useId();
  const volume = reward.customAudioVolume ?? reward.volume;
  const hasFile = Boolean(reward.customAudioUrl);

  return (
    <>
      <Field
        label="Sonido de serie"
        htmlFor={`${uid}-sound`}
        hint={hasFile ? 'Suena tu archivo. El de serie queda de reserva por si el archivo no carga.' : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={`${uid}-sound`}
            className="cab-inp flex-1 basis-48"
            value={reward.soundType}
            onChange={(e) => patch({ soundType: e.target.value as AlertSoundType })}
          >
            {SOUNDS.map((sound) => (
              <option key={sound.id} value={sound.id}>
                {sound.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cab-btn2"
            onClick={() => playAlertOrCustomSound(resolveMediaUrl(reward.customAudioUrl) ?? undefined, reward.soundType, volume)}
          >
            <Play className="h-4 w-4" />
            <span>Escuchar</span>
          </button>
        </div>
      </Field>

      <Field label="Tu archivo de sonido">
        <MediaField
          id={`${uid}-audio-file`}
          accept="audio/mpeg,audio/wav,audio/ogg,audio/*"
          cloudOn={cloudOn}
          value={{ url: reward.customAudioUrl, name: reward.customAudioName, mediaId: reward.customAudioMediaId }}
          emptyHint={`Sin archivo. MP3, WAV u OGG de hasta ${MAX_AUDIO_DURATION_SECONDS} segundos; un clip de menos de un segundo también vale y suena entero.`}
          prepare={async (file) => {
            // Rechaza los sonidos de más de 30 s antes de subir nada
            await inspectAudioFile(file);
          }}
          onRelease={onRelease}
          onChange={(next) =>
            patch({
              customAudioUrl: next?.url,
              customAudioName: next?.name,
              customAudioMediaId: next?.mediaId,
              customAudioVolume: next ? volume : undefined,
            })
          }
        >
          <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => onOpenVault('audio')}>
            Elegir de la biblioteca
          </button>
        </MediaField>
      </Field>

      <Field label="Volumen">
        <Range
          label="Volumen"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) => patch({ volume: value, customAudioVolume: hasFile ? value : undefined })}
        />
      </Field>
    </>
  );
};

export const VideoFields: React.FC<MediaFieldsProps> = ({ reward, cloudOn, patch, onRelease, onOpenVault }) => {
  const uid = useId();
  const random = reward.position === 'random';
  const full = reward.position === 'fullscreen';
  const cell = (REWARD_GRID_POSITIONS as readonly string[]).indexOf(reward.position);

  return (
    <>
      <Field label="Vídeo">
        <MediaField
          id={`${uid}-video-file`}
          accept="video/webm,video/mp4"
          cloudOn={cloudOn}
          value={{ url: reward.videoUrl, name: reward.videoName, mediaId: reward.videoMediaId }}
          emptyHint="Sin vídeo. Acepta WebM y MP4; se reproduce al activarse la recompensa."
          onRelease={onRelease}
          onChange={(next, mime) =>
            patch({
              videoUrl: next?.url,
              videoName: next?.name,
              videoMediaId: next?.mediaId,
              ...(next && mime ? { blendMode: mime === 'video/webm' ? 'transparent' : 'screen' } : {}),
            })
          }
        >
          <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => onOpenVault('video')}>
            Elegir de la biblioteca
          </button>
        </MediaField>
      </Field>

      <div className="rw-two">
        <Field label="Posición" hint={random ? 'Cada vez cae en un sitio distinto.' : full ? 'Ocupa toda la pantalla.' : `Fija: ${ZONE_NAMES[Math.max(0, cell)]}.`}>
          <NineGrid
            label="Posición fija del vídeo"
            value={random || full ? null : Math.max(0, cell)}
            disabled={random || full}
            onPick={(next) => patch({ position: REWARD_GRID_POSITIONS[next] })}
          />
        </Field>
        <div className="grid content-start gap-3">
          <Toggle
            label="Posición aleatoria"
            checked={random}
            onChange={(next) => patch({ position: next ? 'random' : 'center' })}
          />
          <Toggle
            label="Pantalla completa"
            checked={full}
            onChange={(next) => patch({ position: next ? 'fullscreen' : 'center' })}
          />
        </div>
      </div>

      {random && (
        <>
          <Field label="Zona permitida: margen a los bordes" hint="La línea discontinua del monitor es la zona permitida. No se ve en OBS.">
            <Range
              label="Margen a los bordes"
              min={REWARD_LIMITS.randomMargin.min}
              max={REWARD_LIMITS.randomMargin.max}
              value={reward.randomMargin}
              format={(value) => `${value}%`}
              onChange={(value) => patch({ randomMargin: value })}
            />
          </Field>
          <Toggle
            label="Variar un poco el tamaño (hasta un 20% más o menos)"
            checked={reward.randomVary}
            onChange={(next) => patch({ randomVary: next })}
          />
          <Toggle
            label="No repetir la misma zona dos veces seguidas"
            checked={reward.randomNoRepeat}
            onChange={(next) => patch({ randomNoRepeat: next })}
          />
        </>
      )}

      <div className="rw-two">
        {!full && (
          <Field label="Tamaño del vídeo">
            <Range
              label="Tamaño del vídeo"
              min={0.5}
              max={2}
              step={0.05}
              value={reward.scale}
              format={(value) => `${Math.round(value * 30)}% del ancho`}
              onChange={(value) => patch({ scale: value })}
            />
          </Field>
        )}
        <Field label="Tiempo del vídeo en pantalla">
          <Range
            label="Tiempo del vídeo en pantalla"
            min={0}
            max={REWARD_LIMITS.maxSeconds}
            value={reward.duration}
            format={(value) => (value ? `${value} s` : 'Lo que dure')}
            onChange={(value) => patch({ duration: value })}
          />
        </Field>
        <Field label="Fondo del vídeo" htmlFor={`${uid}-blend`}>
          <select
            id={`${uid}-blend`}
            className="cab-inp"
            value={reward.blendMode}
            onChange={(e) => patch({ blendMode: e.target.value as RewardBlendMode })}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Toggle label="Sacudir la pantalla" checked={reward.screenShake} onChange={(next) => patch({ screenShake: next })} />
    </>
  );
};
