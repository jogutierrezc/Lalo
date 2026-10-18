-- =============================================================================
-- 0036_lux_chat_word.sql
--
-- Comando de activación de Mi AI en el chat: la palabra con la que el público
-- habla con el personaje (por defecto «lux», así que nadie se rompe) y el
-- interruptor del alias !lux. Amplía la 0024 (lux_settings).
--
--   1. chat_word: la palabra, en minúsculas, de 2 a 20 letras o números (ASCII).
--      Sin espacios ni símbolos. No puede ser un comando reservado del bot
--      (s, luxon, luxoff). La validación real está en server/lux/chatCommands.ts;
--      esta restricción es la última red.
--   2. chat_alias: si !lux sigue funcionando cuando la palabra es otra.
--      Encendido por defecto. Con la palabra «lux» no tiene efecto.
--
-- El bot lee estos valores al generarse (src/components/bot/pythonScript.ts):
-- cambiarlos obliga a volver a copiar el script del bot.
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0001 a 0035.
-- Se puede volver a ejecutar.
-- =============================================================================

alter table public.lux_settings add column if not exists chat_word text not null default 'lux';
alter table public.lux_settings add column if not exists chat_alias boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lux_settings_chat_word_check') then
    alter table public.lux_settings add constraint lux_settings_chat_word_check
      check (chat_word ~ '^[a-z0-9]{2,20}$' and chat_word not in ('s', 'luxon', 'luxoff'));
  end if;
end $$;
