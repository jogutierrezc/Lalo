/**
 * src/components/estudio/boxes/fase1.tsx
 *
 * Cajas de Studio de la fase 1: Mascota (`pet`), Alerta de juego (`game`) y
 * Ahora suena (`music`). El contrato está en ./types.ts; lo que deciden sin
 * pintar, en ./fase1Logic.ts; cómo se ajusta cada capa a su caja, en
 * src/styles/estudio-fase1.css.
 *
 * - Cada caja lee los ajustes de su módulo y los refresca con el bus del panel
 *   (también cuando la nube entrega unos nuevos a la fuente de OBS).
 * - En OBS montan la misma capa que la fuente suelta. La mascota recibe las
 *   señales de la escena; la alerta de juego y «Ahora suena» traen ya su sondeo
 *   y sus pruebas del bus (GAME_TEST, MUSIC_TEST) dentro de su capa.
 * - En el editor enseñan una muestra quieta: sin red, sin voz y sin nada que la
 *   retire. Su prueba (registry.test) repite el gesto de la capa.
 * - Una alerta de juego que anuncia «la mascota» se la ofrece a la mascota de
 *   su misma escena; si no hay, la lee la voz.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { resolveMediaUrl } from '../../../lib/mediaRef';
import { loadGameSettings, normalizeGameSettings, type GameSettings } from '../../../types/game';
import { loadMusicSettings, normalizeMusicSettings, type MusicSettings } from '../../../types/music';
import { loadPetsSettings, normalizePetsSettings, type PetsSettings } from '../../../types/pets';
import { reduced } from '../../../utils/alertMotion';
import { listenBus, type BusMessage } from '../../../utils/bus';
import { SAMPLE_TRACKS } from '../../../utils/musicRules';
import { SAMPLE_CUES } from '../../../utils/petsLogic';
import { MusicOverlay, type MusicOverlayHandle } from '../../integraciones/MusicOverlay';
import { MusicWidgetLayer, type MusicWidgetLayerHandle } from '../../integraciones/MusicWidgetLayer';
import { GameAlertLayer, type GameAlertLayerHandle } from '../../juego/GameAlertLayer';
import { GameWidgetLayer, type GameWidgetLayerHandle } from '../../juego/GameWidgetLayer';
import { PetFigure } from '../../mascotas/PetFigure';
import { PetLayer, type PetLayerHandle } from '../../mascotas/PetLayer';
import { boxEdge, gameVoice, musicFit, musicInBox, petClip, routeMusicSignal, routePetSignal } from './fase1Logic';
import type { BoxMap, BoxProps, SceneRegistry } from './types';
import '../../../styles/mascotas.css';
import '../../../styles/juego.css';
import '../../../styles/estudio-fase1.css';

// ---------- Ajustes de cada módulo ----------

/** Los ajustes guardados de un módulo, al día con lo que el panel (o la nube) anuncia por el bus. */
function useModuleSettings<T>(load: () => T, pick: (message: BusMessage) => T | null): T {
  const [settings, setSettings] = useState(load);
  useEffect(
    () =>
      listenBus((message) => {
        const next = pick(message);
        if (next) setSettings(next);
      }),
    [pick]
  );
  return settings;
}

const pickPets = (message: BusMessage): PetsSettings | null =>
  message.type === 'PETS_SETTINGS_UPDATE' ? normalizePetsSettings(message.settings) : null;
const pickGame = (message: BusMessage): GameSettings | null =>
  message.type === 'GAME_SETTINGS_UPDATE' ? normalizeGameSettings(message.settings) : null;
const pickMusic = (message: BusMessage): MusicSettings | null =>
  message.type === 'MUSIC_SETTINGS_UPDATE' ? normalizeMusicSettings(message.settings) : null;

// ---------- Mascota ----------

/** Las mascotas montadas en cada escena, para que una alerta de juego pueda dársela a decir. */
const SCENE_PETS = new WeakMap<SceneRegistry, Map<string, (text: string) => boolean>>();

function scenePets(registry: SceneRegistry): Map<string, (text: string) => boolean> {
  let pets = SCENE_PETS.get(registry);
  if (!pets) {
    pets = new Map();
    SCENE_PETS.set(registry, pets);
  }
  return pets;
}

const PET_SAMPLE_LINE = 'Hola, chat. Aquí salgo yo cuando tengo algo que decir.';

