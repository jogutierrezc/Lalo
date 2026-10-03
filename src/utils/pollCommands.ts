/**
 * src/utils/pollCommands.ts
 *
 * Parser de comandos de moderación para activar y personalizar Batallas & Encuestas en Vivo.
 * Permite a los moderadores y al streamer iniciar encuestas personalizadas,
 * seleccionar plantillas o detener votaciones activas mediante el chat de Twitch.
 *
 * Sintaxis admitidas:
 * - Con comillas: !poll "Título" "Opción A" "Opción B" [duración]
 * - Con pipes (|): !poll Título | Opción A | Opción B | [duración]
 * - Con vs: !poll Gatos vs Perros [duración]
 * - Con presets: !poll preset gamer [duración]
 * - Inicio rápido: !poll [duración] o !poll
 * - Cancelar/Detener: !poll stop | !poll cancelar | !encuesta fin
 */

import { DEFAULT_BATTLE_PRESETS, PollBattlePreset } from '../types/polls';

export type PollCommandAction = 'start' | 'stop';

export interface ParsedPollCommand {
  action: PollCommandAction;
  title?: string;
  optionA?: string;
  optionB?: string;
  durationSec?: number;
  presetId?: string;
  rawInput: string;
}

export interface PollStartEvent {
  title: string;
  optionA: { label: string; sublabel?: string; color?: string };
  optionB: { label: string; sublabel?: string; color?: string };
  durationSec: number;
  startedBy: string;
  startedByRole: 'mod' | 'broadcaster';
}

export const MIN_POLL_DURATION_SEC = 10;
export const MAX_POLL_DURATION_SEC = 600;
export const DEFAULT_POLL_DURATION_SEC = 60;

/**
 * Normaliza y acota el tiempo de votación en segundos.
 */
export function clampPollDuration(seconds?: number | string | null): number {
  if (seconds === undefined || seconds === null || seconds === '') {
    return DEFAULT_POLL_DURATION_SEC;
  }
  const cleanStr = String(seconds).replace(/(?:s|seg|segundos)$/i, '').trim();
  const num = parseInt(cleanStr, 10);
  if (isNaN(num)) return DEFAULT_POLL_DURATION_SEC;
  return Math.max(MIN_POLL_DURATION_SEC, Math.min(MAX_POLL_DURATION_SEC, Math.round(num)));
}

/**
 * Extrae número de duración si la cadena termina en un número válido.
 */
function extractTrailingDuration(text: string): { cleanText: string; duration: number | null } {
  const match = text.match(/\s+(\d{1,4})(?:s|seg|segundos)?$/i);
  if (!match) return { cleanText: text, duration: null };

  const parsed = parseInt(match[1], 10);
  if (isNaN(parsed) || parsed < 5) return { cleanText: text, duration: null };

  const cleanText = text.slice(0, match.index).trim();
  return { cleanText, duration: clampPollDuration(parsed) };
}

/**
 * Parsea un comando de chat para moderadores de encuestas/batallas.
 * Devuelve ParsedPollCommand o null si no corresponde a un comando de encuesta.
 */
