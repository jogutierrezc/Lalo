/**
 * src/pages/admin/PersonajesSection.tsx
 *
 * Personajes de Mi AI (portal admin). Aquí el administrador crea, edita y borra
 * personajes (color, gestos y modelo de cada uno), marca el personaje por defecto
 * y decide qué modelos aparecen: habilitados, con su coste en créditos y el modelo
 * por defecto de cada proveedor. Asignar un personaje a cada streamer se hace en su
 * ficha, en Streamers.
 *
 * Todo pasa por /api/lux/characters y /api/lux/models: el servidor comprueba que
 * quien llama es administrador.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  LUX_GESTURE_LABELS,
  luxCharacterWrite,
  luxCharacters,
  luxModelSet,
  luxModels,
  luxSetModel,
  type LuxCharacterCatalog,
  type LuxCharacterRow,
  type LuxModelRow,
  type LuxProviderModels,
} from '../../lib/luxApi';

/** Borrador del formulario: un personaje nuevo (id null) o uno existente. model '' = modelo por defecto. */
interface Draft {
  id: string | null;
  name: string;
  color: string;
  gestures: string[];
  model: string;
  /** Avatar: 'lux' o 'glb:<id>' (modelo propio). */
  avatar: string;
  /** Cuenta dueña del personaje; '' = para todas las cuentas. */
  owner: string;
}

const COLOR_DEFAULT = '#f59e0b';

const draftOf = (character: LuxCharacterRow): Draft => ({
  id: character.id,
  name: character.name,
  color: character.color,
  gestures: [...character.gestures],
  model: character.model ?? '',
  avatar: character.avatar,
  owner: character.ownerProfileId ?? '',
});

/** Nombre legible de un avatar. Mascota 2 es el modelo GLB con dueña. */
const avatarLabel = (avatar: string): string => (avatar.startsWith('glb:') ? 'Mascota 2 (modelo propio)' : 'Lux (dibujo)');

/** Etiqueta de un modelo en una lista: nombre, coste en créditos y si es el por defecto. */
const modelOptionLabel = (model: LuxModelRow): string => {
  const cost = model.cost > 0 ? ` · ${model.cost} créditos` : '';
  const suffix = model.isDefault ? ' (por defecto)' : '';
  return `${model.label}${cost}${suffix}`;
};