/** En OBS: la misma capa que la fuente suelta, con las señales de la escena y la cola de voz del widget. */
const PetLive: React.FC<BoxProps & { settings: PetsSettings }> = ({ layer, registry, demo, services, settings }) => {
  const ref = useRef<PetLayerHandle | null>(null);
  const servicesRef = useRef(services);
  servicesRef.current = services;

  const speak = useCallback(
    (text: string, options: { voiceId?: string; front?: boolean }) => servicesRef.current?.speak(text, 'Mascota', true, options) ?? null,
    []
  );
  const queueLength = useCallback(() => servicesRef.current?.queueLength() ?? 0, []);

  useEffect(() => {
    const pets = scenePets(registry);
    registry.sinks.set(layer.id, (signal) => {
      if (ref.current) routePetSignal(ref.current, signal);
    });
    registry.test.set(layer.id, () => ref.current?.test(SAMPLE_CUES.points));
    pets.set(layer.id, (text) => ref.current?.say(text) ?? false);
    return () => {
      registry.sinks.delete(layer.id);
      registry.test.delete(layer.id);
      pets.delete(layer.id);
    };
  }, [registry, layer.id]);

  return (
    <PetLayer
      ref={ref}
      settings={settings}
      demo={demo}
      // Sin cola de voz la capa simula la frase, como en su estudio
      speak={services ? speak : undefined}
      queueLength={queueLength}
      blockedWords={services?.blockedWords}
      blockedUsers={services?.blockedUsers}
      ignoredBots={services?.ignoredBots}
    />
  );
};

