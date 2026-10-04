/**
 * src/components/voz/PreSoundSection.tsx
 *
 * «Sonido antes de la voz», dentro de la pestaña Voz de «Voz del chat». Un aviso
 * corto que suena justo antes de que la voz lea un mensaje: se elige uno de los
 * sonidos de serie o se sube un archivo propio, con su volumen y cuándo suena.
 *
 * «Probar» hace lo mismo que la fuente de OBS: suena el aviso y, cuando acaba,
 * la voz elegida dice una frase de muestra.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import type { TTSSettings } from '../../types/settings';
import { inspectAudioFile } from '../../types/mediaLibrary';
import { isLocalOnlyMedia, releaseMedia } from '../../lib/mediaRef';
import { normalizeTextForFishAudio } from '../../utils/emotionMapper';
import {
  PRE_SOUNDS,
  PRE_SOUND_CAP_MS,
  PRE_SOUND_MAX_FILE_SECONDS,
  PRE_SOUND_WHEN,
  PreSoundSettings,
  PreSoundType,
} from '../../utils/preSound';
import { createPreSoundPlayer } from '../../utils/preSoundPlayer';
import { MediaField } from '../recompensas/MediaField';
import { Field, Range, Toggle } from '../studio/StudioKit';

const SAMPLE_USER = 'SuperViewer';
const SAMPLE_TEXT = 'así suena un mensaje después del aviso';

interface PreSoundSectionProps {
  settings: TTSSettings;
  /** Hay una cuenta activa en la nube: el archivo propio se sube al almacén. */
  cloudOn: boolean;
  update: (patch: Partial<TTSSettings>) => void;
}

