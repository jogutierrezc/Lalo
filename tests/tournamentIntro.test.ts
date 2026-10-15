import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { saveOwnTournament } from '../src/lib/tournamentSignupApi';
import { DEFAULT_TOURNAMENT_SETTINGS, TOURNAMENT_LIMITS, type TournamentSize, normalizeTournamentRules, normalizeTournamentSettings } from '../src/types/tournament';
import {
  GENERAL_RULES,
  INTRO_LAST,
  INTRO_SEEN_KEY,
  INTRO_STEPS,
  autoWaitSeconds,
  bracketCaption,
  bracketLayout,
  bracketSummary,
  clampStep,
  firstView,
  formGuide,
  introClosing,
  introConfig,
  introFacts,
  introFlow,
  introPhases,
  introScript,
  introSeats,
  introSeen,
  introStatusNote,
  introTotalGames,
  introTotalLabel,
  markIntroSeen,
  moodLabel,
  ownRulesHeading,
  roundsList,
  teamHeading,
  versusLabel,
} from '../src/utils/tournamentIntro';
import { type PublicTournament, type TournamentRow, normalizePublicTournament, publicRowFromSettings } from '../src/utils/tournamentSignup';

const SIZES: TournamentSize[] = [4, 8, 16];

/** Lo público de un torneo de ejemplo, con lo que haga falta cambiar. */
const tournament = (patch: Partial<PublicTournament> = {}): PublicTournament => ({
  name: 'Copa Lalo',
  game: 'League of Legends',
  organizer: 'laloplay_',
  teamSize: 5,
  slots: 8,
  open: true,
  logo: null,
  sponsors: [],
  style: 'grieta',
  color: null,
  teams: ['Lobos del Sur'],
  left: 7,
  intro: true,
  rules: [],
  ...patch,
});
const config = (patch: Partial<PublicTournament> = {}) => introConfig(tournament(patch));
/** Todo lo que dice Axo en los seis pasos, de corrido. */
const allText = (patch: Partial<PublicTournament> = {}) =>
  introScript(config(patch))
    .map((line) => `${line.title} ${line.text}`)
    .join(' ');

