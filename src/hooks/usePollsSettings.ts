/**
 * src/hooks/usePollsSettings.ts
 *
 * Hook de gestión de estado para Batallas & Encuestas en Vivo (Polls & Versus Studio).
 * Maneja la persistencia en localStorage, el ciclo de vida del temporizador,
 * la deduplicación de votantes por usuario, la emisión de eventos por BroadcastChannel hacia OBS,
 * y la activación de sonidos y locuciones emocionales con TTS.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  PollSettings,
  PollBattlePreset,
  loadPollSettings,
  savePollSettings,
  determineLeader,
} from '../types/polls';
import { postBus, listenBus, PollBattleUpdateEvent } from '../utils/bus';
import {
  playVoteTick,
  playLeadClash,
  playCountdownBeep,
  playPollVictoryFanfare,
  speakPollEmotionCue,
} from '../utils/pollsAudio';

export function usePollsSettings() {
  const [settings, setSettings] = useState<PollSettings>(() => loadPollSettings());
  const [timeLeft, setTimeLeft] = useState<number>(() => loadPollSettings().durationSec);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [winner, setWinner] = useState<'A' | 'B' | 'TIE' | null>(null);
  const [userVotes, setUserVotes] = useState<Map<string, 0 | 1>>(new Map());
  const [saved, setSaved] = useState<boolean>(true);

  const previousLeaderRef = useRef<'A' | 'B' | 'TIE'>('TIE');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Guardar en localStorage ante cambios
  const updateSettings = useCallback((partial: Partial<PollSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      savePollSettings(next);
      postBus({ type: 'POLL_SETTINGS_UPDATE', settings: next });
      return next;
    });
    setSaved(false);
    setTimeout(() => setSaved(true), 800);
  }, []);

  const optA = settings.options[0];
  const optB = settings.options[1];
  const leader = determineLeader(optA.votes, optB.votes);

  // Difundir estado a OBS
  const broadcastState = useCallback(
    (overrideTime?: number, overrideActive?: boolean, overrideWinner?: 'A' | 'B' | 'TIE' | null, lastUser?: string, lastOpt?: 0 | 1) => {
      const updateEvt: PollBattleUpdateEvent = {
        title: settings.activeBattleTitle,
        optionA: settings.options[0],
        optionB: settings.options[1],
        timeLeftSec: overrideTime !== undefined ? overrideTime : timeLeft,
        totalDurationSec: settings.durationSec,
        isActive: overrideActive !== undefined ? overrideActive : isActive,
        winner: overrideWinner !== undefined ? overrideWinner : winner,
        leader: determineLeader(settings.options[0].votes, settings.options[1].votes),
        lastVoteUser: lastUser,
        lastVoteOption: lastOpt,
      };
      postBus({ type: 'POLL_STATE_UPDATE', state: updateEvt });
    },
    [settings, timeLeft, isActive, winner]
  );

  // Emitir voto
  const castVote = useCallback(
    (optionIndex: 0 | 1, user = 'Anónimo') => {
      if (winner) setWinner(null);

      const normalizedUser = user.toLowerCase().trim();
      const existingVote = userVotes.get(normalizedUser);

      // Si el usuario ya votó
      if (existingVote !== undefined) {
        if (!settings.allowVoteChange) {
          return; // No se permite cambiar voto
        }
        if (existingVote === optionIndex) {
          return; // Mismo voto, no cambia nada
        }
      }

      setSettings((prev) => {
        const nextOpts = [...prev.options] as [typeof prev.options[0], typeof prev.options[1]];

        // Si ya había votado antes, restar de la opción previa
        if (existingVote !== undefined && prev.allowVoteChange) {
          nextOpts[existingVote] = {
            ...nextOpts[existingVote],
            votes: Math.max(0, nextOpts[existingVote].votes - 1),
          };
        }

        // Sumar a la nueva opción
        nextOpts[optionIndex] = {
          ...nextOpts[optionIndex],
          votes: nextOpts[optionIndex].votes + 1,
        };

        const nextSettings = { ...prev, options: nextOpts };
        savePollSettings(nextSettings);

        // Comprobar cambio de líder (Impact Clash & Emoción)
        const newLeader = determineLeader(nextOpts[0].votes, nextOpts[1].votes);
        if (newLeader !== 'TIE' && newLeader !== previousLeaderRef.current) {
          previousLeaderRef.current = newLeader;
          if (nextSettings.audioEffectsEnabled) {
            playLeadClash(nextSettings.audioVolume);
          }

          if (nextSettings.ttsAnnouncer.enabled) {
            const leadName = newLeader === 'A' ? nextOpts[0].label : nextOpts[1].label;
            const msg = nextSettings.ttsAnnouncer.leadChangeText.replace('{ganador}', leadName);
            speakPollEmotionCue(msg, nextSettings.ttsAnnouncer.leadChangeEmotion);
            postBus({
              type: 'POLL_TTS_CUE',
              cue: { text: msg, emotion: nextSettings.ttsAnnouncer.leadChangeEmotion },
            });
          }
        }

        return nextSettings;
      });

      // Registrar voto del usuario
      setUserVotes((prev) => {
        const nextMap = new Map(prev);
        nextMap.set(normalizedUser, optionIndex);
        return nextMap;
      });

      // Audio tick táctil
      if (settings.audioEffectsEnabled) {
        playVoteTick(settings.audioVolume, optionIndex);
      }

      broadcastState(undefined, undefined, null, user, optionIndex);
    },
    [winner, userVotes, settings, broadcastState]
  );

  // Iniciar batalla
  const startBattle = useCallback((customDuration?: number) => {
    const dur = customDuration || settings.durationSec;
    setTimeLeft(dur);
    setIsActive(true);
    setWinner(null);
    postBus({
      type: 'POLL_START',
      poll: {
        title: settings.activeBattleTitle,
        optionA: { label: settings.options[0].label, sublabel: settings.options[0].sublabel, color: settings.options[0].color },
        optionB: { label: settings.options[1].label, sublabel: settings.options[1].sublabel, color: settings.options[1].color },
        durationSec: dur,
        startedBy: 'Streamer',
        startedByRole: 'broadcaster',
      },
    });
    broadcastState(dur, true, null);
  }, [settings, broadcastState]);

  // Pausar batalla
  const pauseBattle = useCallback(() => {
    setIsActive(false);
    postBus({ type: 'POLL_STOP', user: 'Streamer' });
    broadcastState(timeLeft, false, winner);
  }, [timeLeft, winner, broadcastState]);

  // Reiniciar votos y reloj
  const resetBattle = useCallback(() => {
    setIsActive(false);
    setTimeLeft(settings.durationSec);
    setWinner(null);
    setUserVotes(new Map());
    previousLeaderRef.current = 'TIE';

    setSettings((prev) => {
      const resetOpts = [
        { ...prev.options[0], votes: 0 },
        { ...prev.options[1], votes: 0 },
      ] as [typeof prev.options[0], typeof prev.options[1]];

      const next = { ...prev, options: resetOpts };
      savePollSettings(next);
      return next;
    });

    postBus({ type: 'POLL_CLEAR' });
    broadcastState(settings.durationSec, false, null);
  }, [settings.durationSec, broadcastState]);

  // Cargar preset de batalla
  const loadPreset = useCallback((preset: PollBattlePreset) => {
    setIsActive(false);
    setWinner(null);
    setTimeLeft(preset.durationSec);
    setUserVotes(new Map());
    previousLeaderRef.current = 'TIE';

    setSettings((prev) => {
      const next: PollSettings = {
        ...prev,
        activeBattleTitle: preset.title,
        durationSec: preset.durationSec,
        options: [
          {
            ...prev.options[0],
            label: preset.optionA.label,
            sublabel: preset.optionA.sublabel,
            color: preset.optionA.color,
            votes: 0,
          },
          {
            ...prev.options[1],
            label: preset.optionB.label,
            sublabel: preset.optionB.sublabel,
            color: preset.optionB.color,
            votes: 0,
          },
        ],
      };
      savePollSettings(next);
      return next;
    });

    broadcastState(preset.durationSec, false, null);
  }, [broadcastState]);

  // Ciclo del temporizador
  useEffect(() => {
    if (!isActive) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setIsActive(false);

          const finalWinner = determineLeader(settings.options[0].votes, settings.options[1].votes);
          setWinner(finalWinner);

          // Audio y Fanfarria
          if (settings.audioEffectsEnabled) {
            playPollVictoryFanfare(settings.audioVolume);
          }

          // Locución Emocional de Victoria
          if (settings.ttsAnnouncer.enabled) {
            const winName =
              finalWinner === 'A'
                ? settings.options[0].label
                : finalWinner === 'B'
                ? settings.options[1].label
                : 'Empate Técnico';

            const total = settings.options[0].votes + settings.options[1].votes;
            const pct =
              total > 0
                ? Math.round(
                    ((finalWinner === 'A' ? settings.options[0].votes : settings.options[1].votes) /
                      total) *
                      100
                  )
                : 50;

            const ttsMsg =
              finalWinner === 'TIE'
                ? settings.ttsAnnouncer.tieText
                : settings.ttsAnnouncer.winnerAnnouncementText
                    .replace('{ganador}', winName)
                    .replace('{porcentaje}', pct.toString());

            const emotion =
              finalWinner === 'TIE'
                ? settings.ttsAnnouncer.tieEmotion
                : settings.ttsAnnouncer.winnerEmotion;

            speakPollEmotionCue(ttsMsg, emotion);
            postBus({ type: 'POLL_TTS_CUE', cue: { text: ttsMsg, emotion } });
          }

          broadcastState(0, false, finalWinner);
          return 0;
        }

        // Aviso en últimos 10s
        if (prev === 11 && settings.ttsAnnouncer.enabled) {
          speakPollEmotionCue(
            settings.ttsAnnouncer.countdownText,
            settings.ttsAnnouncer.countdownEmotion
          );
          postBus({
            type: 'POLL_TTS_CUE',
            cue: {
              text: settings.ttsAnnouncer.countdownText,
              emotion: settings.ttsAnnouncer.countdownEmotion,
            },
          });
        }

        // Ticks auditivos de urgencia
        if (prev <= 5 && settings.audioEffectsEnabled) {
          playCountdownBeep(settings.audioVolume, true);
        } else if (prev <= 10 && settings.audioEffectsEnabled) {
          playCountdownBeep(settings.audioVolume, false);
        }

        broadcastState(prev - 1, true, null);
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive, settings, broadcastState]);

  // Escuchar bus para sincronización externa (ej. si llega voto o comando desde Widget o moderación)
  useEffect(() => {
    return listenBus((msg) => {
      if (msg.type === 'POLL_START') {
        const poll = msg.poll;
        setTimeLeft(poll.durationSec);
        setIsActive(true);
        setWinner(null);
        setUserVotes(new Map());
        previousLeaderRef.current = 'TIE';
        setSettings((prev) => ({
          ...prev,
          activeBattleTitle: poll.title,
          durationSec: poll.durationSec,
          options: [
            {
              ...prev.options[0],
              label: poll.optionA.label,
              sublabel: poll.optionA.sublabel,
              color: poll.optionA.color || prev.options[0].color,
              votes: 0,
            },
            {
              ...prev.options[1],
              label: poll.optionB.label,
              sublabel: poll.optionB.sublabel,
              color: poll.optionB.color || prev.options[1].color,
              votes: 0,
            },
          ],
        }));
      }
      if (msg.type === 'POLL_STOP') {
        setIsActive(false);
        setWinner(null);
      }
      if (msg.type === 'POLL_STATE_UPDATE') {
        if (msg.state) {
          setTimeLeft(msg.state.timeLeftSec);
          setIsActive(msg.state.isActive);
          if (msg.state.winner !== undefined) {
            setWinner(msg.state.winner);
          }
          setSettings((prev) => ({
            ...prev,
            activeBattleTitle: msg.state.title,
            options: [
              { ...prev.options[0], votes: msg.state.optionA.votes, label: msg.state.optionA.label },
              { ...prev.options[1], votes: msg.state.optionB.votes, label: msg.state.optionB.label },
            ],
          }));
        }
      }
      if (msg.type === 'POLL_VOTE') {
        castVote(msg.option, msg.user);
      }
      if (msg.type === 'POLL_CLEAR') {
        setWinner(null);
        setIsActive(false);
      }
    });
  }, [castVote]);

  return {
    settings,
    saved,
    timeLeft,
    isActive,
    winner,
    leader,
    totalVotes: optA.votes + optB.votes,
    castVote,
    startBattle,
    pauseBattle,
    resetBattle,
    loadPreset,
    updateSettings,
  };
}
