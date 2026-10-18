/**
 * src/pages/admin/StreamerMemory.tsx
 *
 * Sección «Memoria de Lux» de la ficha de un streamer (portal admin). El
 * administrador escribe un recuerdo, o pega o sube un .txt o .md: el servidor lo
 * parte en recuerdos de hasta 300 caracteres y el administrador revisa la lista
 * antes de guardar. Lo que guarda lleva la etiqueta «Del administrador», no
 * caduca y solo él lo edita o lo borra. Todo pasa por /api/lux/admin-memory, y
 * el servidor vuelve a validar cada recuerdo.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  luxAdminDelete,
  luxAdminMemories,
  luxAdminSave,
  luxAdminSplit,
  luxAdminUpdate,
  type LuxAdminMemoryList,
  type LuxMemory,
  type LuxMemoryKind,
  type LuxSplitChunk,
} from '../../lib/luxApi';

/** Mismo límite que server/lux/memory.ts (MEMORY_CONTENT_MAX). */
const CONTENT_MAX = 300;
/** Mismo límite que server/lux/memory.ts (ADMIN_UPLOAD_MAX_BYTES). */
const FILE_MAX_BYTES = 50 * 1024;
const KIND_LABEL: Record<LuxMemoryKind, string> = { fact: 'Dato', style: 'Estilo', viewer: 'Espectador', event: 'Suceso' };
const SOURCE_LABEL: Record<LuxMemory['source'], string> = { manual: 'Del streamer', chat: 'Del chat', admin: 'Del administrador' };

type Review = { chunks: LuxSplitChunk[]; room: number };