/** Un almacenamiento en memoria con la forma de localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('la presentación: pasos y guion', () => {
  it('son seis pasos, en el orden aprobado', () => {
    expect(INTRO_STEPS.map((step) => step.name)).toEqual(['Bienvenida', 'Cómo funciona', 'Las fases', 'Tu equipo', 'Reglas generales', 'Buena suerte']);
    expect(INTRO_LAST).toBe(5);
    expect([-3, 0, 2.4, 5, 99, Number.NaN].map(clampStep)).toEqual([0, 0, 2, 5, 5, 0]);
  });

  it('Axo se presenta con su nombre y nombra el torneo, el juego y a quien organiza', () => {
    const script = introScript(config());
    expect(script).toHaveLength(INTRO_STEPS.length);
    expect(script[0].title).toBe('¡Hola! Soy Axo');
    expect(script[0].text).toBe('Te doy la bienvenida a Copa Lalo, el torneo de League of Legends que organiza laloplay_. Antes de inscribirte, te cuento cómo va.');
    expect(script.map((line) => line.mood)).toEqual(['feliz', 'neutral', 'feliz', 'neutral', 'neutral', 'emocionado']);
    expect(allText()).not.toMatch(/Chispa/);
    // Textos llanos: sin rayas de inciso ni corchetes de emoción
    expect(allText()).not.toMatch(/[—–[\]<>]/);
  });

  it('la pastilla de estado lleva el nombre de Axo', () => {
    expect(moodLabel('feliz')).toBe('Axo · Contento');
    expect(moodLabel('neutral')).toBe('Axo · Atento');
    expect(moodLabel('emocionado')).toBe('Axo · Emocionado');
    expect(moodLabel('sorprendido')).toBe('Axo · Sorprendido');
  });

  it('sin organizador ni juego hay un texto de reserva, nunca un hueco', () => {
    const cfg = config({ organizer: '', game: '' });
    expect(cfg.organizer).toBe('quien organiza');
    expect(allText({ organizer: '', game: '' })).not.toMatch(/ {2}| \.|undefined|null/);
    expect(introFlow(cfg)[1].title).toBe('Quien organiza revisa la inscripción');
    // El nombre de un canal se deja como lo escribió su dueño
    expect(introFlow(config())[1].title).toBe('laloplay_ revisa la inscripción');
    expect(ownRulesHeading(config())).toBe('Reglas de laloplay_ para este torneo');
  });
});

describe('la presentación según el tamaño de la llave', () => {
  it('las rondas se nombran como en el resto de Torneos', () => {
    expect(roundsList(4)).toBe('semifinales y final');
    expect(roundsList(8)).toBe('cuartos de final, semifinales y final');
    expect(roundsList(16)).toBe('octavos de final, cuartos de final, semifinales y final');
  });

  it('el guion cuenta las rondas y los equipos de cada tamaño', () => {
    const words = { 4: ['Dos', 'dos'], 8: ['Tres', 'tres'], 16: ['Cuatro', 'cuatro'] } as const;
    SIZES.forEach((size) => {
      const script = introScript(config({ slots: size }));
      expect(script[1].text).toContain(roundsList(size));
      expect(script[2].title).toBe(`${words[size][0]} rondas hasta el título`);
      expect(script[2].text).toBe(`Empiezan ${size} equipos y en cada ronda queda la mitad. Para ser campeón hay que ganar ${words[size][1]} partidas seguidas.`);
    });
  });

  it('las fases: equipos y partidas por ronda, y el total', () => {
    expect(introPhases(4)).toEqual([
      { title: 'Semifinales', teams: 4, games: 2, detail: '4 equipos · 2 partidas' },
      { title: 'Final', teams: 2, games: 1, detail: '2 equipos · 1 partida' },
    ]);
    expect(introPhases(8).map((phase) => phase.detail)).toEqual(['8 equipos · 4 partidas', '4 equipos · 2 partidas', '2 equipos · 1 partida']);
    expect(introPhases(16).map((phase) => phase.title)).toEqual(['Octavos de final', 'Cuartos de final', 'Semifinales', 'Final']);
    SIZES.forEach((size) => {
      const phases = introPhases(size);
      // Las partidas de todas las rondas suman el total: una menos que equipos
      expect(phases.reduce((sum, phase) => sum + phase.games, 0)).toBe(introTotalGames(size));
      expect(introTotalGames(size)).toBe(size - 1);
      expect(phases[0].teams).toBe(size);
      expect(introTotalLabel(size)).toBe(`partidas en total, en ${phases.length} rondas`);
    });
  });

  it('la llave de ejemplo tiene todas sus plazas, cruces y el camino hasta campeón', () => {
    SIZES.forEach((size) => {
      const rounds = Math.log2(size);
      [280, 400, 760].forEach((width) => {
        const layout = bracketLayout(size, width);
        expect(layout.width).toBe(width);
        // Una plaza por equipo y ronda, más la de campeón
        expect(layout.slots).toHaveLength(2 * size - 1);
        expect(layout.links).toHaveLength(size - 1);
        expect(layout.route).toHaveLength(rounds);
        expect(layout.token).toHaveLength(rounds + 1);
        expect(layout.heads.map((head) => head.round)).toEqual(Array.from({ length: rounds + 1 }, (_, round) => round));
        expect(layout.heads[rounds].label).toBe('Campeón');
        expect(layout.slots.filter((slot) => slot.kind === 'champ')).toHaveLength(1);
        expect(layout.slots.filter((slot) => slot.kind === 'mine')).toHaveLength(1);
        // Un rival por ronda: el que el equipo de ejemplo deja fuera
        expect(layout.slots.filter((slot) => slot.opponent).map((slot) => slot.round)).toEqual(Array.from({ length: rounds }, (_, round) => round));
        // Todo cabe dentro del dibujo
        layout.slots.forEach((slot) => {
          expect(slot.x).toBeGreaterThanOrEqual(0);
          expect(slot.x + layout.barW).toBeLessThanOrEqual(layout.width + 0.5);
          expect(slot.y + layout.barH).toBeLessThanOrEqual(layout.height);
        });
        // La ficha empieza en la plaza del equipo de ejemplo y acaba en la de campeón
        const mine = layout.slots.find((slot) => slot.kind === 'mine');
        const champ = layout.slots.find((slot) => slot.kind === 'champ');
        expect(layout.token[0]).toEqual({ x: mine?.x, y: mine?.y });
        expect(layout.token[rounds]).toEqual({ x: champ?.x, y: champ?.y });
        expect(JSON.stringify(layout)).not.toMatch(/NaN|Infinity/);
      });
    });
  });

  it('en un hueco estrecho la llave acorta sus textos en vez de salirse', () => {
    const wide = bracketLayout(8, 760);
    expect(wide.heads.map((head) => head.label)).toEqual(['Cuartos de final', 'Semifinales', 'Final', 'Campeón']);
    expect(wide.slots[0].label).toBe('Equipo 1');
    expect(wide.tokenLabel).toBe('Tu equipo');
    // 16 equipos en un móvil de 400 px: cinco columnas de unos 70 px
    const narrow = bracketLayout(16, 368);
    expect(narrow.heads.map((head) => head.label)).toEqual(['Octavos', 'Cuartos', 'Semis', 'Final', 'Campeón']);
    expect(narrow.slots[0].label).toBe('1');
    expect(narrow.tokenLabel).toBe('Tú');
    // Por debajo del mínimo se dibuja a 260 y el SVG la encoge
    expect(bracketLayout(8, 120).width).toBe(260);
    expect(bracketLayout(8, Number.NaN).width).toBe(260);
  });

  it('el pie de la llave cuenta el camino ronda a ronda', () => {
    expect(bracketCaption(8, 'start')).toEqual({ before: 'Empiezan ', strong: '8 equipos', after: '.' });
    expect(bracketCaption(8, 0)).toEqual({ before: '', strong: 'Cuartos de final:', after: ' gana y pasa a semifinales.' });
    expect(bracketCaption(8, 1)).toEqual({ before: '', strong: 'Semifinales:', after: ' gana y pasa a la final.' });
    expect(bracketCaption(8, 2)).toEqual({ before: '', strong: 'Final:', after: ' gana y se lleva el torneo.' });
    expect(bracketCaption(16, 0).after).toBe(' gana y pasa a cuartos de final.');
    expect(bracketCaption(4, 0).after).toBe(' gana y pasa a la final.');
    expect(bracketCaption(4, 'rest').before).toBe('El equipo de ejemplo gana dos partidas seguidas y ');
    expect(bracketCaption(16, 'rest').before).toBe('El equipo de ejemplo gana cuatro partidas seguidas y ');
    expect(bracketSummary(16)).toContain('Llave de 16 equipos a eliminación directa: octavos de final');
    // El avance automático espera más donde hay más que dibujar
    expect(autoWaitSeconds(1, 16)).toBeGreaterThan(autoWaitSeconds(1, 4));
    expect(autoWaitSeconds(0, 16)).toBe(7);
  });
});

describe('la presentación según los jugadores por equipo', () => {
  it('de 2 a 5 jugadores: el capitán inscribe y se nombra a los demás', () => {
    [2, 3, 4, 5].forEach((teamSize) => {
      const cfg = config({ teamSize });
      expect(versusLabel(teamSize)).toBe(`${teamSize} contra ${teamSize}`);
      expect(teamHeading(teamSize)).toBe(`Equipos de ${teamSize} jugadores`);
      expect(introFacts(cfg)).toEqual(['League of Legends', `${teamSize} contra ${teamSize}`, 'Eliminación directa', '8 equipos']);
      const seats = introSeats(teamSize);
      expect(seats).toHaveLength(teamSize);
      expect(seats[0]).toEqual({ title: 'Capitán', note: 'Inscribe', captain: true });
      expect(seats.slice(1).map((seat) => seat.title)).toEqual(Array.from({ length: teamSize - 1 }, (_, index) => `Jugador ${index + 2}`));
      expect(introScript(cfg)[3].text).toContain(`Cada equipo juega con ${teamSize} jugadores.`);
      expect(introFlow(cfg).map((step) => step.tag)).toEqual([null, 'pending', 'accepted']);
      expect(introClosing(cfg).action).toBe('Inscribir a mi equipo');
    });
    expect(introFlow(config({ teamSize: 2 }))[0].text).toBe('Con el nombre del equipo, su Riot ID y el del otro jugador.');
    expect(introFlow(config({ teamSize: 5 }))[0].text).toBe('Con el nombre del equipo, su Riot ID y el de los otros 4 jugadores.');
  });

  it('uno contra uno: no hay capitán ni equipo que reunir', () => {
    const cfg = config({ teamSize: 1 });
    expect(versusLabel(1)).toBe('Uno contra uno');
    expect(teamHeading(1)).toBe('Uno contra uno');
    expect(introFacts(cfg)).toEqual(['League of Legends', 'Uno contra uno', 'Eliminación directa', '8 jugadores']);
    expect(introSeats(1)).toEqual([{ title: 'Tú', note: 'Riot ID', captain: true }]);
    const script = introScript(cfg);
    expect(script[3].text).toBe('Aquí se juega uno contra uno. Te inscribes con tu Riot ID y laloplay_ revisa tu inscripción antes de aceptarla.');
    expect(script[5].text).toContain('Prepárate');
    expect(allText({ teamSize: 1 })).not.toMatch(/capitán|Reúne a tu equipo/i);
    expect(introFlow(cfg).map((step) => step.title)).toEqual(['Te inscribes tú', 'laloplay_ revisa la inscripción', 'Entras en la llave']);
    expect(introClosing(cfg).action).toBe('Inscribirme');
    expect(introPhases(8, true)[0].detail).toBe('8 jugadores · 4 partidas');
    expect(bracketLayout(8, 760, true).slots[0].label).toBe('Jugador 1');
    expect(bracketCaption(8, 'start', true).strong).toBe('8 jugadores');
  });

  it('un tamaño de equipo imposible se queda dentro de 1 a 5', () => {
    expect(config({ teamSize: 0 }).teamSize).toBe(1);
    expect(config({ teamSize: 9 }).teamSize).toBe(5);
    expect(config({ teamSize: Number.NaN }).teamSize).toBe(5);
  });
});

describe('la presentación con la inscripción cerrada o la llave completa', () => {
  it('abierta: el cierre lleva a inscribirse', () => {
    const cfg = config();
    expect(cfg.status).toBe('open');
    expect(introStatusNote('open')).toBeNull();
    expect(introClosing(cfg)).toEqual({
      title: '¡Buena suerte!',
      lead: 'Que gane el mejor. Nos vemos en la llave de Copa Lalo.',
      action: 'Inscribir a mi equipo',
      next: 'Ir al formulario',
      pill: 'Formulario',
      confetti: true,
    });
    expect(formGuide(cfg, false)).toEqual({
      title: 'Solo falta inscribirte',
      text: 'Cuando envíes el formulario, tu equipo queda pendiente hasta que laloplay_ lo acepte.',
      mood: 'feliz',
    });
    expect(formGuide(cfg, true).title).toBe('¡Recibido!');
  });

  it('cerrada o completa: se puede ver, pero nada promete inscribirse', () => {
    const closed = config({ open: false });
    const full = config({ left: 0 });
    expect(closed.status).toBe('closed');
    expect(full.status).toBe('full');
    expect(introStatusNote('closed')).toBe('Inscripción cerrada');
    expect(introStatusNote('full')).toBe('Llave completa');
    [closed, full].forEach((cfg) => {
      const closing = introClosing(cfg);
      expect(closing.action).toBe('Ver el torneo');
      expect(closing.next).toBe('Ver el torneo');
      expect(closing.pill).toBe('El torneo');
      expect(closing.confetti).toBe(false);
      const last = introScript(cfg)[INTRO_LAST];
      const said = `${closing.title} ${closing.lead} ${closing.action} ${closing.next} ${last.title} ${last.text} ${formGuide(cfg, false).title} ${formGuide(cfg, false).text}`;
      expect(said).not.toMatch(/inscrib(ir|e|irte|irme)\b|formulario|suerte/i);
      // La bienvenida lo dice desde el principio
      expect(introScript(cfg)[0].text).not.toContain('Antes de inscribirte');
    });
    expect(introScript(closed)[0].text).toContain('la inscripción está cerrada');
    expect(introScript(full)[0].text).toContain('La llave ya está completa');
  });
});

describe('reglas generales y reglas propias', () => {
  it('las generales son seis y valen para cualquier torneo', () => {
    expect(GENERAL_RULES).toHaveLength(6);
    expect(new Set(GENERAL_RULES.map((rule) => rule.id)).size).toBe(6);
    GENERAL_RULES.forEach((rule) => {
      expect(rule.title.length).toBeGreaterThan(5);
      expect(rule.text).toMatch(/\.$/);
    });
  });

  it('las propias se limpian: sin HTML, sin corchetes y sin caracteres raros', () => {
    expect(
      normalizeTournamentRules(
        '  Al mejor de <b>tres</b>.  \n<script>alert(1)</script>Sin trampas\n\n[gritando] Se juega en LAN\nUna\u0007 regla​ con‮ marcas\r\n<img src=x onerror=alert(1)>'
      )
    ).toEqual(['Al mejor de tres .', 'alert(1) Sin trampas', 'Se juega en LAN', 'Una regla con marcas']);
    const clean = normalizeTournamentRules(['<a href="javascript:alert(1)">pulsa</a>', 'a < b > c', 42, null, { text: 'x' }, '   ']);
    // Lo que va entre < y > se toma por una etiqueta y se quita entero, como en el resto de Torneos
    expect(clean).toEqual(['pulsa', 'a c']);
    expect(clean.join(' ')).not.toMatch(/[<>[\]]/);
    [null, undefined, 7, {}, ''].forEach((raw) => expect(normalizeTournamentRules(raw)).toEqual([]));
  });

  it('las propias tienen tope: seis reglas de 110 caracteres', () => {
    expect(TOURNAMENT_LIMITS.rules).toBe(6);
    expect(TOURNAMENT_LIMITS.rule).toBe(110);
    const many = normalizeTournamentRules(Array.from({ length: 20 }, (_, index) => `Regla ${index + 1}`));
    expect(many).toEqual(['Regla 1', 'Regla 2', 'Regla 3', 'Regla 4', 'Regla 5', 'Regla 6']);
    const long = normalizeTournamentRules(['x'.repeat(400)]);
    expect(long[0]).toHaveLength(110);
  });

  it('los ajustes guardan el interruptor y las reglas, y sin ellos quedan de serie', () => {
    expect(DEFAULT_TOURNAMENT_SETTINGS.intro).toBe(true);
    expect(DEFAULT_TOURNAMENT_SETTINGS.rules).toEqual([]);
    // Ajustes guardados antes de que existiera la presentación
    const { intro: _intro, rules: _rules, ...old } = DEFAULT_TOURNAMENT_SETTINGS;
    expect(normalizeTournamentSettings(old)).toMatchObject({ intro: true, rules: [] });
    expect(normalizeTournamentSettings({ ...old, intro: false, rules: ['Sin <i>pausas</i>', ''] })).toMatchObject({ intro: false, rules: ['Sin pausas'] });
    expect(normalizeTournamentSettings({ ...old, intro: 'no', rules: 'una sola' })).toMatchObject({ intro: true, rules: ['una sola'] });
  });

  it('el guion solo menciona las reglas propias si las hay', () => {
    expect(introScript(config())[4].text).toBe('Son pocas y valen para todos. Léelas con calma.');
    expect(introScript(config({ rules: ['Se juega en LAN.'] }))[4].text).toBe('Son pocas y valen para todos. Léelas con calma. Las últimas las puso laloplay_ para este torneo.');
    expect(config({ rules: Array.from({ length: 9 }, (_, index) => `Regla ${index}`) }).rules).toHaveLength(6);
  });
});

describe('«ya la vi»', () => {
  it('quien no la ha visto empieza por la presentación; quien sí, por el formulario', () => {
    const storage = memoryStorage();
    expect(introSeen('copa-lalo', storage)).toBe(false);
    expect(firstView(tournament(), introSeen('copa-lalo', storage))).toBe('intro');
    markIntroSeen('copa-lalo', storage);
    expect(introSeen('copa-lalo', storage)).toBe(true);
    expect(firstView(tournament(), introSeen('copa-lalo', storage))).toBe('form');
    // El recuerdo es por torneo
    expect(introSeen('otra-copa', storage)).toBe(false);
    expect(JSON.parse(storage.data.get(INTRO_SEEN_KEY) ?? '')).toEqual(['copa-lalo']);
  });

  it('con la presentación apagada se entra siempre al formulario', () => {
    expect(firstView(tournament({ intro: false }), false)).toBe('form');
    expect(firstView(tournament({ intro: false }), true)).toBe('form');
  });

  it('no se repite un torneo y los más antiguos se olvidan', () => {
    const storage = memoryStorage();
    markIntroSeen('copa-lalo', storage);
    markIntroSeen('copa-lalo', storage);
    expect(JSON.parse(storage.data.get(INTRO_SEEN_KEY) ?? '')).toEqual(['copa-lalo']);
    for (let index = 0; index < 60; index += 1) markIntroSeen(`torneo-${index}`, storage);
    const kept = JSON.parse(storage.data.get(INTRO_SEEN_KEY) ?? '') as string[];
    expect(kept).toHaveLength(40);
    expect(kept[kept.length - 1]).toBe('torneo-59');
    expect(introSeen('copa-lalo', storage)).toBe(false);
  });

  it('un almacenamiento roto, vacío o manipulado no rompe nada', () => {
    expect(introSeen('copa-lalo', null)).toBe(false);
    expect(() => markIntroSeen('copa-lalo', null)).not.toThrow();
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('lleno');
      },
    };
    expect(introSeen('copa-lalo', broken)).toBe(false);
    expect(() => markIntroSeen('copa-lalo', broken)).not.toThrow();
    ['no es json', '{"a":1}', '"copa-lalo"', '[1, null, "Copa Lalo", "<b>x</b>"]'].forEach((raw) => {
      const storage = memoryStorage({ [INTRO_SEEN_KEY]: raw });
      expect(introSeen('copa-lalo', storage)).toBe(false);
      markIntroSeen('copa-lalo', storage);
      expect(JSON.parse(storage.data.get(INTRO_SEEN_KEY) ?? '')).toEqual(['copa-lalo']);
    });
    // Un slug imposible ni se guarda
    const storage = memoryStorage();
    markIntroSeen('Copa Lalo', storage);
    expect(storage.data.has(INTRO_SEEN_KEY)).toBe(false);
  });
});

describe('lo público con y sin los campos de la presentación', () => {
  const answer = { name: 'Copa Lalo', game: 'League of Legends', organizer: 'laloplay_', teamSize: 5, slots: 8, open: true, style: 'cartel', teams: [] };

  it('una base sin la 0018 no manda los campos: presentación encendida y sin reglas propias', () => {
    const shown = normalizePublicTournament(answer);
    expect(shown).toMatchObject({ intro: true, rules: [] });
    expect(firstView(shown as PublicTournament, false)).toBe('intro');
    expect(introConfig(shown as PublicTournament).rules).toEqual([]);
  });

  it('con la 0018: el interruptor y las reglas llegan, y las reglas se vuelven a limpiar', () => {
    const shown = normalizePublicTournament({
      ...answer,
      intro: false,
      rules: ['Al mejor de tres.', '<img src=x onerror=alert(1)>', 'Con [corchetes] y <etiquetas>', 7, '', 'x'.repeat(300), 'cinco', 'seis', 'siete', 'ocho'],
    });
    expect(shown?.intro).toBe(false);
    expect(shown?.rules).toHaveLength(6);
    expect(shown?.rules[0]).toBe('Al mejor de tres.');
    expect(shown?.rules.join(' ')).not.toMatch(/[<>[\]]/);
    shown?.rules.forEach((rule) => expect(rule.length).toBeLessThanOrEqual(110));
    // Solo `false` la apaga: cualquier otra cosa la deja encendida
    ['no', 0, null].forEach((intro) => expect(normalizePublicTournament({ ...answer, intro })?.intro).toBe(true));
    expect(normalizePublicTournament({ ...answer, rules: 'una regla' })?.rules).toEqual([]);
  });

  it('lo que el dueño publica lleva el interruptor y las reglas ya limpias', () => {
    const settings = normalizeTournamentSettings({ ...DEFAULT_TOURNAMENT_SETTINGS, intro: false, rules: ['Se juega en <b>LAN</b>.', ''] });
    const row = publicRowFromSettings(settings, 'copa-lalo', true, () => null);
    expect(row).toMatchObject({ intro_on: false, rules: ['Se juega en LAN .'] });
    expect(publicRowFromSettings(DEFAULT_TOURNAMENT_SETTINGS, 'copa-lalo', true, () => null)).toMatchObject({ intro_on: true, rules: [] });
  });
});

describe('guardar el enlace con y sin la migración 0018', () => {
  const PROFILE = '00000000-0000-4000-8000-000000000001';
  const row: TournamentRow = publicRowFromSettings(
    normalizeTournamentSettings({ ...DEFAULT_TOURNAMENT_SETTINGS, rules: ['Se juega en LAN.'] }),
    'copa-lalo',
    true,
    () => null
  );

  /** Una tabla `tournaments` de mentira. `columns`: las que la base conoce. */
  function fakeTable(options: { known0018: boolean; fail?: { code: string; message: string } }) {
    const calls: Record<string, unknown>[] = [];
    const client = {
      from: () => ({
        upsert: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          if (options.fail) return { error: options.fail };
          if (!options.known0018 && 'intro_on' in payload) {
            return { error: { code: 'PGRST204', message: "Could not find the 'intro_on' column of 'tournaments' in the schema cache" } };
          }
          if (!options.known0018 && 'rules' in payload) {
            return { error: { code: 'PGRST204', message: "Could not find the 'rules' column of 'tournaments' in the schema cache" } };
          }
          return { error: null };
        },
      }),
    } as unknown as SupabaseClient;
    return { calls, client };
  }

  it('con la 0018 aplicada se guarda todo de una vez', async () => {
    const { calls, client } = fakeTable({ known0018: true });
    expect(await saveOwnTournament(PROFILE, row, client)).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ profile_id: PROFILE, slug: 'copa-lalo', intro_on: true, rules: ['Se juega en LAN.'] });
  });

  it('sin la 0018 el guardado no se rompe: se repite sin las dos columnas y lo dice', async () => {
    const { calls, client } = fakeTable({ known0018: false });
    expect(await saveOwnTournament(PROFILE, row, client)).toBe('ok_basic');
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toHaveProperty('intro_on');
    expect(calls[1]).not.toHaveProperty('rules');
    // Lo demás va igual que siempre
    expect(calls[1]).toMatchObject({ profile_id: PROFILE, slug: 'copa-lalo', name: 'Copa Lalo', signup_open: true, style: 'grieta' });
  });

  it('otros fallos no se disfrazan: slug cogido, sin conexión o sin nube', async () => {
    expect(await saveOwnTournament(PROFILE, row, fakeTable({ known0018: true, fail: { code: '23505', message: 'duplicate key' } }).client)).toBe('taken');
    const offline = fakeTable({ known0018: true, fail: { code: '', message: 'sin conexión' } });
    expect(await saveOwnTournament(PROFILE, row, offline.client)).toBe('error');
    expect(offline.calls).toHaveLength(1);
    // Una columna desconocida que no es de la 0018 es un error de verdad: no se reintenta
    const other = fakeTable({ known0018: true, fail: { code: 'PGRST204', message: "Could not find the 'style' column of 'tournaments' in the schema cache" } });
    expect(await saveOwnTournament(PROFILE, row, other.client)).toBe('error');
    expect(other.calls).toHaveLength(1);
    expect(await saveOwnTournament(PROFILE, row, null)).toBe('error');
  });
});

