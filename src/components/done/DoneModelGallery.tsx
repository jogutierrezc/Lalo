/**
 * src/components/done/DoneModelGallery.tsx
 *
 * Galería de personajes de Done con previa de cada uno: las mascotas de Tally, Lux y todos los
 * GLB de la biblioteca compartida de Lux (los del administrador, los aprobados y los propios).
 * Filtros, búsqueda, cuota del plan, estados y subida de .glb (misma lógica de subida que Lux).
 * Las miniaturas 3D se generan una a una en un canvas compartido (thumbnails.ts) cuando la tarjeta
 * entra en pantalla; al pasar el cursor, el personaje saluda.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from 'lucide-react';
import { Boton, Pill } from '../tally-ui';
import { doneModelOp, doneUploadModel } from '../../lib/doneClient';
import type { LuxModelLibrary } from '../../lib/luxApi';
import { GALLERY_FILTERS, STATUS_LABEL, filterCatalog, quotaLabel, type CatalogEntry, type GalleryFilter } from './doneLogic';
import { CharacterView } from './CharacterView';
import { charThumbSvg } from './renderers/svgCharacter';
import { posterFor } from './thumbnails';
import { prefersReducedMotion } from './DoneOverlayView';
import type { ActorApi } from './renderers/types';

const TONE = { aprobado: 'ok', pendiente: 'warn', privado: 'neutral' } as const;

const Thumb: React.FC<{ entry: CatalogEntry; widgetKey: string; hot: boolean; retry: number; onResult: (id: string, ok: boolean) => void }> = ({ entry, widgetKey, hot, retry, onResult }) => {
  const host = useRef<HTMLDivElement>(null);
  const actor = useRef<ActorApi>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Carga perezosa: el póster 3D se pide cuando la tarjeta entra en pantalla.
  useEffect(() => {
    if (entry.kind === 'svg' || poster) return;
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    setFailed(false);
    const ask = () =>
      posterFor(entry, widgetKey).then((url) => {
        if (cancelled) return;
        if (url) setPoster(url);
        else setFailed(true);
        onResult(entry.id, Boolean(url));
      });
    if (typeof IntersectionObserver === 'undefined') {
      void ask();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting)) {
        io.disconnect();
        void ask();
      }
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [entry, widgetKey, poster, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = hot && !prefersReducedMotion() && (entry.kind === 'svg' || Boolean(widgetKey || entry.kind === 'lux'));
  const wave = () => void actor.current?.gesture('wave');

  return (
    <div className="done-card-th" ref={host}>
      {entry.kind === 'svg' && entry.palette && !live && <span dangerouslySetInnerHTML={{ __html: charThumbSvg(entry.palette) }} />}
      {entry.kind !== 'svg' && !live && (poster ? <img src={poster} alt="" /> : failed ? <Box size={36} aria-hidden="true" color="#9aa1ab" role="img" aria-label="Sin vista previa" /> : <span className="done-hint">Cargando…</span>)}
      {live && <CharacterView ref={actor} spec={entry} widgetKey={widgetKey} reducedMotion={false} onReady={wave} />}
    </div>
  );
};

interface Props {
  catalog: CatalogEntry[];
  library: LuxModelLibrary | null;
  selectedId: string;
  widgetKey: string;
  error: string | null;
  onSelect: (entry: CatalogEntry) => void;
  onReload: () => Promise<void>;
}

export const DoneModelGallery: React.FC<Props> = ({ catalog, library, selectedId, widgetKey, error, onSelect, onReload }) => {
  const [filter, setFilter] = useState<GalleryFilter>('todos');
  const [query, setQuery] = useState('');
  const [hot, setHot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);

  const onPoster = useCallback((id: string, ok: boolean) => {
    setFailedIds((prev) => {
      if (prev.has(id) === !ok) return prev;
      const next = new Set(prev);
      if (ok) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const shown = filterCatalog(catalog, filter, query);
  const selected = catalog.find((e) => e.id === selectedId);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    setProgress(0);
    const res = await doneUploadModel(file, setProgress);
    setBusy(false);
    setProgress(null);
    if (input.current) input.current.value = '';
    if (res.ok) {
      setNote('Modelo subido. Es privado: envíalo a revisión para que otros creadores puedan usarlo.');
      await onReload();
    } else setProblem(res.message);
  };

  const op = async (kind: 'submit' | 'remove', entry: CatalogEntry) => {
    if (!entry.modelId) return;
    if (kind === 'remove' && !window.confirm(`¿Quitar ${entry.name}? Se borra su archivo y deja de estar disponible.`)) return;
    setBusy(true);
    setProblem(null);
    const res = await doneModelOp({ op: kind, id: entry.modelId });
    setBusy(false);
    if (res.ok) {
      setNote(kind === 'submit' ? 'Enviado a revisión.' : 'Modelo quitado.');
      await onReload();
    } else setProblem(res.message);
  };

  const full = library ? library.left <= 0 : false;

  return (
    <div className="done-gal">
      <div className="done-gal-bar">
        <div className="done-field">
          <label htmlFor="done-gal-q">Buscar personaje</label>
          <input id="done-gal-q" type="search" className="done-input" value={query} placeholder="Nombre del personaje" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="tui-seg" role="group" aria-label="Filtrar personajes">
          {GALLERY_FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        {library && <p className="done-hint" data-testid="quota">{quotaLabel(library.used, library.limit)}</p>}
      </div>

      {error && <p className="done-note-dash" data-tone="bad" role="alert">No se pudo leer la biblioteca: {error}</p>}

      {failedIds.size > 0 && (
        <p className="done-note-dash" data-tone="bad" role="status">
          No se pudo generar la vista previa de {failedIds.size === 1 ? 'un personaje' : `${failedIds.size} personajes`}. Suele ser la red o el modelo.{' '}
          <button type="button" className="done-link" onClick={() => setRetry((n) => n + 1)}>Reintentar</button>
        </p>
      )}

      <div className="done-gal-grid" role="group" aria-label="Personajes">
        {shown.map((entry) => (
          <div key={entry.id} className="done-card-wrap">
            <div
              role="button"
              tabIndex={0}
              className="done-card"
              aria-pressed={entry.id === selectedId}
              aria-label={`Elegir ${entry.name}`}
              onClick={() => onSelect(entry)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(entry);
                }
              }}
              onPointerEnter={() => setHot(entry.id)}
              onPointerLeave={() => setHot((h) => (h === entry.id ? null : h))}
              onFocus={() => setHot(entry.id)}
              onBlur={() => setHot((h) => (h === entry.id ? null : h))}
            >
              <Thumb entry={entry} widgetKey={widgetKey} hot={hot === entry.id} retry={retry} onResult={onPoster} />
              <b>{entry.name}</b>
              <small>{entry.detail}</small>
              <span className="done-card-meta">
                <Pill tone={TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Pill>
                {entry.id === selectedId && <Pill tone="live">En uso</Pill>}
              </span>
            </div>
            {entry.deletable && (
              <span className="done-card-acts">
                {entry.status === 'privado' && (
                  <Boton pequeno disabled={busy} onClick={() => void op('submit', entry)}>
                    Enviar a revisión
                  </Boton>
                )}
                <Boton pequeno disabled={busy} onClick={() => void op('remove', entry)}>
                  Quitar
                </Boton>
              </span>
            )}
          </div>
        ))}
      </div>
      {shown.length === 0 && <p className="done-empty">No hay personajes con ese nombre o en ese filtro.</p>}

      {selected?.licenseNotice && (
        <p className="done-note-dash" role="note">
          {selected.licenseNotice}
        </p>
      )}
      {selected && selected.origin === 'mio' && selected.status !== 'aprobado' && <p className="done-note-dash">Solo tú lo ves hasta que el administrador lo apruebe.</p>}

      <div className="done-field">
        <div className="done-row">
          <Boton variante="principal" pequeno disabled={busy || full || !library || library.limit === 0} onClick={() => input.current?.click()}>
            Subir modelo
          </Boton>
          <input ref={input} type="file" accept=".glb,model/gltf-binary" hidden aria-label="Archivo .glb de tu modelo" onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
        <p className="done-hint">Archivos .glb de hasta 50 MB. Tu modelo queda privado hasta que el administrador lo revise y confirme su licencia.</p>
        {progress !== null && (
          <p className="done-hint" role="status">
            Subiendo… {Math.round(progress * 100)} %
          </p>
        )}
        {problem && (
          <p className="done-err" role="alert">
            {problem}
          </p>
        )}
        {note && !problem && (
          <p className="done-hint" role="status">
            {note}
          </p>
        )}
      </div>
    </div>
  );
};