export function parsePollCommand(message: string): ParsedPollCommand | null {
  if (!message) return null;
  const raw = message.trim();

  // 1. Detectar prefijo de comando (!poll, !encuesta, !batalla, !versus)
  const prefixMatch = raw.match(/^!(?:poll|encuesta|batalla|versus)(?:\s+(.*))?$/i);
  if (!prefixMatch) return null;

  const remainder = (prefixMatch[1] || '').trim();

  // 2. Comandos de cancelación / detención inmediata
  if (/^(?:stop|cancel|cancelar|fin|parar|terminar|end)\b/i.test(remainder)) {
    return {
      action: 'stop',
      rawInput: raw,
    };
  }

  // 3. Inicio rápido vacío (!poll) o solo con duración (!poll 45, !poll start 30)
  if (!remainder) {
    return {
      action: 'start',
      durationSec: DEFAULT_POLL_DURATION_SEC,
      rawInput: raw,
    };
  }

  const quickDurationMatch = remainder.match(/^(?:start\s+)?(\d{1,4})(?:s|seg|segundos)?$/i);
  if (quickDurationMatch) {
    return {
      action: 'start',
      durationSec: clampPollDuration(quickDurationMatch[1]),
      rawInput: raw,
    };
  }

  if (/^start$/i.test(remainder)) {
    return {
      action: 'start',
      durationSec: DEFAULT_POLL_DURATION_SEC,
      rawInput: raw,
    };
  }

  // 4. Presets rápidos (!poll preset gamer, !poll preset 1 45, etc.)
  const presetMatch = remainder.match(/^(?:preset|plantilla)\s+([a-zA-Z0-9_-]+)(?:\s+(\d{1,4}))?$/i);
  if (presetMatch) {
    const key = presetMatch[1].toLowerCase();
    const duration = presetMatch[2] ? clampPollDuration(presetMatch[2]) : undefined;

    let foundPreset: PollBattlePreset | undefined;
    if (key === '1' || key.includes('gamer')) {
      foundPreset = DEFAULT_BATTLE_PRESETS.find((p) => p.id === 'preset-gamer');
    } else if (key === '2' || key.includes('castigo')) {
      foundPreset = DEFAULT_BATTLE_PRESETS.find((p) => p.id === 'preset-castigos');
    } else if (key === '3' || key.includes('comida') || key.includes('irl')) {
      foundPreset = DEFAULT_BATTLE_PRESETS.find((p) => p.id === 'preset-comida');
    } else if (key === '4' || key.includes('juicio') || key.includes('show')) {
      foundPreset = DEFAULT_BATTLE_PRESETS.find((p) => p.id === 'preset-juicio');
    } else {
      foundPreset = DEFAULT_BATTLE_PRESETS.find((p) => p.id.toLowerCase().includes(key));
    }

    if (foundPreset) {
      return {
        action: 'start',
        title: foundPreset.title,
        optionA: foundPreset.optionA.label,
        optionB: foundPreset.optionB.label,
        durationSec: duration ?? foundPreset.durationSec,
        presetId: foundPreset.id,
        rawInput: raw,
      };
    }
  }

  // 5. Sintaxis con comillas ("Título" "Opción A" "Opción B" [duración])
  const quoteMatches: string[] = [];
  const quoteRegex = /"([^"]+)"|'([^']+)'/g;
  let qm: RegExpExecArray | null;
  while ((qm = quoteRegex.exec(remainder)) !== null) {
    quoteMatches.push((qm[1] || qm[2] || '').trim());
  }

  if (quoteMatches.length >= 2) {
    // Buscar duración después de la última comilla
    const lastQuoteIndex = remainder.lastIndexOf('"') > remainder.lastIndexOf("'")
      ? remainder.lastIndexOf('"')
      : remainder.lastIndexOf("'");
    const afterQuotes = remainder.slice(lastQuoteIndex + 1).trim();
    const durationAfterQuotes = afterQuotes ? clampPollDuration(afterQuotes) : DEFAULT_POLL_DURATION_SEC;

    if (quoteMatches.length >= 3) {
      return {
        action: 'start',
        title: quoteMatches[0],
        optionA: quoteMatches[1],
        optionB: quoteMatches[2],
        durationSec: durationAfterQuotes,
        rawInput: raw,
      };
    }

    // 2 comillas: Opción A y Opción B
    return {
      action: 'start',
      title: `${quoteMatches[0]} vs ${quoteMatches[1]}`,
      optionA: quoteMatches[0],
      optionB: quoteMatches[1],
      durationSec: durationAfterQuotes,
      rawInput: raw,
    };
  }

  // 6. Sintaxis con separador Pipe (|)
  if (remainder.includes('|')) {
    const parts = remainder.split('|').map((p) => p.trim()).filter(Boolean);

    // Caso A: 4 partes -> Título | Opción A | Opción B | 45
    if (parts.length >= 4) {
      const dur = clampPollDuration(parts[3]);
      return {
        action: 'start',
        title: parts[0],
        optionA: parts[1],
        optionB: parts[2],
        durationSec: dur,
        rawInput: raw,
      };
    }

    // Caso B: 3 partes
    if (parts.length === 3) {
      const maybeDur = parseInt(parts[2].replace(/(?:s|seg|segundos)$/i, ''), 10);
      if (!isNaN(maybeDur) && maybeDur >= 5) {
        // Opción A | Opción B | 45
        return {
          action: 'start',
          title: `${parts[0]} vs ${parts[1]}`,
          optionA: parts[0],
          optionB: parts[1],
          durationSec: clampPollDuration(maybeDur),
          rawInput: raw,
        };
      }
      // Título | Opción A | Opción B
      return {
        action: 'start',
        title: parts[0],
        optionA: parts[1],
        optionB: parts[2],
        durationSec: DEFAULT_POLL_DURATION_SEC,
        rawInput: raw,
      };
    }

    // Caso C: 2 partes -> Opción A | Opción B
    if (parts.length === 2) {
      const { cleanText: optB, duration } = extractTrailingDuration(parts[1]);
      return {
        action: 'start',
        title: `${parts[0]} vs ${optB}`,
        optionA: parts[0],
        optionB: optB,
        durationSec: duration ?? DEFAULT_POLL_DURATION_SEC,
        rawInput: raw,
      };
    }
  }

  // 7. Sintaxis "vs" sin comillas: !poll Gatos vs Perros 45
  const vsMatch = remainder.match(/^(.*?)\s+vs\.?\s+(.*)$/i);
  if (vsMatch) {
    const rawA = vsMatch[1].trim();
    const rawB = vsMatch[2].trim();
    const { cleanText: optB, duration } = extractTrailingDuration(rawB);

    if (rawA && optB) {
      return {
        action: 'start',
        title: `${rawA} vs ${optB}`,
        optionA: rawA,
        optionB: optB,
        durationSec: duration ?? DEFAULT_POLL_DURATION_SEC,
        rawInput: raw,
      };
    }
  }

  // 8. Espacio simple si son 2 palabras: !poll Gatos Perros
  const words = remainder.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const { cleanText: lastWord, duration } = extractTrailingDuration(words[words.length - 1]);
    const cleanWords = [...words.slice(0, -1), lastWord].filter(Boolean);

    if (cleanWords.length === 2) {
      return {
        action: 'start',
        title: `${cleanWords[0]} vs ${cleanWords[1]}`,
        optionA: cleanWords[0],
        optionB: cleanWords[1],
        durationSec: duration ?? DEFAULT_POLL_DURATION_SEC,
        rawInput: raw,
      };
    }
  }

  // Por defecto, interpretar el texto como título de la encuesta
  const { cleanText: customTitle, duration } = extractTrailingDuration(remainder);
  return {
    action: 'start',
    title: customTitle,
    durationSec: duration ?? DEFAULT_POLL_DURATION_SEC,
    rawInput: raw,
  };
}