/** Dice la frase de muestra con la voz del navegador si el servicio de voz no responde. */
function speakWithBrowser(text: string, settings: TTSSettings, onEnd: () => void): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return onEnd();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  utterance.rate = settings.speed;
  utterance.volume = settings.volume;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export const PreSoundSection: React.FC<PreSoundSectionProps> = ({ settings, cloudOn, update }) => {
  const uid = useId();
  const ps = settings.preSound;
  const patch = (value: Partial<PreSoundSettings>) => update({ preSound: { ...ps, ...value } });

  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  const playerRef = useRef<ReturnType<typeof createPreSoundPlayer> | null>(null);
  if (!playerRef.current) playerRef.current = createPreSoundPlayer();
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const turnRef = useRef(0);

  // El archivo propio se deja cargado para que «Probar» suene sin espera, igual que en OBS
  useEffect(() => {
    playerRef.current?.preload(ps);
  }, [ps]);

  const stopTest = () => {
    turnRef.current += 1;
    playerRef.current?.stop();
    voiceRef.current?.pause();
    voiceRef.current = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setTesting(false);
  };
  useEffect(
    () => () => {
      turnRef.current += 1;
      playerRef.current?.stop();
      voiceRef.current?.pause();
    },
    []
  );

  const runTest = async () => {
    stopTest();
    const turn = turnRef.current;
    setTesting(true);
    setTestNote(null);
    const announce = settings.announceSender !== false;
    const spoken = announce
      ? (settings.announceTemplate || '{user} dice: {message}').replace('{user}', SAMPLE_USER).replace('{message}', SAMPLE_TEXT)
      : SAMPLE_TEXT;
    const done = () => {
      if (turn === turnRef.current) setTesting(false);
    };

    // Igual que la fuente: el aviso empieza ya, mientras se pide la voz
    const sound = (playerRef.current?.play({ ...ps, enabled: true }) ?? Promise.resolve()).catch(() => {});
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: normalizeTextForFishAudio(spoken),
          reference_id: settings.referenceId || undefined,
          model: settings.model || 's2.1-pro-free',
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      await sound;
      if (turn !== turnRef.current) return URL.revokeObjectURL(url);
      const audio = new Audio(url);
      audio.volume = settings.volume;
      audio.playbackRate = settings.speed;
      voiceRef.current = audio;
      const finish = () => {
        URL.revokeObjectURL(url);
        done();
      };
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
    } catch {
      await sound;
      if (turn !== turnRef.current) return;
      setTestNote('El servicio de voz no respondió: la frase la dice la voz del navegador. El aviso es el mismo que sonará en OBS.');
      speakWithBrowser(spoken, settings, done);
    }
  };

  const hasFile = Boolean(ps.customUrl);
  const localFile = isLocalOnlyMedia(ps.customUrl);
  const whenHint = PRE_SOUND_WHEN.find((item) => item.id === ps.when)?.hint;

  return (
    <section className="vz-presound" aria-label="Sonido antes de la voz">
      <div className="cab-field">
        <span className="cab-label">Sonido antes de la voz</span>
        <Toggle label="Avisar con un sonido antes de leer" checked={ps.enabled} onChange={(enabled) => patch({ enabled })} />
        <span className="cab-hint">
          {ps.enabled
            ? 'Suena el aviso y, cuando acaba, empieza la voz. Las alertas que ya traen su sonido, la ruleta y el saludo de raid no lo llevan.'
            : 'La voz empieza a leer sin aviso.'}
        </span>
      </div>

      {ps.enabled && (
        <>
          <Field
            label="Sonido de serie"
            htmlFor={`${uid}-sound`}
            hint={hasFile ? 'Suena tu archivo. El de serie queda de reserva por si el archivo no carga.' : undefined}
          >
            <select
              id={`${uid}-sound`}
              className="cab-inp"
              value={ps.soundType}
              onChange={(e) => patch({ soundType: e.target.value as PreSoundType })}
            >
              {PRE_SOUNDS.map((sound) => (
                <option key={sound.id} value={sound.id}>
                  {sound.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tu archivo de sonido">
            <MediaField
              id={`${uid}-file`}
              accept="audio/mpeg,audio/wav,audio/ogg,audio/*"
              cloudOn={cloudOn}
              value={{ url: ps.customUrl || undefined, name: ps.customName || undefined, mediaId: ps.customMediaId || undefined }}
              emptyHint={`Sin archivo. MP3, WAV u OGG de hasta ${PRE_SOUND_MAX_FILE_SECONDS} segundos; mejor uno corto, de uno o dos.`}
              prepare={async (file) => {
                const { duration } = await inspectAudioFile(file);
                if (duration > PRE_SOUND_MAX_FILE_SECONDS) {
                  throw new Error(`Ese sonido dura ${Math.round(duration)} segundos. Para avisar antes de la voz, usa uno de hasta ${PRE_SOUND_MAX_FILE_SECONDS}.`);
                }
              }}
              onRelease={(mediaId) => void releaseMedia(mediaId)}
              onChange={(next) => patch({ customUrl: next?.url || '', customName: next?.name || '', customMediaId: next?.mediaId || '' })}
            />
            <span className="cab-hint">
              Si dura más de {PRE_SOUND_CAP_MS / 1000} segundos, la voz empieza a los {PRE_SOUND_CAP_MS / 1000} y el sonido se va apagando debajo.
              {localFile ? ' Un archivo guardado solo en este navegador no viaja en la URL de OBS: allí sonará el sonido de serie.' : ''}
            </span>
          </Field>

          <Field label="Volumen del sonido">
            <Range
              label="Volumen del sonido"
              min={0}
              max={1}
              step={0.05}
              value={ps.volume}
              format={(value) => `${Math.round(value * 100)} %`}
              onChange={(volume) => patch({ volume })}
            />
          </Field>

          <Field label="Cuándo suena" hint={whenHint}>
            <div className="cab-seg" role="group" aria-label="Cuándo suena">
              {PRE_SOUND_WHEN.map((item) => (
                <button key={item.id} type="button" aria-pressed={ps.when === item.id} onClick={() => patch({ when: item.id })}>
                  {item.name}
                </button>
              ))}
            </div>
          </Field>

          <div className="cab-field">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn2" onClick={testing ? stopTest : runTest}>
                {testing ? <Square className="h-4 w-4 fill-current" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                <span>{testing ? 'Parar' : 'Probar'}</span>
              </button>
            </div>
            <span className="cab-hint" role="status">
              {testNote || 'Suena el aviso y después una frase de muestra con la voz elegida, aquí en el panel.'}
            </span>
          </div>
        </>
      )}
    </section>
  );
};
