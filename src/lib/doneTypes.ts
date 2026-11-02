/** Contrato compartido de Done AI entre servidor y frontend. */
export type DoneEmotion = 'normal' | 'habla' | 'emocionada' | 'grita' | 'feliz' | 'alegre' | 'triste' | 'molesta' | 'sorprendida' | 'magica';
export type DoneGesture = 'wave' | 'spin' | 'dance' | 'jump' | 'sing' | 'bow' | 'ult' | 'pride' | 'nod' | 'shrug' | 'arms_up';
export type DoneKind = 'chat' | 'event' | 'spontaneous' | 'say';
export interface DoneSettings {
  enabled: boolean;
  commandWord: string;
  keepAlias: boolean;
  writeAs: 'creator' | 'bot';
  personality: string;
  language: 'auto' | 'es' | 'en' | 'fr' | 'pt' | 'it';
  replyMax: number;
  banter: 'off' | 'pique';
  memoryEnabled: boolean;
  threadEnabled: boolean;
  chatLearning: boolean;
  spontaneousEveryMin: 0 | 10 | 15 | 30 | 60;
  spontaneousMinMessages: 3 | 5 | 10;
  eventFollow: boolean;
  eventSub: boolean;
  eventRaid: boolean;
  eventStart: boolean;
  characterId: string | null;
  modelId: string | null;
  obsSize: number;
  position: 'left' | 'center' | 'right';
  voiceVolume: number;
  textStyle: string;
  showText: boolean;
  typingCps: number;
}
export interface DoneSpeech { id: string; text: string; emotion: DoneEmotion; gesture: DoneGesture | null; viewer: string | null; kind: DoneKind; createdAt: string; }
export const DONE_DEFAULTS: DoneSettings = { enabled: true, commandWord: 'done', keepAlias: true, writeAs: 'creator', personality: '', language: 'auto', replyMax: 200, banter: 'off', memoryEnabled: true, threadEnabled: true, chatLearning: false, spontaneousEveryMin: 0, spontaneousMinMessages: 5, eventFollow: true, eventSub: true, eventRaid: true, eventStart: true, characterId: null, modelId: null, obsSize: 40, position: 'right', voiceVolume: 80, textStyle: 'cabina', showText: true, typingCps: 55 };
