import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudTournamentStore, panelTransport, widgetTournamentStore, widgetTransport } from '../src/lib/tournamentCloud';
import { fetchPublicTournament, registerTeam } from '../src/lib/tournamentSignupApi';
import { localTournamentStore, type TournamentStore } from '../src/lib/tournamentStore';
import { DEFAULT_TOURNAMENT_SETTINGS, type TournamentState, emptyTournamentState, normalizeTournamentSettings, normalizeTournamentState } from '../src/types/tournament';
import { applyWinner, isNewerState, replaceTeams } from '../src/utils/tournamentLogic';
import {
  REGISTER_CODES,
  REGISTER_MESSAGES,
  SLUG_RE,
  draftSlug,
  normalizeEntries,
  normalizePublicTournament,
  parseSignupRoute,
  proposeSlug,
  publicRowFromSettings,
  registerCodeOf,
  signupUrl,
  slugProblem,
  teamFromEntry,
  validateSignup,
} from '../src/utils/tournamentSignup';

// ---------- Una nube de mentira ----------

const KEY = 'k'.repeat(64);
const PROFILE = '00000000-0000-4000-8000-000000000001';

interface Row {
  state: unknown;
  version: number;
}

/**
 * Lo justo de un cliente de Supabase para estas pruebas: las dos funciones de
 * widget y la tabla tournament_state, con la misma regla de versión que la base.
 */
function fakeCloud(initial: Row | null = null) {
  const cloud = {
    row: initial as Row | null,
    /** true: toda llamada falla, como sin conexión. */
    down: false,
    /** true: widget_tournament_apply responde con el tope por minuto. */
    busy: false,
    rpcs: [] as { name: string; args: Record<string, unknown> }[],
    /** Respuestas preparadas para las funciones públicas. */
    answers: {} as Record<string, unknown>,
  };
  const failed = { data: null, error: { message: 'sin conexión', code: '' } };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    cloud.rpcs.push({ name, args });
    if (cloud.down) return failed;
    if (name in cloud.answers) return { data: cloud.answers[name], error: null };
    // La misma comprobación que la base: una clave que no es la del streamer no da nada
    if (args.p_key !== KEY) return { data: null, error: null };
    if (name === 'widget_tournament_state') {
      if (!cloud.row) return { data: { version: 0, state: null }, error: null };
      if (args.p_have === cloud.row.version) return { data: { version: cloud.row.version }, error: null };
      return { data: { version: cloud.row.version, state: cloud.row.state }, error: null };
    }
    if (name === 'widget_tournament_apply') {
      const base = args.p_base_version as number;
      const current = cloud.row?.version ?? 0;
      if (base !== current) return { data: { ok: false, code: 'conflict', version: current, state: cloud.row?.state ?? null }, error: null };
      if (cloud.busy) return { data: { ok: false, code: 'busy' }, error: null };
      cloud.row = { state: args.p_state, version: current + 1 };
      return { data: { ok: true, version: current + 1 }, error: null };
    }
    return failed;
  };

  /** Una consulta a tournament_state: se resuelve al esperarla, como las de Supabase. */
  const from = () => {
    const query = { op: 'select' as 'select' | 'insert' | 'update', columns: '', payload: null as Record<string, unknown> | null, filters: {} as Record<string, unknown> };
    const mine = () => query.filters.profile_id === PROFILE;
    const settle = () => {
      if (cloud.down) return failed;
      if (query.op === 'insert') {
        if (cloud.row) return { data: null, error: { message: 'duplicate key', code: '23505' } };
        cloud.row = { state: query.payload?.state, version: query.payload?.version as number };
        return { data: null, error: null };
      }
      if (query.op === 'update') {
        // Solo cambia la fila que sigue en la versión pedida
        if (!cloud.row || !mine() || cloud.row.version !== query.filters.version) return { data: [], error: null };
        cloud.row = { state: query.payload?.state, version: query.payload?.version as number };
        return { data: [{ version: cloud.row.version }], error: null };
      }
      if (!cloud.row || !mine()) return { data: null, error: null };
      return { data: query.columns === 'version' ? { version: cloud.row.version } : { state: cloud.row.state, version: cloud.row.version }, error: null };
    };
    const builder = {
      select: (columns: string) => {
        if (query.op === 'select') query.columns = columns;
        return builder;
      },
      insert: (payload: Record<string, unknown>) => {
        query.op = 'insert';
        query.payload = payload;
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        query.op = 'update';
        query.payload = payload;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        query.filters[column] = value;
        return builder;
      },
      maybeSingle: async () => settle(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(settle()).then(resolve),
    };
    return builder;
  };

  return { cloud, client: { rpc, from } as unknown as SupabaseClient };
}

