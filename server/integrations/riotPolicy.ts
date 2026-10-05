/**
 * server/integrations/riotPolicy.ts
 *
 * Versión vigente de la «Política de uso de la integración con Riot Games»
 * (el texto vive en src/legal/riot.ts). El servidor la exige al vincular una
 * cuenta de Riot y guarda cuál se aceptó y cuándo. Subirla hace que la ficha de
 * Integraciones vuelva a pedir la aceptación a quien ya tenía la cuenta
 * vinculada; al resto de streamers no se les pide nada.
 */

export const RIOT_POLICY_VERSION = '1.0';
export const RIOT_POLICY_UPDATED_AT = '2026-10-04';
