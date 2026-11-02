/**
 * src/components/done/DoneMemoryPanel.tsx
 *
 * Memoria de Done: lo que recuerda del canal. Añadir, editar, fijar y borrar pasan por
 * /api/done/memory. Los recuerdos del administrador se pueden usar, pero no editar ni borrar.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Boton, Pill } from '../tally-ui';
import { doneCreateMemory, doneDeleteMemory, doneMemories, doneUpdateMemory, type DoneMemory, type DoneMemoryList } from '../../lib/doneClient';

export const MEMORY_MAX = 300;

type Outcome = { ok: true } | { ok: false; message: string };

export const DoneMemoryPanel: React.FC = () => {
  const [list, setList] = useState<DoneMemoryList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'fact' | 'style'>('fact');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await doneMemories();
    if (res.ok) {
      setList(res.data);
      setLoadError(null);
    } else setLoadError(res.message);
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
    } else setActionError(res.message);
    setBusy(false);
  };

  const full = list !== null && list.saved >= list.savedMax;

  return (
    <section className="done-field" aria-labelledby="done-mem-h">
      <h3 id="done-mem-h" className="done-lbl">Lo que Done recuerda de tu canal</h3>
      {list && (
        <p className="done-hint" aria-live="polite">
          {list.usedInReply} de {list.usedMax} se usan en cada respuesta · {list.saved} de {list.savedMax} guardados
        </p>
      )}
      {list && !list.memoryEnabled && <p className="done-hint">La memoria está apagada en «Personalidad y respuestas»: Done no usa estos recuerdos al responder.</p>}

      <form
        className="done-field"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text && !busy) void run(() => doneCreateMemory(kind, text), () => setDraft(''));
        }}
      >
        <div className="tui-seg" role="group" aria-label="Tipo de recuerdo nuevo">
          <button type="button" aria-pressed={kind === 'fact'} onClick={() => setKind('fact')}>Dato</button>
          <button type="button" aria-pressed={kind === 'style'} onClick={() => setKind('style')}>Estilo</button>
        </div>
        <label htmlFor="done-mem-new">Añadir un recuerdo</label>
        <textarea
          id="done-mem-new"
          className="done-textarea"
          maxLength={MEMORY_MAX}
          value={draft}
          disabled={busy || full}
          placeholder={kind === 'fact' ? 'Por ejemplo: el canal juega los viernes' : 'Por ejemplo: digo «vamos equipo» al empezar'}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span className="done-count">{draft.length} de {MEMORY_MAX} caracteres</span>
        <div>
          <Boton type="submit" variante="principal" pequeno disabled={busy || full || draft.trim() === ''}>Añadir</Boton>
        </div>
        {full && <p className="done-hint">Llegaste al máximo. Borra alguno para añadir más.</p>}
      </form>

      {loadError && <p className="done-err" role="alert">No se pudo leer la memoria: {loadError}</p>}
      {list && list.memories.length === 0 && <p className="done-empty">Todavía no hay recuerdos.</p>}
      {list && list.memories.length > 0 && (
        <ul className="done-mem-list" aria-label="Recuerdos de Done">
          {list.memories.map((m: DoneMemory) => (
            <li key={m.id} className="done-mem-item">
              <div className="done-mem-chips">
                <Pill>{m.kind === 'style' ? 'Estilo' : 'Dato'}</Pill>
                {m.source === 'admin' && <Pill tone="warn">Del administrador</Pill>}
                {m.pinned && <Pill tone="ok">Fijado</Pill>}
              </div>
              {editing?.id === m.id ? (
                <>
                  <textarea className="done-textarea" aria-label="Editar recuerdo" maxLength={MEMORY_MAX} value={editing.text} disabled={busy} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} />
                  <div className="done-mem-acts">
                    <Boton pequeno disabled={busy || editing.text.trim() === ''} onClick={() => void run(() => doneUpdateMemory(m.id, { content: editing.text.trim() }), () => setEditing(null))}>Guardar</Boton>
                    <Boton pequeno disabled={busy} onClick={() => setEditing(null)}>Cancelar</Boton>
                  </div>
                </>
              ) : (
                <>
                  <p>{m.content}</p>
                  {m.source === 'admin' ? (
                    <p className="done-hint">Lo puso el administrador: se usa, pero no se edita ni se borra desde aquí.</p>
                  ) : confirming === m.id ? (
                    <div className="done-mem-acts">
                      <span className="done-hint">¿Borrar este recuerdo?</span>
                      <Boton pequeno variante="error" disabled={busy} onClick={() => void run(() => doneDeleteMemory(m.id), () => setConfirming(null))}>Sí, borrar</Boton>
                      <Boton pequeno disabled={busy} onClick={() => setConfirming(null)}>No, conservarlo</Boton>
                    </div>
                  ) : (
                    <div className="done-mem-acts">
                      <Boton pequeno aria-pressed={m.pinned} disabled={busy} onClick={() => void run(() => doneUpdateMemory(m.id, { pinned: !m.pinned }))}>{m.pinned ? 'Quitar fijado' : 'Fijar'}</Boton>
                      <Boton pequeno disabled={busy} onClick={() => setEditing({ id: m.id, text: m.content })}>Editar</Boton>
                      <Boton pequeno disabled={busy} onClick={() => setConfirming(m.id)}>Borrar</Boton>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {actionError && <p className="done-err" role="alert">{actionError}</p>}
    </section>
  );
};