/** Un almacén local en memoria, para no depender de localStorage ni del bus. */
function memoryStore(initial: TournamentState | null = null) {
  let saved = initial;
  const listeners = new Set<(state: TournamentState, forced?: boolean) => void>();
  const store: TournamentStore = {
    read: () => saved,
    write: (state) => {
      saved = state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { store, emit: (state: TournamentState) => listeners.forEach((listener) => listener(state)) };
}

const team = (id: string, name: string) => ({ id, name, captain: '', players: [] });
/** Una llave de 4 con sus cuatro equipos, sin resultados. */
function bracket(now = 1000): TournamentState {
  return normalizeTournamentState(
    replaceTeams(emptyTournamentState(4), [team('t1', 'Lobos'), team('t2', 'Dragones'), team('t3', 'Nexo'), team('t4', 'Tormenta')], now)
  );
}
const win = (state: TournamentState, index: number, now: number): TournamentState => applyWinner(state, index, now) as TournamentState;

afterEach(() => {
  vi.useRealTimers();
});

// ---------- El almacén de la nube ----------

describe('Torneos: almacén de la nube', () => {
  it('lectura: la fuente de OBS empieza con el estado y la versión de la nube', async () => {
    const saved = bracket();
    const { cloud, client } = fakeCloud({ state: saved, version: 3 });
    const local = memoryStore();
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: local.store });

    expect(store.read()).toBeNull();
    expect(store.cloud?.()).toBe(false);
    await store.prime();

    expect(store.read()).toEqual(saved);
    expect(store.cloud?.()).toBe(true);
    // La copia de este navegador se pone al día: es lo que se ve al recargar sin conexión
    expect(local.store.read()).toEqual(saved);
    expect(cloud.rpcs.map((call) => call.name)).toEqual(['widget_tournament_state']);
    store.stop();
  });

  it('lectura: si la versión no cambió, la respuesta viene sin estado y no se toca nada', async () => {
    const { cloud, client } = fakeCloud({ state: bracket(), version: 3 });
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: memoryStore().store });
    const heard = vi.fn();
    await store.prime();
    store.subscribe(heard);
    await store.settled();

    expect(cloud.rpcs[1]).toEqual({ name: 'widget_tournament_state', args: { p_key: KEY, p_have: 3 } });
    expect(heard).not.toHaveBeenCalled();
    store.stop();
  });

  it('escritura con versión: cada cambio dice sobre qué versión se hizo y la versión sube de uno en uno', async () => {
    const start = bracket();
    const { cloud, client } = fakeCloud({ state: start, version: 3 });
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: memoryStore().store });
    await store.prime();

    const first = win(start, 0, 2000);
    store.write(first);
    await store.settled();
    expect(cloud.row).toEqual({ state: first, version: 4 });

    const second = win(first, 2, 3000);
    store.write(second);
    await store.settled();
    expect(cloud.row).toEqual({ state: second, version: 5 });

    const bases = cloud.rpcs.filter((call) => call.name === 'widget_tournament_apply').map((call) => call.args.p_base_version);
    expect(bases).toEqual([3, 4]);
    store.stop();
  });

  it('escritura sin estado previo: la primera se guarda como versión 1', async () => {
    const { cloud, client } = fakeCloud();
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: memoryStore().store });
    const state = bracket();
    store.write(state);
    await store.settled();
    expect(cloud.row).toEqual({ state, version: 1 });
    expect(store.cloud?.()).toBe(true);
    store.stop();
  });

  it('conflicto: manda la nube; el cambio local se descarta y quien escucha adopta el estado vigente', async () => {
    const start = bracket();
    const { cloud, client } = fakeCloud({ state: start, version: 3 });
    const local = memoryStore();
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: local.store });
    const heard = vi.fn();
    await store.prime();
    store.subscribe(heard);
    await store.settled();

    // Mientras tanto el panel marca un resultado: la nube pasa a la versión 4
    const theirs = win(start, 0, 2000);
    cloud.row = { state: theirs, version: 4 };

    // La fuente, que sigue en la 3, marca otro más tarde: su fecha es posterior
    const mine = win(start, 1, 9000);
    expect(isNewerState(mine, theirs)).toBe(true);
    store.write(mine);
    await store.settled();

    // No se pisa el resultado que llegó antes
    expect(cloud.row).toEqual({ state: theirs, version: 4 });
    expect(store.read()).toEqual(theirs);
    expect(local.store.read()).toEqual(theirs);
    // El aviso llega como obligado: hay que adoptarlo aunque su fecha sea anterior
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(theirs, true);

    // Y lo siguiente ya se escribe sobre la versión vigente
    const next = win(theirs, 2, 9500);
    store.write(next);
    await store.settled();
    expect(cloud.row).toEqual({ state: next, version: 5 });
    store.stop();
  });

  it('un cambio hecho antes de conocer la nube no pisa el estado que ya había en ella', async () => {
    const theirs = win(bracket(), 0, 2000);
    const { cloud, client } = fakeCloud({ state: theirs, version: 7 });
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: memoryStore().store });
    store.write(bracket(5000));
    await store.settled();
    expect(cloud.row).toEqual({ state: theirs, version: 7 });
    expect(store.read()).toEqual(theirs);
    store.stop();
  });

  it('consulta cada pocos segundos mientras alguien escucha y entrega los cambios ajenos', async () => {
    vi.useFakeTimers();
    const start = bracket();
    const { cloud, client } = fakeCloud({ state: start, version: 1 });
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: memoryStore().store, pollMs: 3000 });
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toHaveBeenCalledWith(start, true);

    // Un moderador escribe !ganador y lo guarda otra fuente
    const theirs = win(start, 1, 2000);
    cloud.row = { state: theirs, version: 2 };
    await vi.advanceTimersByTimeAsync(3000);
    expect(heard).toHaveBeenLastCalledWith(theirs, true);
    expect(store.read()).toEqual(theirs);

    // Sin nadie escuchando deja de preguntar
    stop();
    const asked = cloud.rpcs.length;
    await vi.advanceTimersByTimeAsync(12000);
    expect(cloud.rpcs.length).toBe(asked);
    store.stop();
  });

  it('sin respuesta de la nube sigue como el almacén local y reintenta lo pendiente', async () => {
    vi.useFakeTimers();
    const start = bracket();
    const { cloud, client } = fakeCloud({ state: start, version: 2 });
    const local = memoryStore();
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: local.store, pollMs: 3000 });
    const heard = vi.fn();
    store.subscribe(heard);
    await vi.advanceTimersByTimeAsync(0);
    heard.mockClear();

    cloud.down = true;
    const mine = win(start, 0, 2000);
    store.write(mine);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.cloud?.()).toBe(false);
    expect(store.read()).toEqual(mine);
    expect(local.store.read()).toEqual(mine);
    expect(cloud.row?.version).toBe(2);

    // Sin nube, lo que el almacén local recibe (bus, ajustes sincronizados) se reenvía sin obligar
    const fromBus = win(mine, 2, 3000);
    local.emit(fromBus);
    expect(heard).toHaveBeenLastCalledWith(fromBus);

    // Vuelve la conexión: en la siguiente consulta se sube lo pendiente
    cloud.down = false;
    await vi.advanceTimersByTimeAsync(3000);
    expect(cloud.row).toEqual({ state: mine, version: 3 });
    expect(store.cloud?.()).toBe(true);
    store.stop();
  });

  it('el tope por minuto no pierde el cambio: se reintenta', async () => {
    const start = bracket();
    const { cloud, client } = fakeCloud({ state: start, version: 1 });
    const store = createCloudTournamentStore(widgetTransport(client, KEY), { local: memoryStore().store });
    await store.prime();
    cloud.busy = true;
    const mine = win(start, 0, 2000);
    store.write(mine);
    await store.settled();
    expect(cloud.row?.version).toBe(1);
    expect(store.read()).toEqual(mine);

    cloud.busy = false;
    await store.prime();
    expect(cloud.row).toEqual({ state: mine, version: 2 });
    store.stop();
  });

  it('sin clave, sin nube o con una clave corta se queda el almacén local de siempre', () => {
    const { cloud, client } = fakeCloud({ state: bracket(), version: 1 });
    expect(widgetTournamentStore(client, null)).toBe(localTournamentStore);
    expect(widgetTournamentStore(client, '')).toBe(localTournamentStore);
    expect(widgetTournamentStore(client, 'corta')).toBe(localTournamentStore);
    expect(widgetTournamentStore(null, KEY)).toBe(localTournamentStore);
    expect(cloud.rpcs).toEqual([]);
    expect(widgetTournamentStore(client, KEY)).not.toBe(localTournamentStore);
  });

  it('una clave que no es de nadie no lee ni escribe: el estado se queda en este navegador', async () => {
    const { cloud, client } = fakeCloud({ state: bracket(), version: 4 });
    const kept = bracket(500);
    const local = memoryStore(kept);
    const store = createCloudTournamentStore(widgetTransport(client, 'x'.repeat(64)), { local: local.store });
    await store.prime();
    expect(store.cloud?.()).toBe(false);
    expect(store.read()).toEqual(kept);

    store.write(win(kept, 0, 900));
    await store.settled();
    expect(cloud.row?.version).toBe(4);
    store.stop();
  });

  it('panel: lee su fila, sube la llave de este navegador si la nube estaba vacía y escribe con control de versión', async () => {
    const mine = bracket();
    const { cloud, client } = fakeCloud();
    const store = createCloudTournamentStore(panelTransport(client, PROFILE), { local: memoryStore(mine).store, seed: true });
    await store.prime();
    await store.settled();
    // Primera vez con la nube: lo que había aquí pasa a ser la versión 1
    expect(cloud.row).toEqual({ state: mine, version: 1 });

    const next = win(mine, 0, 2000);
    store.write(next);
    await store.settled();
    expect(cloud.row).toEqual({ state: next, version: 2 });

    // OBS guarda un resultado antes que el panel: el del panel no entra
    const theirs = win(next, 2, 2500);
    cloud.row = { state: theirs, version: 3 };
    const heard = vi.fn();
    store.subscribe(heard);
    store.write(win(next, 3, 8000));
    await store.settled();
    expect(cloud.row).toEqual({ state: theirs, version: 3 });
    expect(heard).toHaveBeenCalledWith(theirs, true);
    expect(store.read()).toEqual(theirs);
    store.stop();
  });

  it('panel: solo ve la fila de su cuenta', async () => {
    const { client } = fakeCloud({ state: bracket(), version: 2 });
    const other = panelTransport(client, '00000000-0000-4000-8000-000000000002');
    expect(await other.pull(null)).toEqual({ version: 0, state: null });
  });
});

