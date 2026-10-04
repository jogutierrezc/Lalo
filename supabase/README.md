# Supabase — puesta en marcha de Lalo Stream Suite

Guía para el dueño del proyecto (admin). Deja listo el backend: base de datos,
inicio de sesión con Twitch, bucket de medios y variables de entorno.

> **Estado:** las tres migraciones (`0001_lalo_init.sql`,
> `0002_widget_version.sql`, `0003_admin_access.sql`, `0004_invite_requires_twitch.sql`) **no se han ejecutado
> todavía contra un proyecto real**. Hazlo primero en un proyecto de pruebas y
> revisa los puntos marcados con `REVISAR` dentro de cada archivo. La entrada
> del administrador con correo y clave tampoco se ha probado con un inicio de
> sesión real.

Mientras falten las variables del paso 6, la app muestra en el menú la página
**Nube** (`#nube`), que resume lo que falta. Esa página desaparece al
configurarlas.

## 1. Crear el proyecto

1. Entra en <https://supabase.com/dashboard> y crea un proyecto nuevo (plan Free).
2. Guarda la contraseña de la base de datos en un gestor de contraseñas.
3. En la configuración del proyecto (sección de API / claves) copia:
   - **Project URL** → `VITE_SUPABASE_URL`
   - clave pública **anon** → `VITE_SUPABASE_ANON_KEY`
   - clave **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (secreta, solo servidor)

   Los nombres exactos de los menús del panel cambian con el tiempo; no los he
   comprobado en esta sesión.

## 2. Aplicación de Twitch

1. En <https://dev.twitch.tv/console> pulsa **Register Your Application**.
2. En **OAuth Redirect URL** pon exactamente (con la referencia de tu proyecto):

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

   La URL de retorno es la de **Supabase**, no la de la app en Vercel.
3. Elige una categoría, completa el CAPTCHA y crea la aplicación.
4. Pulsa **Manage**, copia el **Client ID** y genera un **Client Secret** con
   **New Secret**.

Fuente: <https://supabase.com/docs/guides/auth/social-login/auth-twitch>

## 3. Activar Twitch en Supabase

1. Panel de Supabase → **Authentication** → **Providers** → **Twitch**.
2. Activa **Twitch Enabled**.
3. Pega el **Twitch Client ID** y el **Twitch Client Secret** y guarda.

El Client Secret solo vive ahí. No va en el repositorio, ni en `.env`, ni en Vercel.

4. En **Authentication → URL Configuration** (nombre del menú sin comprobar en
   esta sesión) pon como *Site URL* la URL de producción y añade a *Redirect
   URLs* las direcciones a las que la app puede volver tras el login:
   - `http://localhost:3000` (desarrollo; el puerto está en `vite.config.ts`)
   - `https://<tu-app>.vercel.app`

### Proveedor Email (para el administrador)

El administrador no entra con Twitch: entra con **correo y clave de
administración**, que es un usuario de Supabase con contraseña.

1. Panel → **Authentication** → **Providers** → **Email**: tiene que estar
   **activado**. Si se desactiva, la pantalla «Soy administrador» responde que
   la entrada con correo está desactivada.
2. Deja activada la confirmación de correo (**Confirm email**). Así, si alguien
   intentara registrarse con correo por su cuenta, no podría entrar sin
   confirmar, y aun entrando solo tendría un perfil `pending` sin acceso.

**Sobre cerrar el registro público.** Supabase tiene el interruptor **Allow new
users to sign up**: si se desactiva, solo pueden entrar los usuarios que ya
existen (fuente: <https://supabase.com/docs/guides/auth/general-configuration>,
consultada el 2026-10-03; la página no cargó completa en esta sesión, así que
el nombre y el efecto salen del resumen que el buscador dio de esa página, no
de una lectura directa. En qué menú del panel está no lo pude comprobar).
**No lo apagues sin probar antes:** es un ajuste general, no solo del correo.
Todo indica que también impide que un streamer nuevo se registre con Twitch,
pero no pude confirmarlo en la documentación oficial. No encontré un
interruptor oficial que cierre solo el registro por correo dejando abierto el
de Twitch.

Qué pasa si lo dejas abierto: la app no ofrece registro con correo, pero
alguien con conocimientos podría crearse un usuario con correo usando la clave
pública. Ese usuario queda `pending`: no ve nada y no es administrador. Solo
con un código de afiliado válido podría activarse como streamer sin Twitch
(la app no se lo ofrece; la base de datos hoy no lo impide).

