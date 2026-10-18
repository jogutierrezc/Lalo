/**
 * src/pages/admin/ModeloPersonajeBlock.tsx
 *
 * Bloque «Modelo 3D» de la ficha de un personaje con avatar «glb:<id>» (Mi AI, portal
 * admin). Muestra el archivo actual (nombre, tamaño y fecha), deja elegir el origen
 * (Riot Games o propio), sube un GLB nuevo con barra de progreso y quita el modelo.
 *
 * Solo el administrador llega aquí. El servidor vuelve a comprobar el rol con la sesión.
 * Si el modelo es de Riot Games se muestra el aviso de licencia, con su texto exacto.
 */

import React, { useRef, useState } from 'react';
import type { LuxCharacterRow } from '../../lib/luxApi';
import { MODEL_ORIGIN_LABEL, describeModelFile, removeCharacterModel, uploadCharacterModel, type ModelOrigin } from '../../lib/luxModelUpload';

const ORIGINS: ModelOrigin[] = ['riot', 'propio'];

export const ModeloPersonajeBlock: React.FC<{ character: LuxCharacterRow; onChanged: () => Promise<void> | void }> = ({ character, onChanged }) => {
  const [origin, setOrigin] = useState<ModelOrigin | null>(
    character.modelOrigin === 'riot' || character.modelOrigin === 'propio' ? character.modelOrigin : null
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasModel = character.modelFile !== null && character.modelFile !== undefined;
  const current = describeModelFile(character.modelFile ?? null);
  const percent = progress === null ? null : Math.round(progress * 100);

  const pick = async (file: File | undefined) => {
    if (!file || !origin) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    setProgress(0);
    const res = await uploadCharacterModel(character.id, file, origin, (fraction) => setProgress(fraction));
    setBusy(false);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
    if (res.ok) {
      setNote('Modelo subido.');
      await onChanged();
    } else {
      setProblem(res.message);
    }
  };

  const remove = async () => {
    if (!window.confirm(`¿Quitar el modelo de ${character.name}? Mientras no haya otro, el overlay muestra a Lux.`)) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    const res = await removeCharacterModel(character.id);
    setBusy(false);
    if (res.ok) {
      setNote('Modelo quitado.');
      await onChanged();
    } else {
      setProblem(res.message);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="cab-label">Modelo 3D</h3>
        <p className="text-sm">{current ?? 'Sin modelo subido. Mientras tanto, el overlay muestra a Lux.'}</p>
      </div>

      <fieldset className="grid gap-2">
        <legend className="cab-label">Origen del modelo al subir</legend>
        <div className="flex flex-wrap gap-4">
          {ORIGINS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`modelo-origen-${character.id}`}
                value={option}
                checked={origin === option}
                disabled={busy}
                onChange={() => setOrigin(option)}
              />
              {MODEL_ORIGIN_LABEL[option]}
            </label>
          ))}
        </div>
        <span className="cab-hint">Elige el origen antes de subir. Un modelo de Riot Games lleva el aviso de licencia en la ficha, en el panel del streamer y en el overlay.</span>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="cab-btn2" disabled={busy || origin === null} onClick={() => inputRef.current?.click()}>
          Subir modelo
        </button>
        <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy || !hasModel} onClick={remove}>
          Quitar
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".glb,model/gltf-binary"
          hidden
          aria-label="Archivo .glb del modelo"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

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

      {character.licenseNotice && (
        <p className="cab-note" role="note">
          {character.licenseNotice}
        </p>
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
    </div>
  );
};
