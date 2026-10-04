/**
 * src/pages/admin/NuevaVozPanel.tsx
 *
 * Alta de una voz en la consola, en cuatro pasos:
 *   1. Audio de origen: grabar con el micrófono (entre 15 y 60 segundos, con
 *      medidor de nivel y contador, se escucha antes de enviar) o subir audios.
 *   2. Nombre y descripción.
 *   3. Permiso: de quién es la voz y la confirmación. Es obligatorio, lo pide la
 *      política de voces de la app (src/legal/voces.ts), y se guarda con la voz.
 *   4. Crear: el audio va al servidor de Lalo, que crea el modelo en Fish Audio
 *      y guarda la voz, oculta, en el catálogo.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatBytes } from '../../lib/cloud';
import { recordingToWav } from '../../lib/voiceRecorder';
import { VoiceApiError, createVoiceRequest, type CreateVoiceResult } from '../../lib/voicesCloud';
import {
  RECORD_MAX_SECONDS,
  RECORD_MIN_SECONDS,
  VOICE_DESCRIPTION_MAX,
  VOICE_MAX_FILES,
  VOICE_MAX_TOTAL_LABEL,
  VOICE_NAME_MAX,
  VOICE_PERMISSION_MAX,
  checkVoiceFiles,
  createChecklist,
  formatClock,
  recordingProblem,
  voiceNameProblem,
  type VoiceEnvelopeMeta,
} from '../../../server/voices/rules';

const BARS = 36;
const REC_HINT = `Entre ${RECORD_MIN_SECONDS} y ${RECORD_MAX_SECONDS} segundos, en un sitio silencioso y sin música de fondo.`;
const PROGRESS = ['Subiendo el audio', 'Creando el modelo en Fish Audio', 'Guardando en el catálogo'];

type Source = 'mic' | 'file';
type RecStatus = 'idle' | 'recording' | 'processing' | 'done';

interface Recording {
  wav: Uint8Array;
  url: string;
  seconds: number;
  problem: string | null;
}

function micProblem(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'El navegador no dio permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones y vuelve a pulsar Grabar.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se encontró ningún micrófono conectado.';
  if (name === 'NotReadableError') return 'Otro programa está usando el micrófono. Ciérralo y vuelve a pulsar Grabar.';
  return 'No se pudo usar el micrófono en este navegador. Puedes subir un audio ya grabado.';
}

export const NuevaVozPanel: React.FC<{
  /** Nombres que ya están en el catálogo. */
  existingNames: string[];
  /** false si el catálogo no se pudo leer: no se puede comprobar el nombre ni guardar. */
  available: boolean;
  onCreated: (result: CreateVoiceResult) => void;
}> = ({ existingNames, available, onCreated }) => {
  const uid = useId();
  const [source, setSource] = useState<Source>('mic');

  // ---------- Grabación ----------
  const [recStatus, setRecStatus] = useState<RecStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const live = useRef<{
    stream: MediaStream | null;
    recorder: MediaRecorder | null;
    context: AudioContext | null;
    timer: number;
    frame: number;
  }>({ stream: null, recorder: null, context: null, timer: 0, frame: 0 });
  const urlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);

  const releaseMic = () => {
    const now = live.current;
    window.clearInterval(now.timer);
    cancelAnimationFrame(now.frame);
    now.stream?.getTracks().forEach((track) => track.stop());
    void now.context?.close().catch(() => undefined);
    now.stream = null;
    now.context = null;
    meterRef.current?.querySelectorAll('i').forEach((bar) => {
      bar.style.transform = '';
    });
  };

  const dropRecording = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setRecording(null);
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const recorder = live.current.recorder;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseMic();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const stopRecording = () => {
    const recorder = live.current.recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const startRecording = async () => {
    dropRecording();
    setRecError(null);
    setElapsed(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecError('Este navegador no permite grabar. Puedes subir un audio ya grabado.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setRecError(micProblem(err));
      return;
    }
    if (!aliveRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const now = live.current;
    now.stream = stream;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    now.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMic();
      setRecStatus('processing');
      recordingToWav(new Blob(chunks, { type: recorder.mimeType }))
        .then(({ wav, seconds }) => {
          if (!aliveRef.current) return;
          const url = URL.createObjectURL(new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }));
          urlRef.current = url;
          setRecording({ wav, url, seconds, problem: recordingProblem(seconds) });
          setRecStatus('done');
        })
        .catch(() => {
          if (!aliveRef.current) return;
          setRecError('No se pudo preparar la grabación en este navegador. Repítela o sube un audio ya grabado.');
          setRecStatus('idle');
        });
    };

    // Medidor de nivel: cada barra copia a la siguiente y la última toma el nivel de ahora
    try {
      const context = new AudioContext();
      now.context = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const value of samples) peak = Math.max(peak, Math.abs(value - 128));
        const bars = meterRef.current?.querySelectorAll('i');
        bars?.forEach((bar, index) => {
          const next = bars[index + 1];
          bar.style.transform = next ? next.style.transform : `scaleY(${Math.max(0.08, Math.min(1, peak / 60))})`;
        });
        now.frame = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      // Sin medidor se puede grabar igual
    }

    const startedAt = performance.now();
    now.timer = window.setInterval(() => {
      const seconds = (performance.now() - startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= RECORD_MAX_SECONDS) stopRecording();
    }, 250);
    recorder.start();
    setRecStatus('recording');
  };

  const redo = () => {
    dropRecording();
    setElapsed(0);
    setRecError(null);
    setRecStatus('idle');
  };

  // ---------- Archivos ----------
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filesCheck = useMemo(
    () => checkVoiceFiles(files.map((file) => ({ name: file.name, type: file.type, size: file.size }))),
    [files]
  );

  // ---------- Datos y permiso ----------
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState<'own' | 'other'>('own');
  const [permissionBy, setPermissionBy] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  // ---------- Crear ----------
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const audioReady = source === 'mic' ? recording !== null && recording.problem === null : filesCheck.ok;
  const checklist = createChecklist({ audioReady, name, existingNames, owner, permissionBy, confirmed });
  const nameProblem = name.trim() ? voiceNameProblem(name, existingNames) : null;
  const sourceTag = audioReady ? (source === 'mic' ? 'Grabación lista' : `${filesCheck.files.length} audio(s)`) : 'Sin audio';

  const recHint =
    recStatus === 'recording'
      ? 'Grabando con tu micrófono. Pulsa Detener al terminar.'
      : recStatus === 'processing'
        ? 'Preparando la grabación.'
        : recording
          ? (recording.problem ?? `Grabación de ${formatClock(recording.seconds)} lista. Escúchala antes de crear la voz.`)
          : REC_HINT;

  const create = async () => {
    if (!checklist.canCreate || busy || !available) return;
    setBusy(true);
    setStep(0);
    setOutcome(null);
    try {
      const used = files.slice(0, VOICE_MAX_FILES);
      const parts =
        source === 'mic' && recording
          ? [recording.wav]
          : await Promise.all(used.map(async (file) => new Uint8Array(await file.arrayBuffer())));
      const meta: VoiceEnvelopeMeta = {
        name: name.trim(),
        description: description.trim(),
        origin: source === 'mic' ? 'recorded' : 'uploaded',
        owner,
        permissionBy: owner === 'other' ? permissionBy.trim() : '',
        confirmed,
        files:
          source === 'mic'
            ? [{ name: 'grabacion.wav', type: 'audio/wav', size: parts[0].byteLength }]
            : used.map((file) => ({ name: file.name, type: file.type, size: file.size })),
      };
      // El navegador solo ve cuándo sale el audio y cuándo responde el servidor
      const result = await createVoiceRequest(meta, parts, () => setStep(1));
      setStep(PROGRESS.length);
      onCreated(result);
      redo();
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setName('');
      setDescription('');
      setPermissionBy('');
      setOwner('own');
      setConfirmed(false);
      setOutcome({
        ok: true,
        text: result.ready
          ? 'Voz creada. Queda oculta hasta que la pruebes y la hagas visible.'
          : `Voz creada, pero Fish Audio todavía la está preparando (estado «${result.state}»). Espera un minuto antes de probarla. Queda oculta hasta que la hagas visible.`,
      });
    } catch (err) {
      setOutcome({
        ok: false,
        text: err instanceof VoiceApiError ? err.message : 'No se pudo crear la voz. No se guardó nada.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cab-mod" aria-label="Nueva voz">
      <h2 className="adm-h2">
        Nueva voz
        <b className="cab-chip" data-status={audioReady ? 'read' : undefined}>
          {sourceTag}
        </b>
      </h2>

      <div className="voc-steps">
        <div className="voc-step">
          <h3>
            <i>1</i>Audio de origen
          </h3>
          <div className="cab-seg" role="group" aria-label="De dónde sale el audio">
            <button type="button" aria-pressed={source === 'mic'} disabled={busy} onClick={() => setSource('mic')}>
              Grabar con micrófono
            </button>
            <button
              type="button"
              aria-pressed={source === 'file'}
              disabled={busy || recStatus === 'recording'}
              onClick={() => setSource('file')}
            >
              Subir audios
            </button>
          </div>

          {source === 'mic' ? (
            <>
              <p className="voc-script">
                Lee esto con tu voz normal, sin prisa: «Hola a todos, bienvenidos al directo. Hoy vamos a jugar un rato,
                charlar con el chat y pasarlo bien. Gracias por estar aquí, de verdad. Vamos allá.»
              </p>
              <div className="voc-recbar">
                <button
                  type="button"
                  className="cab-btn2 voc-recbtn"
                  data-on={recStatus === 'recording' ? '' : undefined}
                  disabled={busy || recStatus === 'processing'}
                  onClick={recStatus === 'recording' ? stopRecording : startRecording}
                >
                  {recStatus === 'recording' ? 'Detener' : 'Grabar'}
                </button>
                <div className="voc-meter" ref={meterRef} aria-hidden="true">
                  {Array.from({ length: BARS }, (_, index) => (
                    <i key={index} />
                  ))}
                </div>
                <span className="voc-time">{formatClock(recording ? recording.seconds : elapsed)}</span>
              </div>
              <p className={recording?.problem ? 'cab-error' : 'cab-hint'} role="status">
                {recHint}
              </p>
              {recError && (
                <p className="cab-error" role="alert">
                  {recError}
                </p>
              )}
              {recording && (
                <div className="voc-listen">
                  <audio controls src={recording.url} aria-label="Tu grabación" />
                  <button type="button" className="cab-btn2 cab-btn-sm" onClick={redo} disabled={busy}>
                    Repetir
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <label className="voc-drop">
                <b>Elige uno o varios audios</b>
                <span className="cab-hint">
                  MP3, WAV o M4A. Hasta {VOICE_MAX_FILES} archivos y {VOICE_MAX_TOTAL_LABEL} entre todos: es lo que el
                  servidor acepta en un envío. Solo la voz, sin música ni otras personas.
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a"
                  multiple
                  disabled={busy}
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                />
              </label>
              {filesCheck.files.length > 0 && (
                <ul className="voc-files">
                  {filesCheck.files.map((file, index) => (
                    <li key={`${file.name}-${index}`} data-bad={file.problem ? '' : undefined}>
                      <span>{file.name}</span>
                      <span>{file.problem ?? formatBytes(file.size)}</span>
                    </li>
                  ))}
                  {filesCheck.ignored > 0 && (
                    <li>
                      <span>Solo se usan los {VOICE_MAX_FILES} primeros.</span>
                    </li>
                  )}
                </ul>
              )}
              {filesCheck.problem && (
                <p className="cab-error" role="alert">
                  {filesCheck.problem}
                </p>
              )}
            </>
          )}
        </div>

        <div className="voc-step">
          <h3>
            <i>2</i>Datos de la voz
          </h3>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-name`}>
              Nombre
            </label>
            <input
              id={`${uid}-name`}
              className="cab-inp"
              value={name}
              maxLength={VOICE_NAME_MAX}
              placeholder="Por ejemplo, Trueno"
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-desc`}>
              Descripción para el streamer
            </label>
            <input
              id={`${uid}-desc`}
              className="cab-inp"
              value={description}
              maxLength={VOICE_DESCRIPTION_MAX}
              placeholder="Grave y tranquila."
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {nameProblem && (
            <p className="voc-msg" role="status">
              {nameProblem}
            </p>
          )}
        </div>

        <div className="voc-step">
          <h3>
            <i>3</i>Permiso
          </h3>
          <div className="cab-field">
            <span className="cab-label" id={`${uid}-owner`}>
              De quién es la voz
            </span>
            <div className="cab-seg" role="group" aria-labelledby={`${uid}-owner`}>
              <button type="button" aria-pressed={owner === 'own'} disabled={busy} onClick={() => setOwner('own')}>
                Es mi voz
              </button>
              <button type="button" aria-pressed={owner === 'other'} disabled={busy} onClick={() => setOwner('other')}>
                De otra persona, con su permiso
              </button>
            </div>
          </div>
          {owner === 'other' && (
            <div className="cab-field">
              <label className="cab-label" htmlFor={`${uid}-who`}>
                Quién dio el permiso
              </label>
              <input
                id={`${uid}-who`}
                className="cab-inp"
                value={permissionBy}
                maxLength={VOICE_PERMISSION_MAX}
                placeholder="Nombre de la persona"
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setPermissionBy(event.target.value)}
              />
            </div>
          )}
          <label className="voc-check">
            <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>
              Confirmo que tengo derecho a usar esta voz y que no imita a un personaje, a una marca ni a una persona sin su
              permiso.
            </span>
          </label>
        </div>

        <div className="voc-step">
          <div className="voc-create">
            <button type="button" className="cab-btn" disabled={!checklist.canCreate || busy || !available} onClick={create}>
              {busy ? 'Creando' : 'Crear voz'}
            </button>
            <span className="cab-hint" role="status">
              {busy
                ? 'No cierres esta página.'
                : available
                  ? checklist.message
                  : 'No se puede crear hasta que se pueda leer el catálogo.'}
            </span>
          </div>
          {busy && (
            <ol className="voc-prog">
              {PROGRESS.map((label, index) => (
                <li key={label} data-s={index < step ? 'done' : index === step ? 'on' : undefined}>
                  {label}
                </li>
              ))}
            </ol>
          )}
          {outcome && !busy && (
            <p className={outcome.ok ? 'cab-note adm-note-ok' : 'cab-error'} role={outcome.ok ? 'status' : 'alert'}>
              {outcome.text}
            </p>
          )}
          <p className="cab-hint">En Fish Audio la voz se crea siempre como privada: no aparece en su biblioteca pública.</p>
        </div>
      </div>
    </section>
  );
};
