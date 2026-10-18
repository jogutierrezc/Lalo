/**
 * tests/luxModelLibraryUi.test.tsx
 *
 * Pantallas de la biblioteca de modelos (se renderizan a HTML, sin navegador):
 *   - el aviso de Riot Games sale con su texto exacto en el selector del panel del creador;
 *   - un modelo de creador sin aprobar avisa de que solo lo ve su dueño;
 *   - el administrador no puede aprobar un modelo sin confirmar la licencia (botón desactivado);
 *   - el panel de Mi AI del creador incluye la sección del modelo de su personaje.
 *
 * La interacción (subida, aprobación, elección) la cubre tests/luxModelLibrary.test.ts
 * contra el servidor. R2 real, Supabase real y el navegador no se prueban aquí.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LuxLibraryModel } from '../src/lib/luxApi';

const session = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }));

vi.mock('../src/hooks/useCloudSession', () => ({
  useCloudSession: () => ({ profile: session.profile }),
}));
vi.mock('../src/components/SuiteNav', () => ({ SuiteNav: () => null }));
vi.mock('../src/lib/luxApi', () => ({
  luxGetSettings: () => new Promise(() => {}),
  luxSaveSettings: () => new Promise(() => {}),
  luxAsk: () => new Promise(() => {}),
  luxCharacterView: () => new Promise(() => {}),
  luxModelLibrary: () => new Promise(() => {}),
  luxModelOp: () => new Promise(() => {}),
}));

import { ModelOption } from '../src/components/lux/LuxModelLibrary';
import { ReviewRow } from '../src/pages/admin/BibliotecaModelos';
import { LuxAI } from '../src/pages/LuxAI';

/** renderToStaticMarkup escapa comillas y apóstrofes; se devuelve el texto legible para comparar. */
const readable = (html: string): string => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const RIOT_NOTICE = 'was created under Riot Games\'s "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.';

const riot: LuxLibraryModel = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Warwick',
  source: 'riot',
  ownerProfileId: null,
  fileName: 'warwick.glb',
  bytes: 9 * 1024 * 1024,
  uploadedAt: '2026-10-18T10:00:00.000Z',
  reviewStatus: 'aprobado',
  licenseConfirmed: true,
  licenseNotice: RIOT_NOTICE,
};

const privado: LuxLibraryModel = {
  id: '00000000-0000-4000-8000-0000000000d1',
  name: 'Mi robot',
  source: 'creador',
  ownerProfileId: '00000000-0000-4000-8000-0000000000a1',
  fileName: 'robot.glb',
  bytes: 2 * 1024 * 1024,
  uploadedAt: null,
  reviewStatus: 'privado',
  licenseConfirmed: false,
  licenseNotice: null,
};

describe('selector del panel del creador', () => {
  it('el modelo de Riot Games muestra el aviso de licencia con su texto exacto', () => {
    const html = readable(renderToStaticMarkup(<ModelOption model={riot} groupName="g" checked={false} disabled={false} onChoose={() => {}} />));
    expect(html).toContain(RIOT_NOTICE);
    expect(html).toContain('Riot Games');
  });

  it('un modelo propio sin aprobar avisa de que solo lo ve su dueño y no lleva aviso de Riot', () => {
    const html = readable(renderToStaticMarkup(<ModelOption model={privado} groupName="g" checked={false} disabled={false} onChoose={() => {}} />));
    expect(html).toContain('Solo tú lo ves hasta que se apruebe.');
    expect(html).not.toContain('Legal Jibber Jabber');
  });
});

describe('revisión del administrador', () => {
  it('no se puede aprobar sin confirmar la licencia: el botón sale desactivado', () => {
    const html = renderToStaticMarkup(
      <ReviewRow model={privado} owner="Creador" confirmed={false} busy={false} onConfirm={() => {}} onApprove={() => {}} onReject={() => {}} />
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Aprobar y publicar<\/button>/);
  });

  it('con la licencia confirmada, aprobar queda activo', () => {
    const html = renderToStaticMarkup(
      <ReviewRow model={privado} owner="Creador" confirmed={true} busy={false} onConfirm={() => {}} onApprove={() => {}} onReject={() => {}} />
    );
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Aprobar y publicar<\/button>/);
  });
});

describe('panel de Mi AI del creador', () => {
  it('con Mi AI activada, incluye la sección del modelo de su personaje', () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: true };
    const html = renderToStaticMarkup(<LuxAI />);
    // La biblioteca se carga en el navegador: al renderizar en el servidor solo se ve la sección.
    expect(html).toContain('Modelo 3D de tu personaje');
  });
});
