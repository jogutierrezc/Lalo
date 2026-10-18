/**
 * src/components/lux/LuxModelLibrary.tsx
 *
 * Modelo 3D del personaje en el panel del creador (Mi AI). El creador elige el modelo
 * de su personaje entre la biblioteca compartida (Riot Games y los aprobados) y sus
 * propios modelos; sube los suyos hasta la cuota de su plan y los envía a revisión.
 *
 * No crea personajes ni elige el proveedor de IA ni el modelo de lenguaje: eso sigue
 * siendo del administrador. El servidor vuelve a comprobar todo (server/lux/handlers.ts,
 * acción model-library): aquí solo se muestra lo que el servidor deja ver.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { luxModelLibrary, luxModelOp, type LuxLibraryModel, type LuxModelLibrary as LibraryData, type LuxReviewStatus } from '../../lib/luxApi';
import { describeModelFile, uploadLibraryModel } from '../../lib/luxModelUpload';

const STATUS_LABEL: Record<LuxReviewStatus, string> = { privado: 'Privado', pendiente: 'En revisión', aprobado: 'Aprobado' };
/** Color del chip: aprobado en verde, en revisión en aviso, privado sin color. */
const STATUS_CHIP: Record<LuxReviewStatus, string | undefined> = { privado: undefined, pendiente: 'skipped', aprobado: 'read' };
const ORIGIN_FILTERS = [
  { value: 'todos', label: 'Todos' },
  { value: 'riot', label: 'Riot Games' },
  { value: 'creadores', label: 'Creadores' },
] as const;
type OriginFilter = (typeof ORIGIN_FILTERS)[number]['value'];

/** Tamaño y fecha del archivo, o «Modelo subido por terminal» si no hay datos. */
const fileText = (model: LuxLibraryModel): string | null =>
  describeModelFile({ name: model.fileName ?? model.name, bytes: model.bytes, uploadedAt: model.uploadedAt });

/** Lo que muestra el selector: la biblioteca y los modelos propios, sin repetir ninguno. */
function optionsOf(data: LibraryData): LuxLibraryModel[] {
  const byId = new Map<string, LuxLibraryModel>();
  for (const model of [...data.library, ...data.mine]) byId.set(model.id, model);
  return [...byId.values()];
}

/** Una opción del selector. Un modelo de Riot Games lleva su aviso de licencia, con el texto exacto del servidor. */
export const ModelOption: React.FC<{ model: LuxLibraryModel; groupName: string; checked: boolean; disabled: boolean; onChoose: () => void }> = ({
  model,
  groupName,
  checked,
  disabled,
  onChoose,
}) => (
  <div className="grid gap-1">
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <input type="radio" name={groupName} value={model.id} checked={checked} disabled={disabled} onChange={onChoose} />
      <span className="font-medium">{model.name}</span>
      <span className="cab-hint">
        {model.source === 'riot' ? 'Riot Games' : model.ownerProfileId ? 'Tuyo' : 'Biblioteca'}
        {fileText(model) ? ` · ${fileText(model)}` : ''}
      </span>
      {model.source === 'creador' && model.reviewStatus !== 'aprobado' && <span className="cab-hint">Solo tú lo ves hasta que se apruebe.</span>}
    </label>
    {model.licenseNotice && (
      <p className="cab-note" role="note">
        {model.licenseNotice}
      </p>
    )}
  </div>
);