## 4. Ejecutar las migraciones

Hazlo **antes** del primer inicio de sesión. Son tres archivos y van **en
orden**:

1. `supabase/migrations/0001_lalo_init.sql`
2. `supabase/migrations/0002_widget_version.sql`
3. `supabase/migrations/0003_admin_access.sql`
4. `supabase/migrations/0004_invite_requires_twitch.sql`
5. `supabase/migrations/0005_r2_storage.sql` (archivos en Cloudflare R2; ver `CLOUDFLARE-R2.md`)

**Opción A — SQL Editor (la más simple)**

1. Panel → **SQL Editor** → nueva consulta.
2. Pega el contenido completo del primer archivo y ejecuta.
3. Repite con el segundo y el tercero, cada uno en una consulta nueva.
   Si algo falla, copia el error tal cual: indica la sentencia exacta.

**Opción B — CLI de Supabase** (comandos escritos de memoria, sin comprobar en
esta sesión; consulta <https://supabase.com/docs/guides/cli>)

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Comprobaciones después de ejecutar:

- **Table Editor**: existen `plans`, `profiles`, `invite_codes`,
  `invite_redemptions`, `recovery_codes`, `configs`, `media_files`, todas con RLS.
- **Storage**: existe el bucket `media`, público, con límite de 15 MB y la lista
  de tipos MIME. Si el `insert into storage.buckets` falló, créalo a mano con
  esos valores y vuelve a ejecutar solo la parte de políticas (sección 6).
- **Storage → Settings**: el límite global de tamaño de archivo debe ser igual o
  mayor que el del bucket.

## 5. Convertirte en admin

El administrador entra con correo y clave de administración. No necesita
Twitch ni código de afiliado.

1. Panel → **Authentication** → **Users** → **Add user** → crear usuario nuevo.
   Escribe tu correo y una clave larga (esa es la «clave de administración»;
   guárdala en un gestor de contraseñas, no en el repositorio). Marca la
   confirmación automática (**Auto Confirm User**) para que no dependa de un
   correo de confirmación. Los nombres de estos botones los escribo de memoria;
   no los comprobé en esta sesión.
2. En el **SQL Editor** dale el rol (requiere la migración 0003):

   ```sql
   select public.promote_admin_by_email('tu@correo.com');
   ```

   Debe responder «Listo: ... es administrador y su cuenta está activa».
   Esta función solo se puede ejecutar desde el SQL Editor: la app y la API no
   tienen permiso para llamarla.

   Si la función diera un error de permisos, el equivalente a mano es:

   ```sql
   update public.profiles
      set role = 'admin', status = 'active',
          plan_id = coalesce(plan_id, (select id from public.plans where is_default limit 1))
    where id = (select id from auth.users where lower(email) = lower('tu@correo.com'));
   ```

3. Abre la app, pulsa **Soy administrador** en la pantalla de acceso y entra
   con ese correo y esa clave. Se abre la consola de administración: el
   administrador no ve los módulos de streamer.

   Si entras antes de hacer el paso 2, la app te dice que la cuenta todavía no
   tiene el rol y te muestra la misma línea de SQL. Después de ejecutarla, pulsa
   «Ya lo hice, comprobar de nuevo».

Para cambiar la clave: Authentication → Users → tu usuario. La app no tiene
pantalla de «olvidé mi clave» para el administrador.

### Alternativa: un administrador que entra con Twitch

1. Inicia sesión una vez con Twitch desde la pantalla de acceso.
2. En el **SQL Editor** revisa qué datos guardó Twitch:

   ```sql
   select id, raw_user_meta_data from auth.users;
   select id, twitch_user_id, twitch_login, display_name, status, role from public.profiles;
   ```

   Si `twitch_login` o `display_name` salieron vacíos, las claves de
   `raw_user_meta_data` no son las esperadas: hay que corregir
   `handle_new_user` y `touch_profile` en la migración.
3. Promueve tu perfil (cambia el login):

   ```sql
   update public.profiles
      set role = 'admin', status = 'active', plan_id = 'plus'
    where twitch_login = 'tu_login_de_twitch';
   ```

Solo se puede hacer desde el SQL Editor: por la API nadie puede cambiar su
propio rol, estado o plan. Los demás admins se nombran con `admin_set_profile`.

## 6. Variables de entorno

**Local** — archivo `.env` o `.env.local` en la raíz (ver `.env.example`).
Después de cambiarlo hay que reiniciar `npm run dev`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<clave anon>
VITE_TWITCH_CLIENT_ID=<client id de Twitch>
SUPABASE_SERVICE_ROLE_KEY=<clave service_role>
```

**Vercel** — Project → Settings → Environment Variables: las mismas cuatro.
`SUPABASE_SERVICE_ROLE_KEY` nunca debe llevar el prefijo `VITE_` (todo lo que
empieza por `VITE_` acaba en el JavaScript público). La usan las funciones de
`api/storage` y `api/media` para comprobar quién llama. Las variables del
almacenamiento de archivos (R2) están en `supabase/CLOUDFLARE-R2.md`.

Sin `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` la app funciona igual que
antes, solo con almacenamiento local (`isCloudEnabled` es `false`).

## 7. Cómo funciona (resumen)

- **Registro con invitación:** el admin crea códigos con `admin_create_invite`.
  El streamer entra con Twitch (perfil `pending`) y canjea el código con
  `redeem_invite`, que lo deja `active` con el plan del código.
- **Compartir un código:** en la consola, Códigos de invitación, «Copiar invitación»
  copia un mensaje con el enlace `https://<tu-app>/?codigo=LALO-XXXX`, el código
  y el plan. «Enviar por correo» abre el programa de correo del administrador
  con ese mensaje escrito (enlace `mailto:`); **la app no envía correos** ni
  guarda direcciones. El enlace abre la pantalla de acceso con el código ya
  escrito. El parámetro es `codigo` porque `code` lo usa Supabase al volver de
  Twitch. «Para quién» se guarda en la columna `note` y solo lo ve el admin.
- **Widget de OBS sin login:** cada perfil tiene una `widget_key`. La función
  `widget_bundle(p_key)` devuelve su configuración y su lista de medios.
  `rotate_widget_key` la cambia si se filtra. Todo lo guardado en `configs` es
  legible con esa llave: **no guardar ahí tokens ni contraseñas**.
- **Recuperación:** `admin_create_recovery_code(perfil)` da un código de un solo
  uso (48 h). El streamer entra con su nuevo Twitch y lo canjea con
  `redeem_recovery_code`; hereda configuración, medios, plan y llave de widget.
  El rol de admin no se transfiere.
- **Planes:** los valores de `plans` (40 MB / 120 MB, etc.) son **provisionales**.
  Ajústalos en la tabla `plans`.
- **Cuotas:** el detalle de qué se aplica en el servidor está al final del
  archivo de migración.
- **SVG:** un SVG puede llevar scripts. Mostrar los SVG subidos solo con
  `<img>`. Si no hacen falta, quitar `image/svg+xml` del bucket.

## 8. Plan gratuito: cosas que verificar

Cifras leídas el 2026-10-03 en la documentación oficial; pueden cambiar.

| Dato (plan Free) | Valor | Fuente |
| --- | --- | --- |
| Tamaño de base de datos | 500 MB por proyecto | [Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase) |
| Almacenamiento de archivos | 1 GB | misma página |
| Egress (tráfico de salida) | 5 GB | misma página |
| Usuarios activos al mes | 50 000 | misma página |
| Proyectos gratuitos | 2 | misma página |
| Tamaño máximo por archivo | 50 MB | [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits) |

Pendiente de comprobar por tu cuenta (no lo verifiqué en una página oficial):

- **Pausa por inactividad** de los proyectos gratuitos y cada cuánto ocurre.
  Si el proyecto se pausa, los widgets de OBS dejan de cargar la configuración.
- **Copias de seguridad:** qué incluye el plan gratuito.
- **Egress:** el bucket es público y OBS descarga los medios en cada carga del
  widget. Es el límite con más probabilidad de agotarse, y no hay tope por
  cuenta. Vigílalo en el panel de uso.
- **Capacidad comprometida:** la suma de `storage_limit_bytes` de los perfiles
  activos (campo `storage_committed_bytes` de `admin_overview`) no debería
  superar el almacenamiento del proyecto.
- **Archivos huérfanos:** borrar un usuario no borra sus archivos de Storage;
  hay que eliminarlos desde el panel o con la API.
