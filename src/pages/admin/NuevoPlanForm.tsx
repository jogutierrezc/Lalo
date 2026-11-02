/**
 * src/pages/admin/NuevoPlanForm.tsx
 *
 * Plan nuevo: nombre, identificador (se genera del nombre y se puede editar) y
 * límites. Valida en el navegador con validateNewPlan y crea con createPlan; el
 * servidor vuelve a validar. Los planes no se borran: se archivan en «Planes y precios».
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { slugifyPlanId, validateNewPlan } from '../../lib/adminLogic';
import { MB, createPlan } from '../../lib/cloud';
import { rpcErrorMessage, toBytes, type SizeUnit } from '../../lib/invitesLogic';

interface Props {
  onCreated: (name: string) => void | Promise<void>;
}

const MAX_FILE_MB = 50;

export const NuevoPlanForm: React.FC<Props> = ({ onCreated }) => {
  const uid = useId();
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [storage, setStorage] = useState('1');
  const [unit, setUnit] = useState<SizeUnit>('GB');
  const [fileMb, setFileMb] = useState('10');
  const [files, setFiles] = useState('100');
  const [credits, setCredits] = useState('0');
  const [models, setModels] = useState('0');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // El plan ya se creó pero la lista no se pudo recargar: no es un fallo de creación
  const [reloadFailed, setReloadFailed] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const effectiveId = idTouched ? planId : slugifyPlanId(name);

  const num = (raw: string) => (raw.trim() === '' ? NaN : Number(raw.replace(',', '.')));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    const storageAmount = num(storage);
    const fileAmount = num(fileMb);
    if (!Number.isFinite(storageAmount) || storageAmount < 0) return setProblem('El almacenamiento debe ser un número de 0 o más.');
    if (!Number.isFinite(fileAmount) || fileAmount < 0) return setProblem('El tamaño máximo por archivo debe ser un número de 0 o más.');
    if (fileAmount > MAX_FILE_MB) return setProblem(`Un archivo no puede pasar de ${MAX_FILE_MB} MB: es el tope de todo el almacenamiento.`);
    const check = validateNewPlan({
      id: effectiveId,
      name,
      storageLimitBytes: toBytes(storageAmount, unit),
      maxFileBytes: Math.round(fileAmount * MB),
      maxFiles: num(files),
      luxMonthlyCredits: num(credits),
      luxMaxModels: num(models),
    });
    if (!check.ok) return setProblem(check.error);
    setReloadFailed(null);
    setBusy(true);
    let createdName: string;
    try {
      const created = await createPlan(check.value);
      createdName = created.name || check.value.name;
    } catch (err) {
      if (!aliveRef.current) return;
      setProblem(rpcErrorMessage(err, 'No se pudo crear el plan.'));
      setBusy(false);
      return;
    }
    if (!aliveRef.current) return;
    setName('');
    setPlanId('');
    setIdTouched(false);
    await notifyCreated(createdName);
    if (aliveRef.current) setBusy(false);
  };

  // onCreated recarga la lista de planes; si eso falla el plan existe igual
  const notifyCreated = async (createdName: string) => {
    try {
      await onCreated(createdName);
      if (aliveRef.current) setReloadFailed(null);
    } catch {
      if (aliveRef.current) setReloadFailed(createdName);
    }
  };

  const retryReload = async () => {
    if (reloadFailed === null || retrying) return;
    setRetrying(true);
    await notifyCreated(reloadFailed);
    if (aliveRef.current) setRetrying(false);
  };

  return (
    <form className="cab-mod" onSubmit={submit} aria-labelledby={`${uid}-t`}>
      <h2 id={`${uid}-t`}>Crear plan nuevo</h2>
      <p className="cab-hint">
        Un plan nuevo aparece en «Planes y precios» para ponerle precio y sincronizarlo con PayPal, y en los códigos para regalarlo. Los planes no se
        borran: se archivan.
      </p>
      <div className="adm-form-grid">
        <div className="cab-field">
          <label className="cab-label" htmlFor={`${uid}-name`}>
            Nombre
          </label>
          <input id={`${uid}-name`} className="cab-inp" value={name} maxLength={40} placeholder="Por ejemplo, Pro" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="cab-field">
          <label className="cab-label" htmlFor={`${uid}-id`}>
            Identificador
          </label>
          <input
            id={`${uid}-id`}
            className="cab-inp cab-mono"
            value={effectiveId}
            maxLength={40}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={`${uid}-id-hint`}
            onChange={(e) => {
              setIdTouched(true);
              setPlanId(e.target.value.toLowerCase());
            }}
          />
          <span id={`${uid}-id-hint`} className="cab-hint">
            Se genera del nombre. Minúsculas, números y guiones; no se cambia después.
          </span>
        </div>
        <div className="cab-field">
          <label className="cab-label" htmlFor={`${uid}-sto`}>
            Almacenamiento
          </label>
          <div className="adm-size">
            <input id={`${uid}-sto`} type="number" min={0} step="any" inputMode="decimal" className="cab-inp cab-mono" value={storage} onChange={(e) => setStorage(e.target.value)} />
            <select aria-label="Unidad del almacenamiento" className="cab-inp" value={unit} onChange={(e) => setUnit(e.target.value as SizeUnit)}>
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </div>
        <div className="cab-field">
          <label className="cab-label" htmlFor={`${uid}-file`}>
            Máximo por archivo (MB)
          </label>
          <input id={`${uid}-file`} type="number" min={0} max={MAX_FILE_MB} step="any" inputMode="decimal" className="cab-inp cab-mono" value={fileMb} onChange={(e) => setFileMb(e.target.value)} />
        </div>
        <div className="cab-field">
          <label className="cab-label" htmlFor={`${uid}-files`}>
            Número de archivos
          </label>
          <input id={`${uid}-files`} type="number" min={0} step={1} inputMode="numeric" className="cab-inp cab-mono" value={files} onChange={(e) => setFiles(e.target.value)} />
        </div>
        <div className="cab-field">
          <label className="cab-label" htmlFor={`${uid}-cred`}>
            Créditos de Mi AI al mes
          </label>
          <input id={`${uid}-cred`} type="number" min={0} step={1} inputMode="numeric" className="cab-inp cab-mono" value={credits} onChange={(e) => setCredits(e.target.value)} />
        </div>
        <div className="cab-field">
          <label className="cab-label" htmlFor={`${uid}-mod`}>
            Modelos 3D propios de Mi AI
          </label>
          <input id={`${uid}-mod`} type="number" min={0} step={1} inputMode="numeric" className="cab-inp cab-mono" value={models} onChange={(e) => setModels(e.target.value)} />
        </div>
      </div>
      {problem && (
        <p className="cab-error" role="alert">
          {problem}
        </p>
      )}
      {reloadFailed !== null && (
        <div className="cab-note grid gap-2" role="alert">
          <p>Plan creado, pero no se pudo recargar la lista. «{reloadFailed}» ya existe: no lo vuelvas a crear.</p>
          <div>
            <button type="button" className="cab-btn2" onClick={retryReload} disabled={retrying}>
              {retrying ? 'Recargando' : 'Reintentar recarga'}
            </button>
          </div>
        </div>
      )}
      <div>
        <button type="submit" className="cab-btn" disabled={busy || !name.trim()}>
          {busy ? 'Creando' : 'Crear plan'}
        </button>
      </div>
    </form>
  );
};