export const StreamerMemory: React.FC<{ profileId: string; name: string }> = ({ profileId, name }) => {
  const [list, setList] = useState<LuxAdminMemoryList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'fact' | 'style'>('fact');
  const [draft, setDraft] = useState('');
  const [paste, setPaste] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await luxAdminMemories(profileId);
    if (res.ok) {
      setList(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.message);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Ejecuta una acción del servidor; si sale bien, recarga la lista. */
  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: () => void) => {
    setBusy(true);
    setMessage(null);
    const res = await action();
    if (res.ok) {
      done?.();
      await reload();
    } else {
      setMessage(res.message);
    }
    setBusy(false);
  };

  const split = async (text: string) => {
    setBusy(true);
    setMessage(null);
    const res = await luxAdminSplit(profileId, text);
    if (res.ok) {
      setReview({ chunks: res.data.chunks, room: res.data.room });
    } else {
      setMessage(res.message);
    }
    setBusy(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) {
      setMessage(`El archivo pesa más de ${FILE_MAX_BYTES / 1024} KB. Divídelo en partes más pequeñas.`);
      return;
    }
    const text = await file.text();
    await split(text);
  };

  const saveSingle = () => {
    const text = draft.trim();
    if (!text || busy) return;
    void run(() => luxAdminSave(profileId, kind, [text]), () => setDraft(''));
  };

  const saveReview = () => {
    if (!review) return;
    const items = review.chunks.map((chunk) => chunk.content.trim()).filter((text) => text !== '');
    void run(() => luxAdminSave(profileId, kind, items), () => {
      setReview(null);
      setPaste('');
    });
  };

  const saveEdit = (memory: LuxMemory) => {
    if (!editing || editing.id !== memory.id) return;
    const text = editing.text.trim();
    if (!text) return;
    void run(() => luxAdminUpdate(profileId, memory.id, text), () => setEditing(null));
  };

  const remove = (memory: LuxMemory) => {
    void run(() => luxAdminDelete(profileId, memory.id), () => setConfirming(null));
  };

  const updateChunk = (index: number, content: string) => {
    setReview((current) =>
      current ? { ...current, chunks: current.chunks.map((chunk, i) => (i === index ? { content, blocked: null } : chunk)) } : current
    );
  };

  const removeChunk = (index: number) => {
    setReview((current) => (current ? { ...current, chunks: current.chunks.filter((_, i) => i !== index) } : current));
  };

  const count = review ? review.chunks.filter((chunk) => chunk.content.trim() !== '').length : 0;
  const blockedCount = review ? review.chunks.filter((chunk) => chunk.blocked).length : 0;
  const full = list !== null && list.saved >= list.savedMax;
  const tooMany = review !== null && count > review.room;

  return (
    <div className="cab-field" aria-labelledby={`adm-memory-${profileId}`}>
      <span id={`adm-memory-${profileId}`} className="cab-label">
        Memoria de Lux
      </span>
      <span className="cab-hint" aria-live="polite">
        {list ? `${list.saved} de ${list.savedMax} guardados` : 'Cargando…'}. Lux usa estos recuerdos al responder a {name}.
      </span>
      {loadError && (
        <p className="cab-error" role="alert">
          No se pudo leer la memoria: {loadError}
        </p>
      )}

      <div className="grid gap-3 pt-1">
        <div className="cab-seg" role="group" aria-label={`Tipo de recuerdo nuevo para ${name}`}>
          <button type="button" aria-pressed={kind === 'fact'} onClick={() => setKind('fact')}>
            Dato
          </button>
          <button type="button" aria-pressed={kind === 'style'} onClick={() => setKind('style')}>
            Estilo
          </button>
        </div>
        <label className="cab-label" htmlFor={`adm-memory-one-${profileId}`}>
          Un recuerdo
        </label>
        <textarea
          id={`adm-memory-one-${profileId}`}
          className="cab-inp min-h-20"
          maxLength={CONTENT_MAX}
          value={draft}
          disabled={busy || full}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
            disabled={busy || full || draft.trim() === ''}
            onClick={saveSingle}
          >
            Guardar recuerdo
          </button>
          <span className="cab-hint">{draft.length} de {CONTENT_MAX}</span>
        </div>

        <label className="cab-label" htmlFor={`adm-memory-paste-${profileId}`}>
          Texto largo
        </label>
        <textarea
          id={`adm-memory-paste-${profileId}`}
          className="cab-inp min-h-24"
          value={paste}
          disabled={busy || full}
          onChange={(event) => setPaste(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
            disabled={busy || full || paste.trim() === ''}
            onClick={() => void split(paste)}
          >
            Dividir en recuerdos
          </button>
          <label className="cab-btn2 cab-btn-sm cursor-pointer transition-transform duration-150 active:scale-[0.97]">
            Subir .txt o .md
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              className="sr-only"
              disabled={busy || full}
              onChange={(event) => {
                void onFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          <span className="cab-hint">Hasta {FILE_MAX_BYTES / 1024} KB. Cada recuerdo, de hasta {CONTENT_MAX} caracteres.</span>
        </div>
        {full && <p className="cab-note">Esta cuenta ya tiene {list?.savedMax} recuerdos. Borra alguno para añadir más.</p>}
      </div>

      {message && (
        <p className="cab-error" role="alert">
          {message}
        </p>
      )}

      {review && (
        <div className="grid gap-3 pt-2" role="region" aria-label="Revisión de los recuerdos antes de guardar">
          <p className="cab-hint" aria-live="polite">
            {review.chunks.length} recuerdos como «{KIND_LABEL[kind]}». Revísalos antes de guardar. Hay {review.room} huecos libres.
            {tooMany && ` Sobran ${count - review.room}: quita algunos.`}
          </p>
          <ol className="grid gap-2">
            {review.chunks.map((chunk, index) => (
              <li key={index} className="grid gap-2">
                <textarea
                  className="cab-inp min-h-16"
                  aria-label={`Recuerdo ${index + 1} de ${review.chunks.length}`}
                  maxLength={CONTENT_MAX}
                  value={chunk.content}
                  disabled={busy}
                  onChange={(event) => updateChunk(index, event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {chunk.blocked && (
                    <span className="cab-chip" data-status="rejected">
                      No se puede guardar: contiene {chunk.blocked}
                    </span>
                  )}
                  <button
                    type="button"
                    className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
                    disabled={busy}
                    onClick={() => removeChunk(index)}
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {blockedCount > 0 && (
            <p className="cab-note">Quita o cambia los recuerdos marcados: no se pueden guardar tal como están.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
              disabled={busy || count === 0 || tooMany || blockedCount > 0}
              onClick={saveReview}
            >
              Guardar {count} {count === 1 ? 'recuerdo' : 'recuerdos'}
            </button>
            <button
              type="button"
              className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {list && list.memories.length === 0 && <p className="cab-hint">Esta cuenta todavía no tiene recuerdos.</p>}
      {list && list.memories.length > 0 && (
        <ul className="cab-rows" aria-label={`Recuerdos de Lux de ${name}`}>
          {list.memories.map((memory) => (
            <li key={memory.id} className="grid gap-2 border-[var(--cb-line)] px-3 py-3 [&+&]:border-t">
              <div className="flex flex-wrap items-center gap-2">
                <span className="cab-chip">{KIND_LABEL[memory.kind]}</span>
                <span className="cab-chip">{SOURCE_LABEL[memory.source]}</span>
              </div>

              {memory.source !== 'admin' ? (
                <p className="break-words text-sm">{memory.content}</p>
              ) : editing?.id === memory.id ? (
                <div className="grid gap-2">
                  <textarea
                    className="cab-inp min-h-16"
                    aria-label="Editar recuerdo del administrador"
                    maxLength={CONTENT_MAX}
                    value={editing.text}
                    disabled={busy}
                    onChange={(event) => setEditing({ id: memory.id, text: event.target.value })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
                      disabled={busy || editing.text.trim() === ''}
                      onClick={() => saveEdit(memory)}
                    >
                      Guardar
                    </button>
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : confirming === memory.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">¿Borrar este recuerdo?</span>
                  <button type="button" className="cab-btn2 cab-btn-sm cab-btn-danger" disabled={busy} onClick={() => remove(memory)}>
                    Sí, borrar
                  </button>
                  <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => setConfirming(null)}>
                    No, conservarlo
                  </button>
                </div>
              ) : (
                <>
                  <p className="break-words text-sm">{memory.content}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
                      disabled={busy}
                      onClick={() => setEditing({ id: memory.id, text: memory.content })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
                      disabled={busy}
                      onClick={() => setConfirming(memory.id)}
                    >
                      Borrar
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
