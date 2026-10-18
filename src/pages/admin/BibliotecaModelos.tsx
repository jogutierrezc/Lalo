/**
 * src/pages/admin/BibliotecaModelos.tsx
 *
 * Biblioteca de modelos de Mi AI (portal admin). Dos partes:
 *   - Revisión: los modelos que subieron los creadores, privados o en revisión. El
 *     administrador los aprueba solo si confirma la licencia; si no, los rechaza.
 *   - Biblioteca compartida: lo que ven todos los creadores (Riot Games y los aprobados),
 *     con su aviso de licencia.
 *
 * El rol lo comprueba el servidor con la sesión (model-library, POST approve/reject).
 */

import React, { useEffect, useId, useState } from 'react';
import { luxModelLibrary, luxModelOp, type LuxLibraryModel, type LuxModelLibrary, type LuxReviewStatus } from '../../lib/luxApi';
import { describeModelFile } from '../../lib/luxModelUpload';

const STATUS_LABEL: Record<LuxReviewStatus, string> = { privado: 'Privado', pendiente: 'En revisión', aprobado: 'Aprobado' };
const STATUS_CHIP: Record<LuxReviewStatus, string | undefined> = { privado: undefined, pendiente: 'skipped', aprobado: 'read' };

export const BibliotecaModelos: React.FC = () => {
  const [data, setData] = useState<LuxModelLibrary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Confirmación de licencia por modelo: sin ella, aprobar está desactivado. */
  const [licensed, setLicensed] = useState<Record<string, boolean>>({});

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

  const ownerLabel = (model: LuxLibraryModel): string => {
    if (model.source === 'riot') return 'Riot Games';
    return data?.owners?.find((owner) => owner.id === model.ownerProfileId)?.label ?? 'Cuenta de un creador';
  };

  const review = data?.review ?? [];
  const shared = data?.library ?? [];

  return (
    <section className="cab-mod grid gap-4" aria-labelledby="adm-biblioteca">
      <h2 id="adm-biblioteca" className="text-base font-semibold">
        Biblioteca de modelos
      </h2>
      <p className="cab-hint">
        Un modelo que sube un creador queda privado. Entra en la biblioteca compartida solo cuando lo apruebas y confirmas su licencia.
      </p>

      {loadError && (
        <p className="cab-error" role="alert">
          No se pudo leer la biblioteca: {loadError}
        </p>
      )}

      {data && (
        <>
          <div className="grid gap-3">
            <h3 className="cab-label">A revisar</h3>
            {review.length === 0 && <p className="cab-hint">No hay modelos de creadores pendientes.</p>}
            {review.map((model) => (
              <ReviewRow
                key={model.id}
                model={model}
                owner={ownerLabel(model)}
                confirmed={licensed[model.id] === true}
                busy={busy}
                onConfirm={(value) => setLicensed((current) => ({ ...current, [model.id]: value }))}
                onApprove={() => run({ op: 'approve', id: model.id, licenseConfirmed: true }, 'Modelo publicado en la biblioteca.')}
                onReject={() => run({ op: 'reject', id: model.id }, 'Modelo devuelto a privado.')}
              />
            ))}
          </div>

          <div className="grid gap-3">
            <h3 className="cab-label">Biblioteca compartida</h3>
            {shared.length === 0 && <p className="cab-hint">Aún no hay modelos en la biblioteca compartida.</p>}
            {shared.map((model) => (
              <article key={model.id} className="grid gap-1 rounded-lg border border-current/15 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">{model.name}</strong>
                  <span className="cab-hint">{ownerLabel(model)}</span>
                  <span className="cab-chip" data-status={STATUS_CHIP[model.reviewStatus]}>
                    {STATUS_LABEL[model.reviewStatus]}
                  </span>
                </div>
                {describeModelFile({ name: model.fileName ?? model.name, bytes: model.bytes, uploadedAt: model.uploadedAt }) && (
                  <p className="cab-hint">{describeModelFile({ name: model.fileName ?? model.name, bytes: model.bytes, uploadedAt: model.uploadedAt })}</p>
                )}
                {model.licenseNotice && (
                  <p className="cab-note" role="note">
                    {model.licenseNotice}
                  </p>
                )}
                {model.source === 'creador' && (
                  <div>
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => run({ op: 'reject', id: model.id }, 'Modelo retirado de la biblioteca.')}>
                      Retirar de la biblioteca
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
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

/** Un modelo a revisar. Aprobar sigue desactivado hasta que el administrador confirma la licencia. */
export const ReviewRow: React.FC<{
  model: LuxLibraryModel;
  owner: string;
  confirmed: boolean;
  busy: boolean;
  onConfirm: (value: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
}> = ({ model, owner, confirmed, busy, onConfirm, onApprove, onReject }) => {
  const checkId = useId();
  const size = describeModelFile({ name: model.fileName ?? model.name, bytes: model.bytes, uploadedAt: model.uploadedAt });
  return (
    <article className="grid gap-2 rounded-lg border border-current/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{model.name}</strong>
        <span className="cab-hint">{owner}</span>
        <span className="cab-chip" data-status={STATUS_CHIP[model.reviewStatus]}>
          {STATUS_LABEL[model.reviewStatus]}
        </span>
      </div>
      {size && <p className="cab-hint">{size}</p>}
      <label className="flex items-center gap-2 text-sm" htmlFor={checkId}>
        <input id={checkId} type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => onConfirm(e.target.checked)} />
        Confirmo que la licencia de este modelo permite publicarlo en la biblioteca.
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy || !confirmed} onClick={onApprove}>
          Aprobar y publicar
        </button>
        <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={onReject}>
          Rechazar
        </button>
      </div>
    </article>
  );
};
