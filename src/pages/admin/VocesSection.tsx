/**
 * src/pages/admin/VocesSection.tsx
 *
 * Catálogo de voces de la consola: ver cada voz con su origen y su permiso,
 * probarla con un texto (suena de verdad, por /api/tts), decidir si los
 * streamers la ven, elegir la voz por defecto y eliminar. A la derecha, el alta
 * de una voz (NuevaVozPanel).
 *
 * La voz por defecto no se puede ocultar ni eliminar. Las voces nuevas nacen
 * ocultas. Ocultar y cambiar la voz por defecto van por RPC de Supabase; crear
 * y eliminar van por el servidor de Lalo, que es quien habla con Fish Audio.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminVoiceRow } from '../../lib/cloudTypes';
import {
  VoiceApiError,
  deleteVoiceRequest,
  setDefaultVoice,
  setVoiceVisible,
  synthesizeSample,
  voiceRpcProblem,
} from '../../lib/voicesCloud';
import { catalogueCount, deleteWarning, sortAdminVoices, voiceMetaLine } from '../../lib/voicesLogic';
import { NuevaVozPanel } from './NuevaVozPanel';
import type { AdminData } from './useAdminData';
import '../../styles/voces.css';

const TEST_TEXT_MAX = 120;

interface Playing {
  id: string;
  state: 'cargando' | 'sonando';
  progress: number;
}

interface Confirm {
  id: string;
  busy: boolean;
  error: string | null;
  /** true si el servidor ofrece quitarla solo del catálogo porque Fish Audio no dejó borrar el modelo. */
  canCatalogOnly: boolean;
}

