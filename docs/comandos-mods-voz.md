# Comandos de moderación para la voz del chat · Lalo Stream Suite

Se escriben en el chat de Twitch del canal. Solo los obedece Lalo si los escribe el **streamer** o alguien con la **insignia de moderador**.

Cuando un comando funciona, en el directo sale una placa «Moderación» con quién lo usó y suena un timbre (y una locución). Lalo **no responde en el chat**: la confirmación se ve y se oye en el stream.

> **Regla de oro:** el comando va solo en el mensaje. `!pausa` funciona; `!pausa porfa` no.
> Cada comando también vale con el prefijo de la voz y sin la segunda exclamación: `!s pausa` = `!pausa`.

---

## Cola y reproducción

| Comando | Qué hace | Alias |
|---|---|---|
| `!saltar` | Corta el mensaje que suena y pasa al siguiente | `!skip` `!siguiente` `!next` |
| `!pausa` | Pausa la voz (el mensaje que suena termina) | `!pause` `!pausar` |
| `!continuar` | Reanuda la voz | `!resume` `!reanudar` |
| `!limpiar` | Vacía la cola de mensajes en espera | `!clear` `!vaciar` |
| `!silencio` | Emergencia: corta la voz, vacía la cola y pausa | `!panic` `!panico` |

## Usuarios

| Comando | Qué hace | Alias |
|---|---|---|
| `!bloquear usuario` | La voz deja de leer a ese usuario | `!block` `!ban` |
| `!desbloquear usuario` | Lo permite de nuevo y quita su silencio temporal | `!unblock` `!unban` |
| `!silenciar usuario 30` | Bloqueo temporal en minutos (sin número, 10; máximo 1440) | `!timeout` |

El usuario puede ir con o sin `@`. Ejemplo: `!silenciar pau_rl 30`

## Aprobación manual

| Comando | Qué hace | Alias |
|---|---|---|
| `!manual` | Cada mensaje espera a que lo aprueben | |
| `!ok` | Aprueba el mensaje más antiguo en espera | `!aprobar` `!approve` |
| `!no` | Rechaza el mensaje más antiguo en espera | `!rechazar` `!reject` |
| `!auto` | Vuelve a leer sin aprobar | `!automatico` |

## Solo texto

| Comando | Qué hace | Alias |
|---|---|---|
| `!mudo` | La voz no suena; los mensajes salen solo en pantalla | `!mute` |
| `!voz` | La voz vuelve a sonar | `!unmute` |

## Fuente de OBS

| Comando | Qué hace | Alias |
|---|---|---|
| `!actualizar` | Recarga la fuente de Lalo en OBS | `!reload` `!update` `!reiniciar` |

---

## Otros comandos de mods que atiende la voz

| Comando | Qué hace |
|---|---|
| `!so canal` | Saluda a un canal (placa con corto si hay capa de raid; si no, lo anuncia la voz) |
| `!clip enlace` | Pone un corto concreto en pantalla |
| `!cortar` | Retira el saludo que está en pantalla |
| `!prediccion texto` | La voz avisa de que hay una predicción abierta (solo la anuncia; se crea en Twitch). También `!pred` `!prediction` |
| `!ruleta` / `!cerrarruleta` | Abre / cierra la ruleta |
| `!cancion` / `!ocultarcancion` | Muestra / oculta «Ahora suena» |
| `!poll A vs B 45` | Batalla de encuesta (10–600 s). `!poll stop` la cancela. También `!encuesta` `!batalla` `!versus` |

---

## Para los espectadores: leer un mensaje con emoción

```
!s hola a todos
!s [feliz] gracias por el raid
```

Etiquetas de emoción (al principio del mensaje): `[feliz]` `[emocionado]` `[triste]` `[enojado]` `[sorprendido]` `[susurro]` `[grito]` `[risa]` `[llorando]` `[miedo]` `[canto]` `[calmado]` `[suspiro]` `[bostezo]` `[nervioso]`. También valen en inglés: `[happy]`, `[excited]`, `[sad]`, `[angry]`…

---

## Notas para el streamer

- Los nombres de `!s`, `!so`, `!clip`, `!cortar`, `!ruleta`, `!cancion` y similares se pueden cambiar en el panel. Si los cambiaste, corrige esta lista antes de compartirla.
- Cada comando necesita su capa abierta en OBS (ruleta, «Ahora suena», saludo de raid). Con «Todo en uno» van todos.
- Si un mod escribe `!s pausa`, Lalo lo toma siempre como la orden de pausar, no como un mensaje para leer.
- Fuente: `docs/comandos-para-moderadores.txt`, `docs/comandos-de-la-voz.txt` y `src/utils/staffVoice.ts`.
