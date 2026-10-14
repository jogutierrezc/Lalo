/**
 * src/pages/admin/ImportarElevenVoz.tsx
 *
 * Añade al catálogo una voz que ya existe en la cuenta de ElevenLabs (clonada o
 * diseñada allí). Solo hace falta su voice_id: no se sube audio. Nace oculta; el
 * administrador la hace visible desde la lista, y solo la verán los streamers
 * con ElevenLabs activado.
 */

import React, { useId, useState } from 'react';
import { VoiceApiError, importElevenVoiceRequest, type CreateVoiceResult } from '../../lib/voicesCloud';

export const ImportarElevenVoz: React.FC<{ available: boolean; onCreated: (result: CreateVoiceResult) => void }> = ({
  available,
  onCreated,
}) => {
  const uid = useId();
  const [voiceId, setVoiceId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState<'own' | 'other'>('own');
  const [permissionBy, setPermissionBy] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const ready = available && !busy && voiceId.trim().length >= 12 && confirmed && (owner === 'own' || permissionBy.trim().length >= 2);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await importElevenVoiceRequest({
        voiceId: voiceId.trim(),
        name: name.trim(),
        description: description.trim(),
        owner,
        permissionBy: owner === 'other' ? permissionBy.trim() : '',
        confirmed,
      });
      onCreated(result);
      setOutcome({ ok: true, text: `Voz «${result.voice.name}» añadida, oculta. Pruébala y hazla visible desde la lista.` });
      setVoiceId('');
      setName('');
      setDescription('');
      setPermissionBy('');
      setConfirmed(false);
    } catch (err) {
      setOutcome({ ok: false, text: err instanceof VoiceApiError ? err.message : 'No se pudo añadir la voz.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cab-mod" aria-label="Importar una voz de ElevenLabs">
      <h2>Importar voz de ElevenLabs</h2>
      <p className="cab-hint">
        Para voces que ya tienes creadas en tu cuenta de ElevenLabs. Pega su ID (en ElevenLabs: Voces, la voz, «Copiar ID de voz»). Si prefieres crearla desde
        aquí con tus muestras, usa «Nueva voz» y elige el motor ElevenLabs.
      </p>
      <div className="cab-field">
        <label className="cab-label" htmlFor={`${uid}-id`}>ID de la voz</label>
        <input id={`${uid}-id`} className="cab-inp cab-mono" value={voiceId} autoComplete="off" spellCheck={false} onChange={(e) => setVoiceId(e.target.value)} />
      </div>
      <div className="cab-field">
        <label className="cab-label" htmlFor={`${uid}-name`}>Nombre en Lalo (opcional)</label>
        <input id={`${uid}-name`} className="cab-inp" value={name} maxLength={18} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="cab-field">
        <label className="cab-label" htmlFor={`${uid}-desc`}>Descripción (opcional)</label>
        <input id={`${uid}-desc`} className="cab-inp" value={description} maxLength={70} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="cab-field">
        <label className="cab-label" htmlFor={`${uid}-owner`}>¿De quién es la voz?</label>
        <select id={`${uid}-owner`} className="cab-inp" value={owner} onChange={(e) => setOwner(e.target.value as 'own' | 'other')}>
          <option value="own">Mía</option>
          <option value="other">De otra persona, con su permiso</option>
        </select>
      </div>
      {owner === 'other' && (
        <div className="cab-field">
          <label className="cab-label" htmlFor={`${uid}-who`}>Quién dio el permiso</label>
          <input id={`${uid}-who`} className="cab-inp" value={permissionBy} maxLength={60} onChange={(e) => setPermissionBy(e.target.value)} />
        </div>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>Confirmo que tengo derecho a usar esta voz en Lalo.</span>
      </label>
      <div>
        <button type="button" className="cab-btn2" disabled={!ready} onClick={submit}>
          {busy ? 'Comprobando en ElevenLabs…' : 'Añadir al catálogo'}
        </button>
      </div>
      {outcome && (
        <p className="cab-note" role="status" data-ok={outcome.ok}>
          {outcome.text}
        </p>
      )}
    </section>
  );
};