export const VocesSection: React.FC<{ data: AdminData }> = ({ data }) => {
  const { voices, voicesError, reloadVoices } = data;
  const [testText, setTestText] = useState('Hola, chat. Bienvenidos al directo de hoy.');
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [rowNote, setRowNote] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const sound = useRef<{ audio: HTMLAudioElement | null; abort: AbortController | null; url: string | null }>({
    audio: null,
    abort: null,
    url: null,
  });

  const rows = useMemo(() => (voices ? sortAdminVoices(voices) : []), [voices]);

  const stopSound = () => {
    const now = sound.current;
    now.abort?.abort();
    if (now.audio) {
      now.audio.onended = null;
      now.audio.onerror = null;
      now.audio.ontimeupdate = null;
      now.audio.pause();
    }
    if (now.url) URL.revokeObjectURL(now.url);
    sound.current = { audio: null, abort: null, url: null };
    setPlaying(null);
  };

  useEffect(() => stopSound, []);

  const test = async (row: AdminVoiceRow) => {
    const wasPlaying = playing?.id === row.id;
    stopSound();
    if (wasPlaying) return;
    const text = testText.trim();
    if (!text) return;
    setRowNote(null);
    const abort = new AbortController();
    sound.current.abort = abort;
    setPlaying({ id: row.id, state: 'cargando', progress: 0 });
    try {
      const sample = await synthesizeSample(text, row.reference_id, abort.signal);
      if (abort.signal.aborted) {
        URL.revokeObjectURL(sample.url);
        return;
      }
      const audio = new Audio(sample.url);
      sound.current = { audio, abort, url: sample.url };
      audio.ontimeupdate = () => {
        if (audio.duration > 0) setPlaying({ id: row.id, state: 'sonando', progress: Math.min(1, audio.currentTime / audio.duration) });
      };
      audio.onended = stopSound;
      audio.onerror = () => {
        stopSound();
        setRowNote({ id: row.id, text: 'El navegador no pudo reproducir el audio.' });
      };
      if (sample.fallback) {
        setRowNote({
          id: row.id,
          text: 'Fish Audio no reconoció esta voz. Lo que suena es su voz base, no esta. Si la acabas de crear, espera un minuto y vuelve a probar.',
        });
      }
      setPlaying({ id: row.id, state: 'sonando', progress: 0 });
      await audio.play();
    } catch (err) {
      if (abort.signal.aborted) return;
      stopSound();
      setRowNote({
        id: row.id,
        text: err instanceof Error && err.name !== 'NotAllowedError' ? `No se pudo probar. ${err.message}` : 'El navegador no dejó sonar el audio.',
      });
    }
  };

  const change = async (row: AdminVoiceRow, action: () => Promise<void>) => {
    setBusyId(row.id);
    setRowNote(null);
    try {
      await action();
      await reloadVoices();
    } catch (err) {
      setRowNote({ id: row.id, text: voiceRpcProblem(err) });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: AdminVoiceRow, catalogOnly: boolean) => {
    setConfirm({ id: row.id, busy: true, error: null, canCatalogOnly: false });
    if (playing?.id === row.id) stopSound();
    try {
      const result = await deleteVoiceRequest(row.id, catalogOnly);
      setConfirm(null);
      setNotice(result.notice ? `${row.name}: ${result.notice}` : `${row.name} se eliminó del catálogo y de Fish Audio.`);
      await reloadVoices();
    } catch (err) {
      const api = err instanceof VoiceApiError ? err : null;
      setConfirm({
        id: row.id,
        busy: false,
        error: api?.message ?? 'No se pudo eliminar la voz.',
        canCatalogOnly: api?.canCatalogOnly ?? false,
      });
    }
  };

  const unreadable = voices === null;

  return (
    <div className="voc-console">
      <section className="cab-mod" aria-label="Catálogo de voces">
        <h2 className="adm-h2">
          Catálogo
          {voices && <small className="voc-count">{catalogueCount(voices)}</small>}
        </h2>

        {unreadable && !voicesError && <p className="cab-hint">Leyendo el catálogo.</p>}
        {unreadable && voicesError && (
          <>
            <p className="cab-error" role="alert">
              No se pudo leer el catálogo de voces: {voicesError}
            </p>
            <p className="cab-hint">
              Si es la primera vez, falta ejecutar la migración <span className="cab-mono">0009_voices.sql</span> en
              Supabase. Hasta entonces, los streamers siguen con las cinco voces de siempre.
            </p>
            <div>
              <button type="button" className="cab-btn2" onClick={reloadVoices}>
                Volver a comprobar
              </button>
            </div>
          </>
        )}

        {voices && (
          <>
            <div className="cab-field">
              <label className="cab-label" htmlFor="voc-test-text">
                Texto de prueba
              </label>
              <input
                id="voc-test-text"
                className="cab-inp"
                value={testText}
                maxLength={TEST_TEXT_MAX}
                onChange={(event) => setTestText(event.target.value)}
              />
            </div>

            {notice && (
              <p className="cab-note" role="status">
                {notice}
              </p>
            )}

            <ul className="voc-list">
              {rows.map((row) => {
                const isPlaying = playing?.id === row.id;
                const busy = busyId === row.id;
                const asking = confirm?.id === row.id ? confirm : null;
                return (
                  <li key={row.id} className="voc-item" data-fresh={fresh.includes(row.id) ? '' : undefined}>
                    <div className="voc-top">
                      <div>
                        <div className="voc-name">
                          <b>{row.name}</b>
                          {row.is_default && (
                            <span className="cab-chip" data-status="read">
                              Por defecto
                            </span>
                          )}
                          {!row.visible && <span className="cab-chip">Oculta</span>}
                          {fresh.includes(row.id) && (
                            <span className="cab-chip" data-status="skipped">
                              Nueva
                            </span>
                          )}
                        </div>
                        <p className="voc-desc">{row.description || 'Sin descripción.'}</p>
                      </div>
                      <label className="voc-vis">
                        <span>Visible</span>
                        <input
                          type="checkbox"
                          className="cab-tog"
                          checked={row.visible}
                          disabled={row.is_default || busy}
                          aria-label={`${row.name} visible para los streamers`}
                          onChange={(event) => {
                            const next = event.target.checked;
                            void change(row, () => setVoiceVisible(row.id, next));
                          }}
                        />
                      </label>
                    </div>
                    <p className="voc-meta">{voiceMetaLine(row)}</p>
                    <div className="voc-play" aria-hidden="true">
                      <i style={{ transform: `scaleX(${isPlaying ? playing.progress : 0})` }} />
                    </div>
                    <div className="voc-actions">
                      <button
                        type="button"
                        className="cab-btn2 cab-btn-sm"
                        disabled={!testText.trim()}
                        onClick={() => void test(row)}
                      >
                        {isPlaying ? (playing.state === 'cargando' ? 'Preparando' : 'Detener') : 'Probar'}
                      </button>
                      {!row.is_default && (
                        <>
                          <button
                            type="button"
                            className="cab-btn2 cab-btn-sm"
                            disabled={busy}
                            onClick={() => void change(row, () => setDefaultVoice(row.id))}
                          >
                            Hacer por defecto
                          </button>
                          <button
                            type="button"
                            className="cab-btn2 cab-btn-sm adm-danger"
                            disabled={busy || asking !== null}
                            onClick={() => setConfirm({ id: row.id, busy: false, error: null, canCatalogOnly: false })}
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                    {rowNote?.id === row.id && (
                      <p className="voc-msg" role="status">
                        {rowNote.text}
                      </p>
                    )}
                    {asking && (
                      <div className="voc-confirm" role="alert">
                        <span>
                          ¿Eliminar <b>{row.name}</b>? {deleteWarning(row)}
                        </span>
                        {asking.error && <span>{asking.error}</span>}
                        {asking.canCatalogOnly && (
                          <span>
                            Puedes quitarla solo del catálogo de Lalo. El modelo se quedará en Fish Audio y habrá que
                            borrarlo desde su web.
                          </span>
                        )}
                        <div className="voc-actions">
                          <button
                            type="button"
                            className="cab-btn2 cab-btn-sm adm-danger"
                            disabled={asking.busy}
                            onClick={() => void remove(row, false)}
                          >
                            {asking.busy ? 'Eliminando' : asking.error ? 'Volver a intentar' : 'Sí, eliminar'}
                          </button>
                          {asking.canCatalogOnly && (
                            <button
                              type="button"
                              className="cab-btn2 cab-btn-sm adm-danger"
                              disabled={asking.busy}
                              onClick={() => void remove(row, true)}
                            >
                              Quitar solo del catálogo
                            </button>
                          )}
                          <button type="button" className="cab-btn2 cab-btn-sm" disabled={asking.busy} onClick={() => setConfirm(null)}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="cab-hint">
              La voz por defecto es la que reciben los streamers cuya voz se oculta o se elimina. No se puede ocultar ni
              eliminar mientras lo sea. El recuento de streamers sale de los ajustes que cada uno ha guardado.
            </p>
          </>
        )}
      </section>

      <NuevaVozPanel
        existingNames={rows.map((row) => row.name)}
        available={!unreadable}
        onCreated={(result) => {
          setFresh((prev) => [...prev, result.voice.id]);
          setNotice(null);
          void reloadVoices();
        }}
      />
    </div>
  );
};