// ---------- Slug y dirección ----------

describe('Torneos: dirección de la inscripción', () => {
  it('propone un slug a partir del nombre: sin tildes, sin espacios y en minúsculas', () => {
    expect(proposeSlug('Copa Lalo')).toBe('copa-lalo');
    expect(proposeSlug('  ¡Copa Ñandú 2026!  ')).toBe('copa-nandu-2026');
    expect(proposeSlug('Torneo: Verano / Invierno')).toBe('torneo-verano-invierno');
    // Demasiado corto o sin nada aprovechable: sale uno que vale igual
    expect(proposeSlug('LJ')).toBe('torneo-lj');
    expect(proposeSlug('!!!')).toBe('mi-torneo');
    ['Copa Lalo', 'LJ', '!!!', 'a'.repeat(80), '日本語の大会', 'x'].forEach((name) => expect(proposeSlug(name)).toMatch(SLUG_RE));
  });

  it('mientras se escribe solo deja lo que cabe en una dirección', () => {
    expect(draftSlug('Copa Lalo ')).toBe('copa-lalo-');
    expect(draftSlug('--Árbol')).toBe('arbol');
    expect(draftSlug('a'.repeat(60))).toHaveLength(40);
  });

  it('dice qué le pasa a un slug que no vale', () => {
    expect(slugProblem('copa-lalo')).toBeNull();
    expect(slugProblem('ab')).toMatch(/al menos 3/);
    expect(slugProblem('copa-')).toMatch(/guion/);
    expect(slugProblem('Copa')).toMatch(/minúsculas/);
  });

  it('#torneo/<slug> es la página pública; #torneo y #torneos, sin slug, son el panel', () => {
    expect(parseSignupRoute('#torneo/copa-lalo')).toEqual({ slug: 'copa-lalo', demo: null });
    expect(parseSignupRoute('#/torneo/Copa-Lalo/')).toEqual({ slug: 'copa-lalo', demo: null });
    expect(parseSignupRoute('#torneo/prueba?demo=1')).toEqual({ slug: 'prueba', demo: '1' });
    expect(parseSignupRoute('#torneo')).toBeNull();
    expect(parseSignupRoute('#torneos')).toBeNull();
    expect(parseSignupRoute('#torneos/copa')).toBeNull();
    expect(parseSignupRoute('#torneo/a/b')).toBeNull();
    expect(signupUrl('https://lalo.example/', 'copa-lalo')).toBe('https://lalo.example/#torneo/copa-lalo');
  });
});

