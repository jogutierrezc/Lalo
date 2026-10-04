/**
 * src/pages/admin/CodigosSection.tsx
 *
 * Códigos de invitación: generar, copiar, revocar y compartir.
 *
 * Los códigos se comparten sin servicio de correo: se copia un mensaje con el
 * enlace de invitación o se abre el programa de correo del administrador con
 * el mensaje ya escrito. La app no envía nada por su cuenta.
 */

import React, { useId, useRef, useState } from 'react';
import { INVITE_SUBJECT, buildInviteLink, buildInviteMailto, buildInviteMessage, isEmailAddress } from '../../lib/access';
import { inviteState } from '../../lib/adminLogic';
import { rpc } from '../../lib/cloud';
import type { InviteCodeRow } from '../../lib/cloudTypes';
import { formatDate } from './adminFormat';
import type { AdminData } from './useAdminData';

export const CodigosSection: React.FC<{ data: AdminData }> = ({ data }) => {
  const { invites, plans, planName, reload, setError } = data;
  const uid = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Formulario de código nuevo
  const [newPlan, setNewPlan] = useState('');
  const [newUses, setNewUses] = useState(1);
  const [newDays, setNewDays] = useState(7);
  const [newNote, setNewNote] = useState('');

  // Invitación abierta para compartir (id del código) y su destinatario opcional
  const [shareId, setShareId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const recipientRef = useRef<HTMLInputElement | null>(null);

  const fail = (err: unknown, fallback: string) => setError(err instanceof Error ? err.message : fallback);

  const openShare = (id: string, focus: boolean) => {
    setShareId(id);
    setRecipient('');
    setCopyFailed(false);
    if (focus) setTimeout(() => recipientRef.current?.focus(), 0);
  };

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const expires = newDays > 0 ? new Date(Date.now() + newDays * 86400000).toISOString() : null;
      const created = await rpc('admin_create_invite', {
        p_plan: newPlan || null,
        p_max_uses: Math.max(1, newUses),
        p_expires_at: expires,
        p_note: newNote.trim() || null,
      });
      setNewNote('');
      setNotice(`Código ${created.code} creado. Abajo tienes la invitación para compartirlo.`);
      setError(null);
      await reload();
      openShare(created.id, false);
    } catch (err) {
      fail(err, 'No se pudo crear el código.');
    }
  };

  const revokeInvite = async (id: string) => {
    try {
      await rpc('admin_revoke_invite', { p_invite: id });
      if (shareId === id) setShareId(null);
      await reload();
    } catch (err) {
      fail(err, 'No se pudo revocar el código.');
    }
  };

  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(text);
        setTimeout(() => setCopied(null), 1600);
      })
      .catch(() => setNotice('No se pudo copiar. Selecciona el texto y cópialo a mano.'));
  };

  const inviteMessage = (invite: InviteCodeRow) =>
    buildInviteMessage({
      origin: window.location.origin,
      code: invite.code,
      planName: planName(invite.plan_id),
      expires: invite.expires_at ? formatDate(invite.expires_at) : null,
    });

  // Copia el mensaje completo. Si el navegador no deja, se abre la invitación con el texto seleccionado.
  const copyInvite = async (invite: InviteCodeRow) => {
    const key = `invite:${invite.id}`;
    try {
      if (!navigator.clipboard) throw new Error('Sin portapapeles');
      await navigator.clipboard.writeText(inviteMessage(invite));
      setCopyFailed(false);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      setShareId(invite.id);
      setCopyFailed(true);
      setTimeout(() => {
        messageRef.current?.focus();
        messageRef.current?.select();
      }, 0);
    }
  };

  const shared = invites.find((invite) => invite.id === shareId && inviteState(invite).open) || null;
  const recipientBad = recipient.trim().length > 0 && !isEmailAddress(recipient);

  return (
    <>
      {notice && (
        <p className="cab-hint" role="status">
          {notice}
        </p>
      )}

      <form className="cab-mod" onSubmit={createInvite}>
        <h2>Generar código</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-plan`}>
              Plan
            </label>
            <select id={`${uid}-plan`} className="cab-inp" value={newPlan} onChange={(e) => setNewPlan(e.target.value)}>
              <option value="">Plan por defecto</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </div>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-uses`}>
              Usos
            </label>
            <input
              id={`${uid}-uses`}
              type="number"
              min={1}
              max={100}
              className="cab-inp cab-mono w-24"
              value={newUses}
              onChange={(e) => setNewUses(Number(e.target.value) || 1)}
            />
          </div>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-days`}>
              Caduca
            </label>
            <select id={`${uid}-days`} className="cab-inp" value={newDays} onChange={(e) => setNewDays(Number(e.target.value))}>
              <option value={7}>En 7 días</option>
              <option value={30}>En 30 días</option>
              <option value={0}>Sin caducidad</option>
            </select>
          </div>
          <div className="cab-field min-w-[180px] flex-1">
            <label className="cab-label" htmlFor={`${uid}-note`}>
              Para quién (opcional)
            </label>
            <input
              id={`${uid}-note`}
              className="cab-inp"
              value={newNote}
              maxLength={120}
              placeholder="Nombre o canal"
              onChange={(e) => setNewNote(e.target.value)}
            />
          </div>
          <button type="submit" className="cab-btn">
            Generar
          </button>
        </div>
        <p className="cab-hint">
          «Para quién» es una nota solo para ti: no se envía ni aparece en la invitación. Lalo no guarda correos.
        </p>
      </form>

      {shared && (
        <section className="cab-mod" aria-label={`Invitación del código ${shared.code}`}>
          <h2>
            Invitación <b className="cab-mono">{shared.code}</b>
          </h2>
          <p className="cab-hint">
            Plan {planName(shared.plan_id)}
            {shared.note ? ` · Para ${shared.note}` : ''} · Enlace:{' '}
            <span className="cab-mono">{buildInviteLink(window.location.origin, shared.code)}</span>
          </p>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-msg`}>
              Mensaje
            </label>
            <textarea
              id={`${uid}-msg`}
              ref={messageRef}
              className="cab-inp adm-invite-msg"
              readOnly
              rows={8}
              value={inviteMessage(shared)}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          {copyFailed && (
            <p className="cab-error" role="alert">
              El navegador no dejó copiar. El mensaje está seleccionado: cópialo con Ctrl+C.
            </p>
          )}
          <div className="cab-field max-w-md">
            <label className="cab-label" htmlFor={`${uid}-to`}>
              Correo del streamer (opcional)
            </label>
            <input
              id={`${uid}-to`}
              ref={recipientRef}
              type="email"
              className="cab-inp"
              value={recipient}
              autoComplete="off"
              spellCheck={false}
              placeholder="nombre@correo.com"
              aria-describedby={`${uid}-to-hint`}
              onChange={(e) => setRecipient(e.target.value)}
            />
            <span id={`${uid}-to-hint`} className="cab-hint">
              Solo se usa para abrir el correo; no se guarda. Si lo dejas vacío, escribes la dirección en tu programa de
              correo.
            </span>
          </div>
          {recipientBad && (
            <p className="cab-error" role="alert">
              Esa dirección no parece un correo. Corrígela o deja el campo vacío.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="cab-btn" onClick={() => copyInvite(shared)}>
              {copied === `invite:${shared.id}` ? 'Invitación copiada' : 'Copiar invitación'}
            </button>
            {recipientBad ? (
              <button type="button" className="cab-btn2" disabled>
                Enviar por correo
              </button>
            ) : (
              <a className="cab-btn2" href={buildInviteMailto(recipient, INVITE_SUBJECT, inviteMessage(shared))}>
                Enviar por correo
              </a>
            )}
            <button type="button" className="cab-btn2" onClick={() => setShareId(null)}>
              Cerrar
            </button>
          </div>
          <p className="cab-note">
            «Enviar por correo» abre tu propio programa de correo con el mensaje escrito; el envío lo haces tú desde ahí.
            Lalo no manda correos. Si no se abre nada, este equipo no tiene un programa de correo configurado: copia la
            invitación y pégala donde quieras.
          </p>
        </section>
      )}

      {invites.length === 0 ? (
        <p className="cab-note">No hay códigos todavía. El primero que generes aparecerá aquí para compartirlo.</p>
      ) : (
        <div className="adm-table">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Plan</th>
                <th>Usos</th>
                <th>Caducidad</th>
                <th>Para quién</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => {
                const state = inviteState(invite);
                return (
                  <tr key={invite.id}>
                    <td className="cab-mono">
                      <b>{invite.code}</b>
                    </td>
                    <td>{planName(invite.plan_id)}</td>
                    <td className="cab-mono">
                      {invite.used_count} de {invite.max_uses}
                    </td>
                    <td>{formatDate(invite.expires_at)}</td>
                    <td>{invite.note}</td>
                    <td>
                      <span className="cab-chip" data-status={state.chip}>
                        {state.label}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => copy(invite.code)}>
                          {copied === invite.code ? 'Copiado' : 'Copiar código'}
                        </button>
                        {state.open && (
                          <>
                            <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => copyInvite(invite)}>
                              {copied === `invite:${invite.id}` ? 'Invitación copiada' : 'Copiar invitación'}
                            </button>
                            <button
                              type="button"
                              className="cab-btn2 cab-btn-sm"
                              aria-expanded={shareId === invite.id}
                              onClick={() => openShare(invite.id, true)}
                            >
                              Enviar por correo
                            </button>
                            <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => revokeInvite(invite.id)}>
                              Revocar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
