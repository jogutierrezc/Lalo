"""
TwitchIO Bridge for Lalo Stream Suite
=====================================
Framework: TwitchIO (https://github.com/TwitchIO/TwitchIO)
Creadores & Autores: PythonistaGuild & EvieePy
Licencia: MIT License (https://opensource.org/licenses/MIT)

Este script proporciona un puente de alta velocidad entre el chat de Twitch
y la suite de streaming Lalo. Recibe comandos en tiempo real y eventos de EventSub,
retransmitiéndolos automáticamente al servidor de Lalo (http://localhost:3001).

Instalación de dependencias:
    pip install twitchio aiohttp python-dotenv

Ejecución:
    python server/twitchio_bridge.py
"""

import os
import sys
import asyncio
import logging
from typing import Optional

try:
    import aiohttp
    from twitchio.ext import commands
    from twitchio.ext import routines
except ImportError:
    print("\n[!] Dependencias faltantes. Instala TwitchIO con:")
    print("    pip install twitchio aiohttp python-dotenv\n")
    sys.exit(1)

# Configuración desde entorno o valores por defecto
TWITCH_TOKEN = os.getenv("TWITCH_OAUTH_TOKEN", "")
TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID", "")
TWITCH_CHANNEL = os.getenv("TWITCH_CHANNEL", "laloplay_")
BOT_PREFIX = os.getenv("TWITCHIO_PREFIX", "!")
LALO_SERVER_URL = os.getenv("LALO_SERVER_URL", "http://localhost:3001/api/twitchio/event")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("LaloTwitchIO")


class LaloTwitchIOBot(commands.Bot):
    """
    Bot asíncrono para Twitch desarrollado con el framework TwitchIO de PythonistaGuild.
    """

    def __init__(self):
        super().__init__(
            token=TWITCH_TOKEN if TWITCH_TOKEN else "anonymous",
            prefix=BOT_PREFIX,
            initial_channels=[TWITCH_CHANNEL],
        )
        self.session: Optional[aiohttp.ClientSession] = None

    async def forward_to_lalo(self, event_type: str, data: dict):
        """Reenvía un evento al servidor backend de Lalo Stream Suite."""
        if not self.session:
            self.session = aiohttp.ClientSession()
        try:
            payload = {"type": event_type, "channel": TWITCH_CHANNEL, "data": data}
            async with self.session.post(LALO_SERVER_URL, json=payload, timeout=2.0) as resp:
                if resp.status == 200:
                    logger.info(f"-> Evento {event_type} sincronizado con Lalo Suite.")
        except Exception as e:
            # Fallo silencioso si el servidor local de Lalo aún no está corriendo
            logger.debug(f"Servidor Lalo no disponible en {LALO_SERVER_URL}: {e}")

    async def event_ready(self):
        """Se ejecuta cuando el bot se conecta satisfactoriamente a Twitch."""
        logger.info("=" * 60)
        logger.info("  Lalo Stream Suite - TwitchIO Bot Gateway")
        logger.info("  Powered by TwitchIO (PythonistaGuild & EvieePy - MIT License)")
        logger.info(f"  Canal conectado: #{TWITCH_CHANNEL}")
        logger.info(f"  Prefijo activo: {BOT_PREFIX}")
        logger.info("=" * 60)

    async def event_message(self, message):
        """Filtro de mensajes y enrutamiento hacia la cola de TTS de Lalo."""
        if message.echo:
            return

        # Si el mensaje comienza con el trigger de TTS (!s)
        if message.content.startswith(f"{BOT_PREFIX}s ") or message.content.startswith("!s "):
            clean_text = message.content.split(" ", 1)[1].strip()
            logger.info(f"[TTS] {message.author.name}: {clean_text}")
            await self.forward_to_lalo(
                "TTS_MESSAGE",
                {
                    "user": message.author.name,
                    "text": clean_text,
                    "is_mod": message.author.is_mod,
                    "is_sub": message.author.is_subscriber,
                },
            )

        # Procesar comandos registrados en TwitchIO
        await self.handle_commands(message)

    # -------------------------------------------------------------
    # Comandos de TwitchIO
    # -------------------------------------------------------------

    @commands.command(name="lalo")
    async def lalo_command(self, ctx: commands.Context):
        """Informa sobre la suite activa en el stream."""
        await ctx.send("Lalo Stream Suite: TTS con voces de IA clonadas + Alertas (Powered by TwitchIO).")

    @commands.command(name="alerta")
    async def alerta_command(self, ctx: commands.Context):
        """Dispara una alerta de prueba en el overlay."""
        await self.forward_to_lalo(
            "ALERT_TRIGGER",
            {"eventType": "bits", "user": ctx.author.name, "text": f"¡{ctx.author.name} activó una alerta!"},
        )
        await ctx.send(f"¡Alerta activada en pantalla por @{ctx.author.name}!")

    @commands.command(name="help", aliases=["ayuda", "comandos"])
    async def help_command(self, ctx: commands.Context):
        """Muestra los comandos públicos disponibles."""
        await ctx.send(f"Comandos disponibles: {BOT_PREFIX}s [texto] (leer en voz alta), {BOT_PREFIX}alerta, {BOT_PREFIX}lalo.")

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
        await super().close()


def main():
    print("\nIniciando Lalo TwitchIO Bridge...")
    bot = LaloTwitchIOBot()
    try:
        bot.run()
    except KeyboardInterrupt:
        print("\nPuente TwitchIO detenido por el usuario.")


if __name__ == "__main__":
    main()
