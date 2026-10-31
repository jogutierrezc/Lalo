-- =============================================================================
-- 0042_twitch_bot_sender_streamer.sql
--
-- Modo de envío «streamer» del bot de chat en la nube: el bot escribe con la propia
-- cuenta de cada streamer en vez de la cuenta global Lalo.
--
-- La columna sender_mode (0039) ya admite 'global' y 'streamer' en su check, así que no
-- hace falta tocar el constraint. Esta migración solo cambia el valor POR DEFECTO de las
-- filas NUEVAS a 'streamer'. Las filas que ya existen no se tocan: nadie cambia de cuenta
-- de envío sin pedirlo. (El servidor ya manda sender_mode al crear una fila, así que la
-- aplicación funciona igual sin esta migración; solo deja la base coherente.)
--
-- El limitador de envíos (0040) ya cuenta por sender_id (bot_id): en modo streamer cada
-- streamer tiene su propio cupo. No hay cambios allí.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0039. Se puede volver a ejecutar.
-- =============================================================================

alter table public.twitch_bot_settings
  alter column sender_mode set default 'streamer';
