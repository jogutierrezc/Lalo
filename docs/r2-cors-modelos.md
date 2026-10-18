# Regla CORS del bucket privado de modelos (R2_MODELS_BUCKET)

Sin esta regla el navegador no puede enviar el GLB a R2 desde el panel de Mi AI. La
regla solo permite `PUT` desde las direcciones de Lalo; no abre lecturas, así que el
bucket sigue siendo privado. El JSON está en `docs/r2-cors-modelos.json`.

Hay que aplicarla **a mano en Cloudflare** (no lo hace el código). Es un cambio
en producción: lo aplica jagc.

## Antes de aplicarla

Cambia `https://TU-APP.vercel.app` en el JSON por la dirección real del panel
de Lalo (sin barra final). Los dos `localhost` son para desarrollo; quítalos si
no quieres que el bucket acepte subidas desde tu equipo.

## Pasos en el panel de Cloudflare

1. Abre **R2 Object Storage** y entra en el bucket **privado** de modelos (el que
   está en `R2_MODELS_BUCKET`, no el público de `R2_BUCKET`).
2. Ve a **Settings**, sección **CORS Policy**, y pulsa **Add CORS policy**.
3. En la pestaña JSON pega el contenido de `docs/r2-cors-modelos.json`, con la
   dirección ya cambiada.
4. Pulsa **Save**. Puede tardar hasta medio minuto en aplicarse.

## Cómo comprobarlo

1. Entra en el panel de Mi AI como administrador, abre la ficha de un personaje
   con «Mascota 2 (modelo propio)», elige un origen y sube un `.glb` pequeño.
2. Si la barra avanza y aparece «Modelo subido», la regla funciona.
3. Si aparece «No se pudo subir. Vuelve a intentarlo», revisa que la dirección
   del JSON coincida exactamente con la del panel (protocolo, sin barra final) y
   que el bucket sea el de `R2_MODELS_BUCKET`.
