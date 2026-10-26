-- =============================================================================
-- 0040_twitch_bot_limiter.sql
--
-- Limitador de envíos del bot de chat de Twitch que sobrevive entre peticiones.
-- En Vercel cada aviso de EventSub puede caer en una instancia distinta, así que
-- el limitador en memoria de chatSend.ts no basta. Twitch deja al bot 20 mensajes
-- cada 30 s en total y 1 por segundo en cada canal; si se pasa, lo ignora durante
-- una hora. Además, un solo canal (o un espectador que lo satura) no debe poder gastar
-- el cupo de todos los demás: cada canal tiene su propio tope dentro de la ventana de 30 s.
-- Por eso se cuenta aquí:
--
--   twitch_bot_sends: una fila por mensaje enviado (cuenta del bot, canal, hora).
--                     Solo guarda ids de Twitch y la hora; nada del contenido.
--   take_twitch_bot_send(bot, canal, tope, tope_canal): decide y anota en una sola transacción.
--                     Un candado asesor por cuenta del bot hace que dos avisos a
--                     la vez no se lleven el mismo hueco. Devuelve jsonb:
--                       {"ok": true}
--                       {"ok": false, "waitMs": <ms>, "scope": "channel" | "account"}
--                     "channel" cubre el 1/s y el tope por canal en 30 s (p_channel_max, 6 por defecto).
--                     y, cuando no deja enviar, NO anota nada. Usa la hora de la
--                     base de datos (clock_timestamp), no la del servidor web.
--                     Borra de paso las filas de más de 60 s de esa cuenta.
--
-- RLS sin políticas: solo el servidor con la clave de servicio toca la tabla, y
-- solo la clave de servicio ejecuta la función (mismo patrón que 0039).
--
-- SIN PROBAR contra un proyecto real. Ejecutar después de 0039. Se puede volver a ejecutar.
-- =============================================================================

create table if not exists public.twitch_bot_sends (
  id          bigint generated always as identity primary key,
  bot_id      text not null check (char_length(bot_id) between 1 and 20),
  channel_id  text not null check (char_length(channel_id) between 1 and 20),
  sent_at     timestamptz not null default clock_timestamp()
);

create index if not exists twitch_bot_sends_bot_idx on public.twitch_bot_sends (bot_id, sent_at desc);
create index if not exists twitch_bot_sends_channel_idx on public.twitch_bot_sends (bot_id, channel_id, sent_at desc);

alter table public.twitch_bot_sends enable row level security;

-- Por si una versión anterior de 3 argumentos llegó a crearse: dos sobrecargas harían ambigua la llamada
drop function if exists public.take_twitch_bot_send(text, text, integer);

create or replace function public.take_twitch_bot_send(
  p_bot_id      text,
  p_channel_id  text,
  p_account_max integer default 20,
  p_channel_max integer default 6
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now          timestamptz := clock_timestamp();
  v_max          integer := greatest(coalesce(p_account_max, 20), 1);
  v_cmax         integer := greatest(coalesce(p_channel_max, 6), 1);
  v_ccount       integer;
  v_cnth         timestamptz;
  v_last_channel timestamptz;
  v_count        integer;
  v_nth          timestamptz;
  v_channel_wait integer := 0;
  v_account_wait integer := 0;
begin
  -- Un solo envío a la vez por cuenta de bot: el candado se suelta al acabar la transacción
  perform pg_advisory_xact_lock(hashtextextended('twitch_bot_send:' || p_bot_id, 0));

  delete from public.twitch_bot_sends
    where bot_id = p_bot_id and sent_at < v_now - interval '60 seconds';

  select max(sent_at) into v_last_channel
    from public.twitch_bot_sends
    where bot_id = p_bot_id and channel_id = p_channel_id;
  if v_last_channel is not null and v_last_channel > v_now - interval '1 second' then
    v_channel_wait := ceil(extract(epoch from (v_last_channel + interval '1 second' - v_now)) * 1000)::integer;
  end if;

  -- Tope por canal en la ventana de 30 s: ningún canal se lleva todo el cupo de la cuenta
  select count(*) into v_ccount
    from public.twitch_bot_sends
    where bot_id = p_bot_id and channel_id = p_channel_id and sent_at > v_now - interval '30 seconds';
  if v_ccount >= v_cmax then
    select sent_at into v_cnth
      from public.twitch_bot_sends
      where bot_id = p_bot_id and channel_id = p_channel_id and sent_at > v_now - interval '30 seconds'
      order by sent_at desc
      offset v_cmax - 1 limit 1;
    v_channel_wait := greatest(v_channel_wait, ceil(extract(epoch from (v_cnth + interval '30 seconds' - v_now)) * 1000)::integer);
  end if;

  select count(*) into v_count
    from public.twitch_bot_sends
    where bot_id = p_bot_id and sent_at > v_now - interval '30 seconds';
  if v_count >= v_max then
    -- El mensaje número `v_max` contando desde el más reciente es el que, al salir de la ventana, abre hueco
    select sent_at into v_nth
      from public.twitch_bot_sends
      where bot_id = p_bot_id and sent_at > v_now - interval '30 seconds'
      order by sent_at desc
      offset v_max - 1 limit 1;
    v_account_wait := ceil(extract(epoch from (v_nth + interval '30 seconds' - v_now)) * 1000)::integer;
  end if;

  if v_channel_wait > 0 or v_account_wait > 0 then
    if v_account_wait > v_channel_wait then
      return jsonb_build_object('ok', false, 'waitMs', v_account_wait, 'scope', 'account');
    end if;
    return jsonb_build_object('ok', false, 'waitMs', v_channel_wait, 'scope', 'channel');
  end if;

  insert into public.twitch_bot_sends (bot_id, channel_id, sent_at) values (p_bot_id, p_channel_id, v_now);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.take_twitch_bot_send(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.take_twitch_bot_send(text, text, integer, integer) to service_role;
