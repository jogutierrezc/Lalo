# Cloudflare R2: dónde se guardan los archivos de los streamers

Guía para el dueño del proyecto. Deja listo el almacenamiento de imágenes,
vídeos y sonidos que suben los streamers.

> **Estado: nada de esto se ha probado contra un bucket real ni contra un
> proyecto de Supabase real.** El código y el SQL están escritos siguiendo la
> documentación oficial citada al final. La prueba de verdad es el botón
> **Probar almacenamiento** de la consola (sección Almacenamiento). Hasta que
> esa prueba pase, los streamers no ven el botón de subir.

## Cómo funciona, en corto

- Los archivos viven en un bucket de Cloudflare R2 a tu nombre. Cada streamer
  tiene su carpeta dentro.
- No hay botón de «conectar»: se configura una vez con variables en el
  servidor. Para apagarlo se quitan las variables.
- Cuando un streamer sube un archivo, el servidor de Lalo comprueba su plan y
  le da un permiso de unos minutos para ese archivo, con ese tamaño y ese tipo.
  El navegador lo sube directo a R2. Después el servidor pregunta a R2 el
  tamaño real, y si rompe un límite lo borra.
- Las capas de OBS leen los archivos por la dirección pública del bucket, sin
  sesión.

## 1. Crear el bucket

1. Entra en el panel de Cloudflare y abre **R2 object storage**. La primera
   vez pide activar R2 en la cuenta (puede pedir un método de pago aunque uses
   la capa gratuita; esto no lo comprobé en esta sesión).
2. Crea un bucket. Ponle un nombre simple, por ejemplo `lalo-media`. Ese
   nombre es `R2_BUCKET`.
3. El identificador de tu cuenta (Account ID) aparece en la página de R2, en
   **Account Details**. Es `R2_ACCOUNT_ID`.

## 2. Crear el token de API

1. En **R2 object storage**, dentro de **Account Details**, pulsa **Manage**
   junto a **API Tokens**.
2. Crea un token con el permiso **Object Read & Write** y limítalo a ese
   bucket.
3. Al crearlo, Cloudflare muestra una sola vez:
   - **Access Key ID**: es `R2_ACCESS_KEY_ID`
   - **Secret Access Key**: es `R2_SECRET_ACCESS_KEY`

   Guárdalos en un gestor de contraseñas. No van en el repositorio.

No uses un token «Admin»: Lalo solo necesita leer, escribir y listar objetos
de ese bucket.

## 3. Activar el acceso público

Las capas de OBS necesitan leer los archivos sin iniciar sesión. Hay dos
formas:

**A. Dirección r2.dev (rápida, para probar)**

1. En el bucket, abre **Settings**.
2. En **Public Development URL**, pulsa **Enable**, escribe `allow` y confirma.
3. Copia la dirección que aparece (termina en `.r2.dev`).

Cloudflare avisa de que esta dirección tiene límite de peticiones y es solo
para desarrollo. Sirve para la primera prueba; para emitir de verdad conviene
la opción B.

**B. Dominio propio (para producción)**

Hace falta un dominio gestionado en Cloudflare.

1. En el bucket, **Settings**, **Custom Domains**, **Add**.
2. Escribe el dominio (por ejemplo `media.tudominio.com`), **Continue**.
3. Revisa el registro DNS y pulsa **Connect Domain**.

La dirección elegida, con `https://` y **sin barra final ni nombre de bucket**,
va en dos variables con el mismo valor: `R2_PUBLIC_BASE_URL` (servidor) y
`VITE_R2_PUBLIC_BASE_URL` (app).

Con el acceso público activo, cualquiera que conozca la dirección exacta de un
archivo puede verlo. No se puede listar el contenido del bucket desde fuera.

## 4. Regla CORS

Sin esta regla el navegador no puede subir archivos al bucket.

1. En el bucket, **Settings**, **CORS Policy**, **Add CORS policy**.
2. En la pestaña JSON pega esto, cambiando las direcciones por las de tu app:

```json
[
  {
    "AllowedOrigins": ["https://tu-app.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

3. **Save**. Puede tardar hasta medio minuto en aplicarse.

Las direcciones van sin barra final. Si usas un dominio propio para la app,
añádelo también. `http://localhost:3000` solo hace falta para desarrollo.

## 5. Variables de entorno