describe('la migración 0018', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0018_tournament_intro.sql', import.meta.url), 'utf8');
  const previous = readFileSync(new URL('../supabase/migrations/0017_tournament_cloud.sql', import.meta.url), 'utf8');

  it('se puede ejecutar más de una vez y avisa de que está sin probar', () => {
    expect(sql).toContain('SIN PROBAR');
    expect(sql).toMatch(/add column if not exists intro_on boolean not null default true/);
    expect(sql).toMatch(/add column if not exists rules jsonb not null default '\[\]'::jsonb/);
    expect(sql).toContain("conname = 'tournaments_rules_check'");
    expect(sql).not.toMatch(/drop table|drop column|truncate/i);
  });

  it('valida las reglas con los mismos topes que la app', () => {
    expect(sql).toContain(`jsonb_array_length(p_rules) > ${TOURNAMENT_LIMITS.rules}`);
    expect(sql).toContain(`not between 1 and ${TOURNAMENT_LIMITS.rule}`);
    expect(sql).toContain('check (public.tournament_rules_ok(rules))');
    // Quien escribe la fila tiene que poder ejecutar la comprobación
    expect(sql).toContain('grant execute on function public.tournament_rules_ok(jsonb) to authenticated');
  });

  it('tournament_public conserva todo lo que ya devolvía y sus permisos, y añade los dos campos', () => {
    const keys = (text: string) => {
      const body = text.slice(text.indexOf('create or replace function public.tournament_public'));
      const build = body.slice(body.indexOf('jsonb_build_object('), body.indexOf('end;'));
      return [...build.matchAll(/'([a-zA-Z]+)',/g)].map((match) => match[1]);
    };
    const before = keys(previous);
    const after = keys(sql);
    expect(before).toEqual(['name', 'game', 'organizer', 'teamSize', 'slots', 'open', 'logo', 'sponsors', 'style', 'color', 'teams', 'left']);
    expect(after).toEqual([...before, 'intro', 'rules']);
    expect(sql).toContain('language plpgsql stable security definer set search_path');
    expect(sql).toContain('revoke all on function public.tournament_public(text) from public;');
    expect(sql).toContain('grant execute on function public.tournament_public(text) to anon, authenticated;');
    // Lo que no es público sigue sin salir
    expect(after.join(' ')).not.toMatch(/profile|widget|captain|players/);
  });
});