export const LuxModelLibraryPanel: React.FC = () => {
  const [data, setData] = useState<LibraryData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<OriginFilter>('todos');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const groupName = useId();

  const reload = async () => {
    const res = await luxModelLibrary();
    if (res.ok) {
      setData(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.message);
    }
  };

  useEffect(() => {
    let alive = true;
    luxModelLibrary().then((res) => {
      if (!alive) return;
      if (res.ok) setData(res.data);
      else setLoadError(res.message);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** Una operación del servidor; si sale bien, vuelve a leer la biblioteca. */
  const run = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    setNote(null);
    const res = await luxModelOp(body);
    setBusy(false);
    if (res.ok) {
      setNote(done);
      await reload();
    } else {
      setProblem(res.message);
    }
  };

  const choose = (id: string | null) =>
    run({ op: 'choose', modelId: id }, id ? 'Modelo elegido para tu personaje.' : 'Tu personaje vuelve a su modelo por defecto.');

  const remove = (model: LuxLibraryModel) => {
    if (!window.confirm(`¿Quitar ${model.name}? Se borra su archivo y deja de estar disponible.`)) return;
    void run({ op: 'remove', id: model.id }, 'Modelo quitado.');
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    setProgress(0);
    const res = await uploadLibraryModel(file, (fraction) => setProgress(fraction));
    setBusy(false);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
    if (res.ok) {
      setNote('Modelo subido. Es privado: envíalo a revisión para que entre en la biblioteca.');
      await reload();
    } else {
      setProblem(res.message);
    }
  };

  const percent = progress === null ? null : Math.round(progress * 100);
  const needle = query.trim().toLowerCase();
  const options = data ? optionsOf(data).filter((model) => {
    if (origin === 'riot' && model.source !== 'riot') return false;
    if (origin === 'creadores' && model.source !== 'creador') return false;
    return needle === '' || model.name.toLowerCase().includes(needle);
  }) : [];
  const chosen = data?.chosen ?? null;

  return (
    <section className="cab-mod grid gap-4" aria-labelledby="lux-model-library">
      <h2 id="lux-model-library" className="text-base font-semibold">
        Modelo 3D de tu personaje
      </h2>
      <p className="cab-hint">
        Elige el modelo de tu personaje: uno de la biblioteca o uno tuyo. El administrador sigue asignando el personaje y el proveedor de IA.
      </p>

      {loadError && (
        <p className="cab-error" role="alert">
          No se pudo leer la biblioteca: {loadError}
        </p>
      )}

      {data && (
        <>
          <div className="grid gap-2">
            <label className="cab-label" htmlFor={searchId}>
              Buscar modelo
            </label>
            <input
              id={searchId}
              type="search"
              className="cab-inp"
              value={query}
              placeholder="Nombre del modelo"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="cab-seg" role="group" aria-label="Origen de los modelos">
              {ORIGIN_FILTERS.map((filter) => (
                <button key={filter.value} type="button" aria-pressed={origin === filter.value} onClick={() => setOrigin(filter.value)}>
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <fieldset className="grid gap-2" disabled={busy}>
            <legend className="cab-label">Modelo de tu personaje</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name={groupName} checked={chosen === null} onChange={() => choose(null)} />
              Por defecto (sin modelo propio)
            </label>
            {options.map((model) => (
              <ModelOption key={model.id} model={model} groupName={groupName} checked={chosen === model.id} disabled={busy} onChoose={() => choose(model.id)} />
            ))}
            {options.length === 0 && <p className="cab-hint">No hay modelos con ese nombre o de ese origen.</p>}
          </fieldset>

          <div className="grid gap-3">
            <h3 className="cab-label">Tus modelos</h3>
            <p className="cab-hint">
              {data.limit === 0
                ? 'Tu plan no incluye modelos propios.'
                : `Usas ${data.used} de ${data.limit} modelos de tu plan.`}
            </p>
            {data.mine.map((model) => (
              <article key={model.id} className="grid gap-2 rounded-lg border border-current/15 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">{model.name}</strong>
                  <span className="cab-chip" data-status={STATUS_CHIP[model.reviewStatus]}>
                    {STATUS_LABEL[model.reviewStatus]}
                  </span>
                </div>
                {fileText(model) && <p className="cab-hint">{fileText(model)}</p>}
                <div className="flex flex-wrap gap-2">
                  {model.reviewStatus === 'privado' && (
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => run({ op: 'submit', id: model.id }, 'Enviado a revisión.')}>
                      Enviar a revisión
                    </button>
                  )}
                  <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => remove(model)}>
                    Quitar
                  </button>
                </div>
              </article>
            ))}
            {data.mine.length === 0 && <p className="cab-hint">Aún no has subido ningún modelo.</p>}

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn2" disabled={busy || data.left <= 0} onClick={() => inputRef.current?.click()}>
                Subir modelo
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".glb,model/gltf-binary"
                hidden
                aria-label="Archivo .glb de tu modelo"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
            </div>
            <p className="cab-hint">Archivos .glb de hasta 50 MB. Un modelo tuyo queda privado hasta que el administrador lo revise y confirme su licencia.</p>
          </div>
        </>
      )}

      {percent !== null && (
        <div className="grid gap-1">
          <span className="cab-hint" aria-live="polite">
            Subiendo… {percent} %
          </span>
          <div className="cab-meter" role="progressbar" aria-label="Progreso de la subida del modelo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <i style={{ width: '100%', transform: `scaleX(${progress ?? 0})`, transformOrigin: 'left', transition: 'transform 200ms ease-out' }} />
          </div>
        </div>
      )}

      {problem && (
        <p className="cab-error" role="alert">
          {problem}
        </p>
      )}
      {note && !problem && (
        <p className="cab-hint" role="status">
          {note}
        </p>
      )}
    </section>
  );
};