| Variable | Qué es | Dónde |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | Identificador de tu cuenta de Cloudflare | servidor |
| `R2_ACCESS_KEY_ID` | Primera parte del token de R2 | servidor |
| `R2_SECRET_ACCESS_KEY` | Segunda parte del token de R2 (secreta) | servidor |
| `R2_BUCKET` | Nombre del bucket | servidor |
| `R2_PUBLIC_BASE_URL` | Dirección pública del bucket | servidor |
| `VITE_R2_PUBLIC_BASE_URL` | La misma dirección pública | app (pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de Supabase (secreta) | servidor |
| `SUPABASE_URL` | Opcional. Si falta, el servidor usa `VITE_SUPABASE_URL` | servidor |

**En Vercel:** Project, Settings, Environment Variables. Añade todas y vuelve
a desplegar: las variables nuevas no llegan a un despliegue ya hecho. Ninguna
de las de servidor debe llevar el prefijo `VITE_`.

**En local:** en el archivo `.env` o `.env.local` de la raíz (ver
`.env.example`). El servidor local lee los dos. Arranca con `npm run dev:all`:
con `npm run dev` a secas no hay servidor y la consola dirá que no responde.

## 6. Migración de la base de datos

En el SQL Editor de Supabase ejecuta `supabase/migrations/0005_r2_storage.sql`
(después de las cuatro anteriores). Sin ella, la consola avisa de que falta y
no se pueden registrar archivos. **Está sin probar**: hazlo antes en un
proyecto de pruebas y copia cualquier error tal cual.

## 7. Probar

1. Entra en la app como administrador y abre **Almacenamiento**.
2. Si faltan variables, la consola dice cuáles (solo los nombres).
3. Pulsa **Probar almacenamiento**. La prueba hace cuatro cosas y dice cuál
   falla:

| Paso | Qué hace | Si falla |
| --- | --- | --- |
| Subir | El servidor sube un archivo pequeño con el token | Revisa cuenta, bucket y permisos del token |
| Leer | Lo descarga por la dirección pública, sin sesión | Falta el acceso público o la dirección no es la de ese bucket |
| Permiso | Pregunta al bucket si acepta subidas desde la dirección de la app | Falta esa dirección en la regla CORS |
| Borrar | Borra el archivo de prueba | El token no tiene permiso de escritura |

4. Con la prueba pasada, entra con una cuenta de streamer, abre **Mi cuenta**
   y sube una imagen, un sonido y un vídeo.

### Lo primero que hay que comprobar a mano

- **Que un vídeo servido desde R2 se reproduce bien en una fuente de navegador
  de OBS**, también al adelantar o repetir. No está probado. Hazlo con la
  dirección r2.dev y, si usas dominio propio, otra vez con el dominio.
- **Que una subida con otro tamaño se rechaza.** El permiso de subida firma el
  tipo y el tamaño del archivo. La documentación de Cloudflare confirma que el
  tipo firmado se exige; del tamaño no dice nada. Aunque R2 no lo exigiera, el
  servidor vuelve a medir el archivo al terminar y lo borra si se pasa.
- **Que el servidor llega al bucket con la forma de dirección que usa.** Lalo
  llama a `https://<cuenta>.r2.cloudflarestorage.com/<bucket>/<archivo>`. La
  documentación da el dominio, pero no dice de forma expresa que el bucket
  pueda ir en la ruta. Si el paso «Subir» falla con un 404 teniendo bien el
  nombre, este es el primer sospechoso.
- **Las funciones en Vercel.** `api/storage/*` y `api/media/*` importan código
  de `server/storage/`. En local funciona; en Vercel no se ha desplegado. El
  proyecto queda con 9 funciones (el plan gratuito de Vercel admite 12 por
  despliegue, cifra que no verifiqué en esta sesión).

## 8. Capacidad y costes

Cifras leídas el 2026-10-03 en la página oficial de precios de R2; pueden
cambiar.

| Capa gratuita de R2 (almacenamiento estándar) | Al mes |
| --- | --- |
| Almacenamiento | 10 GB |
| Operaciones de clase A (escrituras, listados) | 1 millón |
| Operaciones de clase B (lecturas) | 10 millones |
| Salida de datos a Internet | Gratis |

Por encima: 0,015 USD por GB al mes, 4,50 USD por millón de operaciones de
clase A y 0,36 USD por millón de clase B.

La consola usa 10 GB como capacidad por defecto. Se cambia en **Límites,
Capacidad total**. Ese número es solo para los cálculos de Lalo: no cambia nada
en Cloudflare. Lo «usado» es la suma de los archivos registrados en Lalo,
porque R2 no informa del tamaño total del bucket por esta vía.

## 9. Lo que queda sin cubrir

- **Archivos sueltos.** Si un streamer cierra la pestaña justo entre el final
  de la subida y su confirmación, el archivo queda en el bucket sin registro:
  ocupa sitio en R2 y no cuenta para nadie en Lalo. Se ven en el panel de R2.
  Una regla de ciclo de vida del bucket no los distingue de los buenos, así
  que hoy se limpian a mano.
- **Cuentas borradas.** Borrar un usuario en Supabase quita sus registros,
  pero no sus archivos de R2.
- **SVG.** Un SVG puede llevar scripts. Se sirve desde la dirección del
  bucket, no desde la de la app, y la app debe mostrarlos solo con `<img>`.
- **Las capas aún no leen de R2.** El paquete que recibe el widget ya trae la
  clave de cada archivo (`object_key`) y existe la función `mediaPublicUrl`
  para montar la dirección, pero las capas de OBS no se han tocado en este
  cambio: falta conectar la biblioteca de medios de los estudios con estos
  archivos.

## Fuentes consultadas (2026-10-03)

- URL firmadas en R2 (operaciones, caducidad de 1 segundo a 7 días, tipo
  firmado, solo en el dominio de la API de S3, aviso de CORS):
  <https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
- Compatibilidad con la API de S3 (región `auto`, operaciones PutObject,
  HeadObject, DeleteObject y ListObjectsV2):
  <https://developers.cloudflare.com/r2/api/s3/api/>
- Tokens de API de R2 (permisos, límite por bucket, dirección de la API):
  <https://developers.cloudflare.com/r2/api/tokens/>
- Regla CORS (formato JSON, ejemplo para subidas con URL firmada, dónde se
  pone): <https://developers.cloudflare.com/r2/buckets/cors/>
- Buckets públicos (r2.dev solo para desarrollo, dominio propio, sin listado
  público): <https://developers.cloudflare.com/r2/buckets/public-buckets/>
- Precios y capa gratuita: <https://developers.cloudflare.com/r2/pricing/>
- Firma AWS Signature V4: los tests (`tests/storage.test.ts`) reproducen tres
  ejemplos publicados por AWS para S3. Los valores esperados los escribí de
  memoria, no los releí en la página de AWS en esta sesión; que el código los
  reproduzca exactamente es la comprobación.

No confirmado en la documentación: la forma exacta de la dirección r2.dev, que
el tamaño firmado se exija en la subida, y que el bucket pueda ir en la ruta
de la dirección de la API.