// ---------- Formulario ----------

describe('Torneos: validación del formulario de inscripción', () => {
  const good = { team: '  Lobos   del Sur ', captain: ' Lalo #LAN ', players: ['Ana#EUW', '', 'Beto#1234', ''] };

  it('acepta un equipo bien escrito y lo deja limpio; los huecos en blanco no se envían', () => {
    expect(validateSignup(good, 5)).toEqual({ ok: true, value: { team: 'Lobos del Sur', captain: 'Lalo#LAN', players: ['Ana#EUW', 'Beto#1234'] } });
    expect(validateSignup({ team: 'Solo', captain: 'Uno#ABC', players: [] }, 1)).toEqual({ ok: true, value: { team: 'Solo', captain: 'Uno#ABC', players: [] } });
  });

  it('no envía más jugadores de los que caben en un equipo', () => {
    const check = validateSignup({ team: 'Dúo', captain: 'Uno#ABC', players: ['Dos#ABC', 'Tres#ABC'] }, 2);
    expect(check).toEqual({ ok: true, value: { team: 'Dúo', captain: 'Uno#ABC', players: ['Dos#ABC'] } });
  });

  it('explica cada dato que falta o no vale', () => {
    const empty = validateSignup({ team: ' ', captain: '', players: [] }, 5);
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.errors.team).toMatch(/nombre de tu equipo/);
    expect(empty.errors.captain).toMatch(/Riot ID del capitán/);

    const bad = (form: Partial<typeof good>) => {
      const check = validateSignup({ ...good, ...form }, 5, ['Dragones Rojos']);
      if (check.ok) throw new Error('debía fallar');
      return check.errors;
    };
    expect(bad({ team: 'A' }).team).toMatch(/al menos 2/);
    expect(bad({ team: 'x'.repeat(23) }).team).toMatch(/22/);
    expect(bad({ team: '<b>Lobos</b>' }).team).toMatch(/< >/);
    expect(bad({ team: 'Lobos [gritando]' }).team).toMatch(/corchetes/);
    expect(bad({ team: 'Lo‮bos' }).team).toBeTruthy();
    // Sin distinguir mayúsculas ni tildes
    expect(bad({ team: 'DRÁGONES  rojos' }).team).toMatch(/Ya hay un equipo/);

    ['Lalo', 'Lalo#', '#LAN', 'La#LAN', 'Lalo#LA', 'Lalo#LANLAN', 'Lalo#LA-N', 'x'.repeat(17) + '#LAN', 'Lalo#LAN#EUW'].forEach((captain) =>
      expect(bad({ captain }).captain, captain).toMatch(/nombre#etiqueta/)
    );
  });

  it('señala al jugador mal escrito o repetido, en su hueco', () => {
    const check = validateSignup({ team: 'Lobos', captain: 'Lalo#LAN', players: ['', 'sin-etiqueta', 'LALO#lan', 'Ana#EUW'] }, 5);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.errors.team).toBeUndefined();
    expect(check.errors.players[0]).toBeNull();
    expect(check.errors.players[1]).toMatch(/nombre#etiqueta/);
    expect(check.errors.players[2]).toMatch(/ya está en el equipo/);
    expect(check.errors.players[3]).toBeNull();
  });
});

