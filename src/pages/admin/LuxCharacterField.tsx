/**
 * src/pages/admin/LuxCharacterField.tsx
 *
 * Personaje de Mi AI de una cuenta, en su ficha de Streamers. El administrador
 * elige el personaje activo (uno por streamer) y ve el consumo de créditos del mes
 * frente al tope de su plan. El streamer no lo cambia.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { luxCharacterWrite, luxCharacters, type LuxCharacterCatalog } from '../../lib/luxApi';

export const LuxCharacterField: React.FC<{ profileId: string }> = ({ profileId }) => {
  const [catalog, setCatalog] = useState<LuxCharacterCatalog | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await luxCharacters(profileId);
    if (res.ok) {
      setCatalog(res.data);
      setProblem(null);
    } else {
      setProblem(res.message);
    }
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  const assign = async (characterId: string) => {
    setBusy(true);
    const res = await luxCharacterWrite({ op: 'assign', profile: profileId, characterId });
    setBusy(false);
    if (res.ok) await load();
    else setProblem(res.message);
  };

  const usage = catalog?.usage;
  const overBudget = usage !== undefined && usage.budget !== null && usage.credits >= usage.budget;
  const defaultName = catalog?.characters.find((character) => character.isDefault)?.name ?? 'Lux';

  return (
    <div className="cab-field">
      <label className="cab-label" htmlFor={`adm-lux-character-${profileId}`}>
        Personaje de Mi AI
      </label>
      <select
        id={`adm-lux-character-${profileId}`}
        className="cab-inp"
        value={catalog?.resolved ?? ''}
        disabled={busy || catalog === null}
        onChange={(e) => assign(e.target.value)}
      >
        {(catalog?.characters ?? []).map((character) => (
          <option key={character.id} value={character.id}>
            {character.name}
            {character.isDefault ? ' (por defecto)' : ''}
          </option>
        ))}
      </select>
      {usage && (
        <span className="cab-hint">
          Consumo de este mes: {usage.credits} créditos
          {usage.budget !== null ? ` de ${usage.budget} del plan` : ' (el plan no tiene tope)'}.
        </span>
      )}
      {overBudget && (
        <span className="cab-error" role="status">
          Ha llegado al tope del plan: sus personajes usan el modelo por defecto hasta el mes que viene.
        </span>
      )}
      {problem && (
        <span className="cab-error" role="alert">
          {problem}
        </span>
      )}
      <span className="cab-hint">
        Un personaje activo por streamer. Sus recuerdos y su modelo son del personaje. Si la cuenta no tiene asignado ninguno, usa {defaultName}.
      </span>
    </div>
  );
};