export const PersonajesSection: React.FC = () => {
  const [catalog, setCatalog] = useState<LuxCharacterCatalog | null>(null);
  const [providers, setProviders] = useState<LuxProviderModels[]>([]);
  const [costMax, setCostMax] = useState(100000);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [chars, models] = await Promise.all([luxCharacters(), luxModels()]);
    if (chars.ok) setCatalog(chars.data);
    if (models.ok) {
      setProviders(models.data.providers);
      setCostMax(models.data.costMax);
    }
    const failed = !chars.ok ? chars.message : !models.ok ? models.message : null;
    setProblem(failed);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const finish = async (result: { ok: boolean; message?: string }, done: string) => {
    if (result.ok) {
      setNote(done);
      setProblem(null);
      await load();
    } else {
      setProblem(result.message ?? 'No se pudo guardar.');
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setDraftError(null);
    const res = await luxCharacterWrite({
      op: draft.id ? 'update' : 'create',
      id: draft.id ?? undefined,
      name: draft.name,
      color: draft.color,
      gestures: draft.gestures,
      model: draft.model || null,
      avatar: draft.avatar,
      ownerProfileId: draft.owner || null,
    });
    setBusy(false);
    if (res.ok) {
      setDraft(null);
      await finish(res, 'Personaje guardado.');
    } else {
      setDraftError(res.message);
    }
  };

  const removeCharacter = async (character: LuxCharacterRow) => {
    if (!window.confirm(`¿Borrar a ${character.name}? Sus recuerdos se borran con él y los streamers que lo usaban vuelven al personaje por defecto.`)) return;
    setBusy(true);
    const res = await luxCharacterWrite({ op: 'delete', id: character.id });
    setBusy(false);
    if (draft?.id === character.id) setDraft(null);
    await finish(res, `${character.name} borrado.`);
  };

  const makeDefault = async (character: LuxCharacterRow) => {
    setBusy(true);
    const res = await luxCharacterWrite({ op: 'default', id: character.id });
    setBusy(false);
    await finish(res, `${character.name} es ahora el personaje por defecto.`);
  };

  const setModel = async (provider: LuxProviderModels, model: LuxModelRow, patch: { enabled?: boolean; cost?: number }) => {
    setBusy(true);
    const res = await luxModelSet(provider.id, model.id, patch);
    setBusy(false);
    await finish(res, `${model.label} actualizado.`);
  };

  const setDefaultModel = async (provider: LuxProviderModels, model: LuxModelRow) => {
    setBusy(true);
    // El por defecto se guarda con la ruta de siempre; el servidor exige que sea habilitado y gratis.
    const res = await luxSetModel(model.id, provider.id);
    setBusy(false);
    await finish(res, `Modelo por defecto de ${provider.label}: ${model.label}.`);
  };

  const activeModels = catalog?.models ?? [];
  const pickable = activeModels.filter((model) => model.enabled || model.isDefault);

  return (
    <div className="grid gap-5">
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

      <section className="cab-mod grid gap-4" aria-labelledby="adm-characters">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="adm-characters" className="text-base font-semibold">
              Personajes
            </h2>
            <p className="cab-hint">
              Cada streamer tiene un personaje activo, que asignas desde su ficha en Streamers. Sus recuerdos son del personaje, no de la cuenta.
            </p>
          </div>
          <button
            type="button"
            className="cab-btn2 cab-btn-sm"
            disabled={busy}
            onClick={() => {
              setDraftError(null);
              setDraft({ id: null, name: '', color: COLOR_DEFAULT, gestures: [...(catalog?.gestures ?? Object.keys(LUX_GESTURE_LABELS))], model: '', avatar: 'lux', owner: '' });
            }}
          >
            Nuevo personaje
          </button>
        </div>

        {catalog === null && !problem && <p className="cab-hint">Leyendo los personajes.</p>}

        {catalog && catalog.characters.length === 0 && <p className="cab-hint">No hay personajes. Crea el primero.</p>}

        {catalog && catalog.characters.length > 0 && (
          <ul className="grid gap-2" aria-label="Personajes">
            {catalog.characters.map((character) => (
              <li key={character.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-current/10 pb-2">
                <div className="flex items-center gap-3">
                  <span className="inline-block h-4 w-4 rounded-full" style={{ background: character.color }} aria-hidden />
                  <span className="font-medium">{character.name}</span>
                  {character.isDefault && <span className="cab-hint">por defecto</span>}
                  <span className="cab-hint">
                    {character.model
                      ? (activeModels.find((model) => model.id === character.model)?.label ?? `${character.model} (ya no disponible)`)
                      : 'Modelo por defecto'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="cab-btn2 cab-btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setDraftError(null);
                      setDraft(draftOf(character));
                    }}
                  >
                    Editar {character.name}
                  </button>
                  {!character.isDefault && (
                    <>
                      <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => makeDefault(character)}>
                        Hacer por defecto
                      </button>
                      <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => removeCharacter(character)}>
                        Borrar {character.name}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {draft && (
          <form
            className="grid gap-4 border-t border-current/10 pt-4"
            aria-label={draft.id ? 'Editar personaje' : 'Nuevo personaje'}
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft();
            }}
          >
            <div className="cab-field">
              <label className="cab-label" htmlFor="adm-char-name">
                Nombre
              </label>
              <input
                id="adm-char-name"
                className="cab-inp"
                maxLength={40}
                value={draft.name}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="cab-field">
                <label className="cab-label" htmlFor="adm-char-color">
                  Color del pelo y del acento
                </label>
                <input
                  id="adm-char-color"
                  type="color"
                  className="cab-inp h-10 w-20"
                  value={draft.color}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                />
              </div>
              <div className="cab-field">
                <label className="cab-label" htmlFor="adm-char-model">
                  Modelo
                </label>
                <select id="adm-char-model" className="cab-inp" value={draft.model} disabled={busy} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
                  <option value="">Modelo por defecto{catalog ? ` (${catalog.defaultModel})` : ''}</option>
                  {pickable
                    .filter((model) => !model.isDefault)
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {modelOptionLabel(model)}
                      </option>
                    ))}
                </select>
                <span className="cab-hint">Si el modelo se deshabilita o supera el tope del plan, el personaje vuelve al por defecto.</span>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="cab-field">
                <label className="cab-label" htmlFor="adm-char-avatar">
                  Avatar
                </label>
                <select
                  id="adm-char-avatar"
                  className="cab-inp"
                  value={draft.avatar}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, avatar: e.target.value, owner: e.target.value.startsWith('glb:') ? draft.owner : '' })}
                >
                  {(catalog?.avatars ?? ['lux']).map((avatar) => (
                    <option key={avatar} value={avatar}>
                      {avatarLabel(avatar)}
                    </option>
                  ))}
                </select>
              </div>
              {draft.avatar.startsWith('glb:') && (
                <div className="cab-field">
                  <label className="cab-label" htmlFor="adm-char-owner">
                    Cuenta dueña (única que lo ve)
                  </label>
                  <select id="adm-char-owner" className="cab-inp" value={draft.owner} disabled={busy} onChange={(e) => setDraft({ ...draft, owner: e.target.value })}>
                    <option value="">Elegir cuenta</option>
                    {(catalog?.owners ?? []).map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.label}
                      </option>
                    ))}
                  </select>
                  <span className="cab-hint">Ninguna otra cuenta ve este personaje ni su modelo.</span>
                </div>
              )}
            </div>

            <fieldset className="grid gap-2">
              <legend className="cab-label">Gestos en el overlay</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(catalog?.gestures ?? []).map((gesture) => (
                  <label key={gesture} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.gestures.includes(gesture)}
                      disabled={busy}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          gestures: e.target.checked ? [...draft.gestures, gesture] : draft.gestures.filter((item) => item !== gesture),
                        })
                      }
                    />
                    {LUX_GESTURE_LABELS[gesture] ?? gesture}
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="cab-hint">Lux es el avatar por defecto. Mascota 2 usa un modelo propio que solo sirve a su cuenta dueña.</p>

            {draftError && (
              <p className="cab-error" role="alert">
                {draftError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="cab-btn2" disabled={busy || draft.name.trim() === ''}>
                {draft.id ? 'Guardar personaje' : 'Crear personaje'}
              </button>
              <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => setDraft(null)}>
                Cancelar
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="cab-mod grid gap-4" aria-labelledby="adm-models">
        <div className="grid gap-1">
          <h2 id="adm-models" className="text-base font-semibold">
            Modelos
          </h2>
          <p className="cab-hint">
            Qué modelos puede elegir un personaje. Cada respuesta cuesta los créditos que pongas aquí; el tope mensual lo pone cada plan en Límites.
            El modelo por defecto es gratis y no se puede deshabilitar: es el que usan los personajes cuando el suyo no puede.
          </p>
        </div>

        {providers.map((provider) => (
          <div key={provider.id} className="grid gap-2">
            <h3 className="cab-label">{provider.label}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="cab-label">
                    Modelo
                  </th>
                  <th scope="col" className="cab-label">
                    Habilitado
                  </th>
                  <th scope="col" className="cab-label">
                    Créditos por respuesta
                  </th>
                  <th scope="col" className="cab-label">
                    Por defecto
                  </th>
                </tr>
              </thead>
              <tbody>
                {provider.models.map((model) => (
                  <tr key={model.id} className="border-t border-current/10">
                    <td className="py-2 pr-3">
                      <span className="block">{model.label}</span>
                      <span className="cab-mono text-xs opacity-70">{model.id}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="cab-btn2 cab-btn-sm"
                        aria-pressed={model.enabled}
                        disabled={busy || model.isDefault}
                        onClick={() => setModel(provider, model, { enabled: !model.enabled })}
                      >
                        {model.enabled ? 'Sí' : 'No'}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <CostInput
                        label={`Créditos por respuesta de ${model.label}`}
                        value={model.cost}
                        max={costMax}
                        disabled={busy || model.isDefault}
                        onCommit={(value) => setModel(provider, model, { cost: value })}
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="radio"
                        name={`adm-default-${provider.id}`}
                        aria-label={`${model.label} por defecto de ${provider.label}`}
                        checked={model.isDefault}
                        disabled={busy || model.isDefault || !model.enabled || model.cost > 0}
                        onChange={() => setDefaultModel(provider, model)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  );
};

/** Coste en créditos: se guarda al salir del campo, como los límites del plan. */
const CostInput: React.FC<{ label: string; value: number; max: number; disabled: boolean; onCommit: (value: number) => void }> = ({
  label,
  value,
  max,
  disabled,
  onCommit,
}) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      min={0}
      max={max}
      aria-label={label}
      className="cab-inp cab-mono w-28"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = Math.max(0, Math.min(max, Math.round(Number(draft) || 0)));
        setDraft(String(next));
        if (next !== value) onCommit(next);
      }}
    />
  );
};