/** En el editor: el personaje quieto con un bocadillo de muestra, con el mismo marcado que pinta la capa. */
const PetSample: React.FC<BoxProps & { settings: PetsSettings }> = ({ layer, registry, settings }) => {
  const figRef = useRef<HTMLDivElement | null>(null);
  const bubRef = useRef<HTMLDivElement | null>(null);
  const idleUrl = settings.idleImage ? resolveMediaUrl(settings.idleImage.url) : null;

  // Prueba: el salto con el que la mascota arranca una frase y la entrada de su bocadillo
  useEffect(() => {
    let tl: gsap.core.Timeline | null = null;
    registry.test.set(layer.id, () => {
      const fig = figRef.current;
      const bubble = bubRef.current;
      tl?.progress(1).kill();
      tl = gsap.timeline();
      if (reduced()) {
        if (bubble) tl.fromTo(bubble, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 });
        return;
      }
      if (fig) tl.to(fig, { yPercent: -9, duration: 0.16, ease: 'power2.out' }).to(fig, { yPercent: 0, duration: 0.4, ease: 'bounce.out' });
      if (bubble) tl.fromTo(bubble, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.28, ease: 'back.out(1.8)' }, 0.05);
    });
    return () => {
      // La muestra queda siempre en reposo, aunque la prueba se corte a medias
      tl?.progress(1).kill();
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id]);

  return (
    <div className="ptl" style={{ '--pt-w': `${settings.size}em`, '--pt-c': settings.color } as React.CSSProperties}>
      <div className="pt" data-pos={settings.pos}>
        <div className="pt-in">
          <div ref={figRef} className="pt-fig">
            <PetFigure kind={settings.kind} color={settings.color} idleUrl={idleUrl || undefined} />
          </div>
        </div>
        {settings.bubble !== 'none' && (
          <div ref={bubRef} className="pt-bub" data-style={settings.bubble}>
            <span className="pt-name">{settings.name}</span>
            <span className="pt-text">{PET_SAMPLE_LINE}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const PetBox: React.FC<BoxProps> = (props) => {
  const settings = useModuleSettings(loadPetsSettings, pickPets);
  return (
    <div className="es-lalo" data-kind="pet" style={{ clipPath: petClip(settings.pos, settings.enter) }}>
      {props.mode === 'live' ? <PetLive {...props} settings={settings} /> : <PetSample {...props} settings={settings} />}
    </div>
  );
};

// ---------- Alerta de juego ----------

/** En OBS: la capa de la fuente suelta, con su sondeo a Riot, su comparación de fotos y su prueba del bus. */
const GameLive: React.FC<BoxProps & { settings: GameSettings }> = ({ layer, registry, demo, services, settings }) => {
  const ref = useRef<GameWidgetLayerHandle | null>(null);
  const live = useRef({ settings, services });
  live.current = { settings, services };

  // La dice la mascota de esta escena si le toca y la acepta; si no, la cola de voz del widget
  const announce = useCallback(
    (text: string) => {
      const voice = gameVoice(live.current.settings, loadPetsSettings().voiceId);
      if (!voice) return;
      if (voice.pet && Array.from(scenePets(registry).values()).some((say) => say(text))) return;
      live.current.services?.speak(text, 'Juego', true, voice.voiceId ? { voiceId: voice.voiceId } : {});
    },
    [registry]
  );

  useEffect(() => {
    registry.test.set(layer.id, () => ref.current?.test('win'));
    return () => {
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id]);

  return <GameWidgetLayer ref={ref} settings={settings} demo={!!demo} onAnnounce={announce} />;
};

/** En el editor: la placa «Grieta» de muestra, quieta. Su prueba la despliega una vez, sin sonido ni voz. */
const GameSample: React.FC<BoxProps & { settings: GameSettings }> = ({ layer, registry, settings }) => {
  const ref = useRef<GameAlertLayerHandle | null>(null);

  useEffect(() => {
    registry.test.set(layer.id, () => ref.current?.test('win'));
    return () => {
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id]);

  return <GameAlertLayer ref={ref} settings={settings} isStudio rest="win" />;
};

const GameBox: React.FC<BoxProps> = (props) => {
  const settings = useModuleSettings(loadGameSettings, pickGame);
  return (
    <div className="es-lalo" data-kind="game">
      {props.mode === 'live' ? <GameLive {...props} settings={settings} /> : <GameSample {...props} settings={settings} />}
    </div>
  );
};

// ---------- Ahora suena ----------

/** En OBS: la capa de la fuente suelta, con su sondeo, sus pruebas del bus y el comando de moderación. */
const MusicLive: React.FC<BoxProps & { settings: MusicSettings }> = ({ layer, registry, demo, settings }) => {
  const ref = useRef<MusicWidgetLayerHandle | null>(null);

  useEffect(() => {
    registry.sinks.set(layer.id, (signal) => routeMusicSignal(ref.current, signal));
    return () => {
      registry.sinks.delete(layer.id);
    };
  }, [registry, layer.id]);

  return <MusicWidgetLayer ref={ref} settings={settings} demo={!!demo} />;
};

/** En el editor: una canción de ejemplo, quieta. Su prueba pasa a la siguiente, con el cambio del diseño. */
const MusicSample: React.FC<BoxProps & { settings: MusicSettings }> = ({ layer, registry, settings }) => {
  const ref = useRef<MusicOverlayHandle | null>(null);
  const indexRef = useRef(0);
  // La muestra se queda en pantalla sea cual sea la regla elegida
  const shown = useMemo<MusicSettings>(() => ({ ...settings, show: 'siempre', pause: 'atenuar' }), [settings]);

  useLayoutEffect(() => {
    const track = SAMPLE_TRACKS[0];
    ref.current?.input({ type: 'song', trackId: track.id }, track, 62000);
  }, []);

  useEffect(() => {
    registry.test.set(layer.id, () => {
      indexRef.current = (indexRef.current + 1) % 3;
      const track = SAMPLE_TRACKS[indexRef.current];
      ref.current?.input({ type: 'song', trackId: track.id }, track, 62000);
    });
    return () => {
      registry.test.delete(layer.id);
    };
  }, [registry, layer.id]);

  return (
    <div className="itg-screen">
      <MusicOverlay ref={ref} settings={shown} still />
    </div>
  );
};

const MusicBox: React.FC<BoxProps> = (props) => {
  const { layer } = props;
  const saved = useModuleSettings(loadMusicSettings, pickMusic);
  // La pieza entra desde el borde del lienzo que la caja tiene más cerca y se arrima a ese lado
  const pos = boxEdge(layer);
  const settings = useMemo(() => musicInBox(saved, pos), [saved, pos]);
  const fit = musicFit(settings);
  return (
    <div className="es-lalo" data-kind="music" style={{ '--f1-w': fit.w, '--f1-h': fit.h } as React.CSSProperties}>
      {props.mode === 'live' ? <MusicLive {...props} settings={settings} /> : <MusicSample {...props} settings={settings} />}
    </div>
  );
};

export const FASE1_BOXES: BoxMap = { pet: PetBox, game: GameBox, music: MusicBox };
