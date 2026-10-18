/**
 * src/components/lux/LuxMemoryPanel.tsx
 *
 * Pestaña Memoria de Lux AI: los recuerdos que Lux usa al responder. Crear, editar,
 * fijar y borrar pasan por /api/lux/memory: el navegador no escribe en la base de
 * datos. Los recuerdos del chat llevan su etiqueta y su fecha, y no se fijan solos.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { Field } from '../studio/StudioKit';
import { luxCreateMemory, luxDeleteMemory, luxMemories, luxUpdateMemory, type LuxMemory, type LuxMemoryKind, type LuxMemoryList } from '../../lib/luxApi';

const CONTENT_MAX = 300;
const KIND_LABEL: Record<LuxMemoryKind, string> = { fact: 'Dato', style: 'Estilo', viewer: 'Espectador', event: 'Suceso' };
const shortDate = (iso: string): string => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

type Outcome = { ok: true } | { ok: false; message: string };

export const LuxMemoryPanel: React.FC = () => {
  const [list, setList] = useState<LuxMemoryList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'fact' | 'style'>('fact');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await luxMemories();
    if (res.ok) {
      setList(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (action: () => Promise<Outcome>, done?: () => void) => {
    setBusy(true);
    setActionError(null);
    const res = await action();
    if (res.ok) {
      done?.();
      await reload();
    } else {
      setActionError(res.message);
    }
    setBusy(false);
  };

  const add = () => {
    const text = draft.trim();
    if (!text || busy) return;
    void run(() => luxCreateMemory(kind, text), () => setDraft(''));
  };

  const saveEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    void run(() => luxUpdateMemory(editing.id, { content: text }), () => setEditing(null));
  };

  const togglePin = (memory: LuxMemory) => {
    void run(() => luxUpdateMemory(memory.id, { pinned: !memory.pinned }));
  };

  const remove = (memory: LuxMemory) => {
    void run(() => luxDeleteMemory(memory.id), () => setConfirming(null));
  };

  const full = list !== null && list.saved >= list.savedMax;

  return (
    <section className="cab-mod grid gap-5" aria-labelledby="lux-memory">
      <div className="grid gap-1">
        <h2 id="lux-memory" className="text-base font-semibold">
          Memoria
        </h2>
        {list && (
          <p className="cab-hint" aria-live="polite">
            {list.usedInReply} de {list.usedMax} se usan en cada respuesta · {list.saved} de {list.savedMax} guardados
          </p>
        )}
        {list && !list.memoryEnabled && (
          <p className="cab-hint">La memoria está apagada en Ajustes: Lux no usa estos recuerdos al responder.</p>
        )}
      </div>

      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <div className="cab-seg" role="group" aria-label="Tipo de recuerdo nuevo">
          <button type="button" aria-pressed={kind === 'fact'} onClick={() => setKind('fact')}>
            Dato
          </button>
          <button type="button" aria-pressed={kind === 'style'} onClick={() => setKind('style')}>
            Estilo
          </button>
        </div>
        <p className="cab-hint">
          {kind === 'fact' ? 'Juego, horario o temas que no tocas.' : 'Muletillas y forma de hablar.'}
        </p>
        <Field label="Recuerdo nuevo" htmlFor="lux-memory-new" hint={`${draft.length} de ${CONTENT_MAX} caracteres`}>
          <textarea
            id="lux-memory-new"
            className="cab-inp min-h-20"
            maxLength={CONTENT_MAX}
            value={draft}
            disabled={busy || full}
            placeholder={kind === 'fact' ? 'Ejemplo: juego sobre todo a Valorant los martes.' : 'Ejemplo: digo «vamos equipo» al empezar.'}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="cab-btn2 transition-transform duration-150 active:scale-[0.97]" disabled={busy || full || draft.trim() === ''}>
            <Plus size={16} aria-hidden />
            Añadir recuerdo
          </button>
          {full && <span className="cab-hint">Llegaste a {list?.savedMax}. Borra alguno para añadir más.</span>}
        </div>
      </form>

      {loadError && (
        <p className="cab-error" role="alert">
          No se pudo leer la memoria: {loadError}
        </p>
      )}
      {list && list.memories.length === 0 && (
        <p className="cab-hint">Todavía no hay recuerdos. Lo que escribas aquí se usa en cada respuesta.</p>
      )}
      {list && list.memories.length > 0 && (
        <ul className="cab-rows" aria-label="Recuerdos de Lux">
          {list.memories.map((memory) => (
            <li key={memory.id} className="grid gap-2 border-[var(--cb-line)] px-3 py-3 [&+&]:border-t">
              <div className="flex flex-wrap items-center gap-2">
                <span className="cab-chip">{KIND_LABEL[memory.kind]}</span>
                {memory.source === 'chat' && <span className="cab-chip">Del chat · {shortDate(memory.createdAt)}</span>}
                {memory.source === 'admin' && <span className="cab-chip">Del administrador</span>}
                {memory.pinned && <span className="cab-chip">Fijado</span>}
                {memory.expiresAt && !memory.pinned && <span className="cab-hint">Caduca el {shortDate(memory.expiresAt)}</span>}
              </div>

              {editing?.id === memory.id ? (
                <div className="grid gap-2">
                  <textarea
                    className="cab-inp min-h-20"
                    aria-label="Editar recuerdo"
                    maxLength={CONTENT_MAX}
                    value={editing.text}
                    disabled={busy}
                    onChange={(event) => setEditing({ id: memory.id, text: event.target.value })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy || editing.text.trim() === ''} onClick={saveEdit}>
                      Guardar
                    </button>
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : memory.source === 'admin' ? (
                <>
                  <p className="break-words text-sm">{memory.content}</p>
                  <p className="cab-hint">Lo puso el administrador: se puede usar, pero no editar ni borrar desde aquí.</p>
                </>
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
                      aria-pressed={memory.pinned}
                      disabled={busy}
                      onClick={() => togglePin(memory)}
                    >
                      {memory.pinned ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />}
                      {memory.pinned ? 'Quitar fijado' : 'Fijar'}
                    </button>
                    <button
                      type="button"
                      className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
                      disabled={busy}
                      onClick={() => setEditing({ id: memory.id, text: memory.content })}
                    >
                      <Pencil size={16} aria-hidden />
                      Editar
                    </button>
                    <button
                      type="button"
                      className="cab-btn2 cab-btn-sm transition-transform duration-150 active:scale-[0.97]"
                      disabled={busy}
                      onClick={() => setConfirming(memory.id)}
                    >
                      <Trash2 size={16} aria-hidden />
                      Borrar
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {actionError && (
        <p className="cab-error" role="alert">
          {actionError}
        </p>
      )}
    </section>
  );
};