// ---------- Respuestas de tournament_register ----------

describe('Torneos: respuestas de la inscripción', () => {
  it('cada código tiene su mensaje: qué pasó y qué hacer', () => {
    const titles = new Set<string>();
    [...REGISTER_CODES, 'error' as const].forEach((code) => {
      const message = REGISTER_MESSAGES[code];
      expect(message.title.length, code).toBeGreaterThan(5);
      expect(message.text.length, code).toBeGreaterThan(30);
      titles.add(message.title);
    });
    expect(titles.size).toBe(REGISTER_CODES.length + 1);

    expect(REGISTER_MESSAGES.ok.text).toMatch(/pendiente de que el organizador lo acepte/);
    expect(REGISTER_MESSAGES.closed.title).toMatch(/cerrada/);
    expect(REGISTER_MESSAGES.full.title).toMatch(/completo/);
    expect(REGISTER_MESSAGES.duplicate.text).toMatch(/Cámbialo/);
    expect(REGISTER_MESSAGES.busy.text).toMatch(/Espera un minuto/);
    expect(REGISTER_MESSAGES.invalid.text).toMatch(/nombre#etiqueta/);
    expect(REGISTER_MESSAGES.not_found.title).toMatch(/No encontramos/);
    expect(REGISTER_MESSAGES.error.text).toMatch(/conexión/);
  });

  it('lee el código de la respuesta y no se fía de lo que no conoce', () => {
    REGISTER_CODES.forEach((code) => expect(registerCodeOf({ code })).toBe(code));
    expect(registerCodeOf('full')).toBe('full');
    [null, undefined, {}, { code: 'hacked' }, { code: 7 }, 'nope', []].forEach((raw) => expect(registerCodeOf(raw)).toBe('error'));
  });

  it('envía la inscripción a tournament_register y devuelve su código', async () => {
    const { cloud, client } = fakeCloud();
    cloud.answers.tournament_register = { code: 'duplicate' };
    const form = { team: 'Lobos', captain: 'Lalo#LAN', players: ['Ana#EUW'] };
    expect(await registerTeam('copa-lalo', form, client)).toBe('duplicate');
    expect(cloud.rpcs[0]).toEqual({ name: 'tournament_register', args: { p_slug: 'copa-lalo', p_team: 'Lobos', p_captain: 'Lalo#LAN', p_players: ['Ana#EUW'] } });

    cloud.down = true;
    expect(await registerTeam('copa-lalo', form, client)).toBe('error');
    expect(await registerTeam('copa-lalo', form, null)).toBe('error');
  });
});

// ---------- Lo público ----------

describe('Torneos: lo público nunca incluye Riot ID', () => {
  /** Una respuesta que trae de más todo lo que no debe salir. */
  const leaky = {
    name: 'Copa <b>Lalo</b>',
    game: 'League of Legends',
    organizer: 'laloplay_',
    teamSize: 5,
    slots: 8,
    open: true,
    logo: 'https://cdn.example/logo.png',
    sponsors: [
      { name: 'Café Nexo', logo: 'javascript:alert(1)' },
      { name: 'Teclados', logo: 'https://cdn.example/t.png', captain: 'Espía#EUW' },
      { name: '', logo: null },
    ],
    style: 'estadio',
    color: '#FF8800',
    teams: ['Lobos del Sur', { name: 'Dragones', captain: 'Lalo#LAN', players: ['Ana#EUW'] }, 'Nexo\u0007 Roto', 42],
    left: 99,
    profile_id: PROFILE,
    widget_key: KEY,
    captain: 'Lalo#LAN',
    players: ['Ana#EUW'],
    entries: [{ team: 'Lobos', captain: 'Lalo#LAN' }],
  };

  it('se arma campo a campo: fuera Riot ID, jugadores, claves e identificadores', () => {
    const shown = normalizePublicTournament(leaky);
    expect(shown).toEqual({
      name: 'Copa b Lalo /b',
      game: 'League of Legends',
      organizer: 'laloplay_',
      teamSize: 5,
      slots: 8,
      open: true,
      logo: 'https://cdn.example/logo.png',
      sponsors: [
        { name: 'Café Nexo', logo: null },
        { name: 'Teclados', logo: 'https://cdn.example/t.png' },
      ],
      style: 'estadio',
      color: '#ff8800',
      teams: ['Lobos del Sur', 'Nexo Roto'],
      // Las plazas salen de los equipos que se enseñan, no de lo que diga la respuesta
      left: 6,
    });
    const text = JSON.stringify(shown);
    ['Lalo#LAN', 'Ana#EUW', 'Espía#EUW', '#LAN', '#EUW', 'captain', 'players', 'widget_key', KEY, 'profile_id', PROFILE, 'entries', 'javascript:'].forEach((secret) =>
      expect(text, secret).not.toContain(secret)
    );
  });

  it('sin torneo no hay nada que enseñar', async () => {
    [null, undefined, 'x', [], {}, { name: '' }].forEach((raw) => expect(normalizePublicTournament(raw)).toBeNull());
    const { cloud, client } = fakeCloud();
    cloud.answers.tournament_public = null;
    expect(await fetchPublicTournament('copa-lalo', client)).toEqual({ kind: 'not_found' });
    // Un slug imposible ni se pregunta
    expect(await fetchPublicTournament('Copa Lalo', client)).toEqual({ kind: 'not_found' });
    expect(cloud.rpcs).toHaveLength(1);
    expect(await fetchPublicTournament('copa-lalo', null)).toEqual({ kind: 'no_cloud' });
    cloud.down = true;
    expect(await fetchPublicTournament('copa-lalo', client)).toEqual({ kind: 'error' });
  });

  it('la página recibe lo público ya limpio', async () => {
    const { cloud, client } = fakeCloud();
    cloud.answers.tournament_public = leaky;
    const result = await fetchPublicTournament('copa-lalo', client);
    expect(result.kind).toBe('ok');
    expect(JSON.stringify(result)).not.toContain('#LAN');
    expect(cloud.rpcs[0]).toEqual({ name: 'tournament_public', args: { p_slug: 'copa-lalo' } });
  });

  it('lo que el dueño publica sale de los ajustes: ni la llave ni los equipos', () => {
    const settings = normalizeTournamentSettings({
      ...DEFAULT_TOURNAMENT_SETTINGS,
      name: 'Copa Lalo',
      size: 16,
      teamSize: 3,
      customColor: true,
      color: '#ff8800',
      logo: { url: 'r2:logos/copa.png', name: 'copa.png', mediaId: 'm1' },
      sponsors: [
        { id: 's1', name: 'Café Nexo', image: { url: 'data:image/png;base64,AAAA', name: 'a.png', mediaId: '' } },
        { id: 's2', name: 'Teclados', image: { url: 'https://cdn.example/t.png', name: 't.png', mediaId: 'm2' } },
      ],
      state: bracket(),
    });
    const resolve = (url: string) => (url.startsWith('r2:') ? `https://media.example/${url.slice(3)}` : url);
    expect(publicRowFromSettings(settings, 'copa-lalo', true, resolve)).toEqual({
      slug: 'copa-lalo',
      name: 'Copa Lalo',
      game: 'League of Legends',
      team_size: 3,
      slots: 16,
      signup_open: true,
      logo_url: 'https://media.example/logos/copa.png',
      // Una imagen que solo vive en este navegador no se puede publicar: sale el nombre
      sponsors: [
        { name: 'Café Nexo', logo: null },
        { name: 'Teclados', logo: 'https://cdn.example/t.png' },
      ],
      style: 'grieta',
      color: '#ff8800',
    });
    expect(publicRowFromSettings({ ...settings, customColor: false, logo: null }, 'x-y', false, resolve)).toMatchObject({ color: null, logo_url: null, signup_open: false });
  });

  it('al aceptar una solicitud, a la llave solo pasa el nombre del equipo', () => {
    const [entry] = normalizeEntries([
      { id: 9, team: 'Lobos <i>del</i> Sur', captain: 'Lalo#LAN', players: ['Ana#EUW', 7, 'Beto#1234'], status: 'pending', created_at: '2026-10-05T12:00:00Z' },
      { id: 'x', team: 'Sin id' },
      { id: 10, team: '' },
    ]);
    expect(entry).toEqual({ id: 9, team: 'Lobos i del /i Sur', captain: 'Lalo#LAN', players: ['Ana#EUW', 'Beto#1234'], status: 'pending', createdAt: '2026-10-05T12:00:00Z' });
    expect(normalizeEntries([{ id: 1, team: 'Ok', status: 'admin' }])[0].status).toBe('pending');

    const state = bracket();
    const added = teamFromEntry(entry, state.teams);
    expect(added).toEqual({ id: 't5', name: entry.team, captain: '', players: [] });
    // El estado viaja a OBS con la clave de widget: no lleva ningún Riot ID
    const next = normalizeTournamentState(replaceTeams({ ...state, size: 8 }, [...state.teams, added], 2000));
    expect(next.teams).toHaveLength(5);
    expect(JSON.stringify(next)).not.toContain('#');
  });
});

// ---------- La migración ----------

describe('Torneos: migración 0017', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0017_tournament_cloud.sql', import.meta.url), 'utf8');
  /** El cuerpo de una función, de su `create` a su `$$;`. */
  const body = (name: string): string => {
    const from = sql.indexOf(`create or replace function public.${name}(`);
    expect(from, name).toBeGreaterThan(-1);
    return sql.slice(from, sql.indexOf('\n$$;', from));
  };

  it('es idempotente y no toca la lista de módulos de configs', () => {
    expect(sql).toMatch(/SIN PROBAR/);
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/configs_module_check/);
    const policies = [...sql.matchAll(/create policy (\w+)/g)].map((match) => match[1]);
    expect(policies.length).toBeGreaterThan(0);
    policies.forEach((policy) => expect(sql, policy).toContain(`drop policy if exists ${policy} on`));
  });

  it('las tres tablas tienen RLS y nadie sin sesión las toca directamente', () => {
    ['tournaments', 'tournament_entries', 'tournament_state'].forEach((table) => expect(sql).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`)));
    expect(sql).toMatch(/revoke all on public\.tournaments, public\.tournament_entries, public\.tournament_state\s+from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant [^;]* on public\.tournament\w* to [^;]*anon/);
    // Las inscripciones no se insertan por la API y de ellas solo se cambia el estado
    expect(sql).toMatch(/grant select, delete on public\.tournament_entries to authenticated/);
    expect(sql).toMatch(/grant update \(status\) on public\.tournament_entries to authenticated/);
    expect(sql).not.toMatch(/create policy tournament_entries_insert/);
  });

  it('cada función anónima se revoca y se concede por su firma', () => {
    ['tournament_public(text)', 'tournament_register(text, text, text, jsonb)', 'widget_tournament_state(text, integer)', 'widget_tournament_apply(text, jsonb, integer)'].forEach((signature) => {
      expect(sql, signature).toContain(`revoke all on function public.${signature} from public;`);
      expect(sql, signature).toContain(`grant execute on function public.${signature} to anon, authenticated;`);
    });
    // Los ayudantes no se pueden llamar desde fuera
    ['tournament_fold(text)', 'tournament_clean(text)', 'tournament_riot_id_ok(text)', 'tournament_team_names(uuid)'].forEach((signature) => {
      expect(sql, signature).toMatch(new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')}\\s+from public, anon, authenticated`));
    });
    [...sql.matchAll(/language (?:plpgsql|sql)([^\n]*)/g)].forEach((match) => expect(match[0]).toContain("set search_path = ''"));
  });

  it('lo público no lee inscripciones ni devuelve claves, Riot ID o identificadores', () => {
    const shown = body('tournament_public');
    expect(shown + body('tournament_team_names')).not.toMatch(/tournament_entries|captain|players|widget_key/);
    const returned = shown.slice(shown.indexOf('return jsonb_build_object'));
    expect(returned).not.toMatch(/profile_id|\bid\b/);
    expect(body('tournament_team_names')).toMatch(/->> 'name'/);
  });

  it('la inscripción valida en la base, entra como pendiente y tiene sus topes', () => {
    const register = body('tournament_register');
    ['ok', 'closed', 'full', 'duplicate', 'busy', 'invalid', 'not_found'].forEach((code) => expect(register, code).toContain(`'code', '${code}'`));
    expect(register).toMatch(/tournament_clean\(p_team\)/);
    expect(register).toMatch(/tournament_riot_id_ok/);
    expect(register).toMatch(/tournament_fold/);
    expect(register).toMatch(/status = 'pending'\) >= 40/);
    expect(register).toMatch(/interval '1 minute'\) >= 6/);
    expect(register).toMatch(/for update of t/);
    // El estado de una inscripción nueva no lo elige quien llama
    expect(register).not.toMatch(/insert into public\.tournament_entries \([^)]*status/);
    expect(sql).toMatch(/status\s+text not null default 'pending'/);
  });

  it('la clave de widget solo lee y aplica el estado de la llave, con la misma comprobación que widget_events', () => {
    ['widget_tournament_state', 'widget_tournament_apply'].forEach((name) => {
      const fn = body(name);
      expect(fn, name).toMatch(/char_length\(p_key\) < 32/);
      expect(fn, name).toMatch(/p\.widget_key = p_key and p\.status = 'active'/);
      expect(fn, name).not.toMatch(/tournament_entries|tournaments\b/);
    });
    const apply = body('widget_tournament_apply');
    expect(apply).toMatch(/v_row\.version <> p_base_version/);
    expect(apply).toMatch(/'code', 'conflict'/);
    expect(apply).toMatch(/widget_writes >= 60/);
    expect(apply).toMatch(/octet_length\(p_state::text\) > 20000/);
  });
});
