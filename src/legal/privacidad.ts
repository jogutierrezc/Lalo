/**
 * src/legal/privacidad.ts
 *
 * Privacidad y tratamiento de datos. BORRADOR pendiente de revisión por los
 * abogados del dueño. Está escrito a partir de lo que la app guarda y envía de
 * verdad (supabase/migrations 0001 a 0008, server/ttsHandler.ts, server/storage,
 * src/lib/cloudConfig.ts y el almacenamiento del navegador). Si la app empieza a
 * recoger algo nuevo, hay que cambiar este texto y subir la versión.
 */

import { fraseContacto, h3, p, ul, type DocumentoLegal } from './tipos';

export const PRIVACIDAD: DocumentoLegal = {
  id: 'privacidad',
  titulo: 'Privacidad y tratamiento de datos',
  version: '1.0',
  updatedAt: '2026-10-03',
  secciones: (d) => [
    {
      id: 'responsable',
      titulo: '1. Quién responde por tus datos',
      bloques: [
        p(
          `El responsable del tratamiento es ${d.operador}, que opera Lalo Stream Suite. Para cualquier asunto sobre tus datos personales, ${fraseContacto(d)}.${
            d.direccionPostal ? ` Dirección: ${d.direccionPostal}.` : ''
          }`
        ),
      ],
    },
    {
      id: 'datos',
      titulo: '2. Qué datos tratamos',
      bloques: [
        h3('De quien tiene una cuenta (streamers)'),
        ul(
          '**Identidad de Twitch**: el identificador de tu cuenta de Twitch, tu nombre de canal, tu nombre visible y la dirección de tu foto de perfil. Twitch nos los entrega cuando entras con tu cuenta y se actualizan cada vez que vuelves a entrar.',
          '**Correo de tu cuenta de Twitch**, si Twitch lo entrega al iniciar sesión. Queda en el servicio de autenticación junto con tu sesión; no se muestra a otros streamers.',
          '**Datos de la cuenta en Lalo**: rol, estado (pendiente, activa o suspendida), plan, fecha de alta, fecha de la última visita, fecha en que terminaste la bienvenida, y la versión y la fecha en que aceptaste estos documentos.',
          '**Clave privada de tus fuentes de OBS**: va dentro de las direcciones que pegas en OBS. Quien la tenga puede ver tus capas, no cambiarlas. Puedes generar una nueva en Mi cuenta.',
          '**Configuración de los módulos**: lo que ajustas en voz del chat, alertas, metas, ruleta, batallas, recompensas, bot y chat. Incluye las listas de palabras y de usuarios bloqueados que escribas, que pueden contener nombres de usuario de tus espectadores.',
          '**Archivos que subes**: imágenes, vídeos y sonidos, con su nombre, tipo, tamaño y fecha.',
          '**Cuenta de Riot Games**, solo si la vinculas en Integraciones para usar «Alertas de juego»: el Riot ID que escribes (nombre y etiqueta), el servidor que eliges y el identificador que Riot asigna a esa cuenta. No te pedimos tu contraseña de Riot ni iniciamos sesión en tu nombre. Con esos datos nuestro servidor consulta a Riot tu rango, si estás en partida, el resultado de tu última partida y tu maestría de campeones, para mostrar las alertas en tus capas; de cada partida solo leemos tus propios datos, no los de las demás personas que jugaron. Esas consultas no se guardan en nuestra base de datos: pasan por la memoria del servidor durante menos de un minuto y por el navegador de tu fuente de OBS.',
          '**Códigos**: qué código de invitación canjeaste y cuándo. De los códigos de recuperación se guarda una huella, no el código.'
        ),
        h3('De quien administra la Plataforma'),
        ul(
          'El correo con el que entra. La contraseña la custodia el servicio de autenticación; Lalo no la ve ni la guarda en sus tablas.'
        ),
        h3('De los espectadores del chat'),
        ul(
          'Los **nombres de usuario y los mensajes** que tus espectadores escriben en el chat público de Twitch, y los avisos públicos del canal (seguidores, suscripciones, bits y raids). Se procesan en tu navegador o en OBS para mostrarlos en pantalla o leerlos en voz alta.',
          'Para leer un mensaje en voz alta, el texto que se va a leer (que puede incluir el nombre de quien escribe) se envía a través de nuestro servidor al proveedor de voz, que devuelve el audio.',
          'No guardamos un historial de los mensajes del chat en nuestra base de datos.'
        ),
        h3('En tu navegador'),
        ul(
          'La app guarda en el almacenamiento local de tu navegador tu sesión, la configuración de los módulos, el tema del panel, el avance de la bienvenida y de las guías, y listas temporales de moderación (por ejemplo, usuarios silenciados durante el directo). Esos datos no salen de tu navegador salvo la configuración, que se sincroniza con tu cuenta.',
          'No usamos cookies de publicidad ni herramientas de analítica o de seguimiento.'
        ),
        h3('Datos técnicos'),
        ul(
          'Los proveedores que alojan la app, la base de datos y los archivos pueden registrar datos técnicos de cada petición, como la dirección IP, la fecha y el navegador, para operar y proteger sus servicios.'
        ),
      ],
    },
    {
      id: 'finalidades',
      titulo: '3. Para qué los usamos',
      bloques: [
        ul(
          'Identificarte y darte acceso a tu panel, y saber que la cuenta es tuya sin pedirte una contraseña nueva.',
          'Guardar tu configuración y tus archivos y entregarlos a tus fuentes de OBS.',
          'Mostrar en tus capas y leer en voz alta lo que tú decidas de tu chat.',
          'Aplicar los límites de tu plan y administrar las invitaciones y la recuperación de cuentas.',
          'Dejar constancia de que aceptaste estos documentos y de qué versión.',
          'Atender tus solicitudes, las notificaciones legales y la seguridad del servicio.'
        ),
        p('No usamos tus datos ni los de tus espectadores para publicidad, ni los vendemos.'),
      ],
    },
    {
      id: 'no-recogemos',
      titulo: '4. Qué no recogemos',
      bloques: [
        ul(
          'Tu contraseña de Twitch: la entrada ocurre en Twitch.',
          'Datos de pago: hoy la app no procesa pagos.',
          'Datos sensibles (salud, creencias, biometría y similares). Te pedimos no escribirlos ni subirlos.',
          'Perfiles de tus espectadores: no creamos cuentas ni fichas de ellos.',
          'Permisos de Twitch para moderar en tu nombre, cambiar los ajustes de tu directo o ver tus ingresos.'
        ),
      ],
    },
    {
      id: 'proveedores',
      titulo: '5. Con quién los compartimos',
      bloques: [
        p('Para funcionar, la Plataforma se apoya en estos proveedores, que tratan datos por nuestra cuenta o como servicios independientes:'),
        ul(
          '**Supabase**: inicio de sesión y base de datos (cuentas, configuración, registro de archivos, códigos y aceptaciones).',
          '**Cloudflare R2**: almacenamiento de los archivos que subes. Se sirven por una dirección pública para que OBS pueda cargarlos: quien conozca la dirección de un archivo puede verlo.',
          '**Vercel**: alojamiento de la app y de sus funciones de servidor.',
          '**Twitch**: inicio de sesión y chat. Twitch trata tus datos y los de tus espectadores según sus propias condiciones.',
          '**Fish Audio**: síntesis de voz. Recibe el texto que se va a leer y el identificador de la voz elegida.',
          '**Riot Games**: si vinculas tu cuenta de Riot, nuestro servidor le envía tu Riot ID y el identificador de tu cuenta para consultar tus datos de juego. Riot trata esos datos según sus propias condiciones. Lalo Stream Suite no está respaldada por Riot Games.',
          '**Google Fonts**: sirve las tipografías de la app; al cargarlas, tu navegador se conecta con sus servidores.'
        ),
        p(
          'Estos proveedores pueden tratar los datos en servidores situados fuera de tu país. También podemos entregar datos cuando una autoridad competente lo exija conforme a la ley.'
        ),
      ],
    },
    {
      id: 'chat',
      titulo: '6. Los mensajes del chat',
      bloques: [
        p(
          'Los mensajes del chat son contenido público de Twitch. La Plataforma los muestra o los lee porque el streamer así lo configura, y es el streamer quien decide qué se muestra, qué se lee y a quién se bloquea. Si eres espectador y no quieres que tus mensajes se muestren o se lean en un canal, puedes pedírselo al streamer o escribirnos.'
        ),
      ],
    },
    {
      id: 'conservacion',
      titulo: '7. Cuánto tiempo los conservamos',
      bloques: [
        ul(
          'Los datos de tu cuenta, tu configuración y tus archivos se conservan mientras tu cuenta exista.',
          'Un archivo que borras en Mi cuenta se elimina del almacenamiento en ese momento.',
          'Los datos de tu cuenta de Riot (Riot ID, servidor e identificador) se borran de nuestra base de datos cuando pulsas «Desvincular» en Integraciones.',
          'Si pides cerrar tu cuenta, borramos tus datos, salvo lo que debamos conservar por obligación legal o para atender reclamaciones, como el registro de aceptación de estos documentos.',
          'El texto que se envía para generar voz no se guarda en nuestra base de datos. Los proveedores pueden conservar registros técnicos durante los plazos que fijen sus propias políticas.'
        ),
      ],
    },
    {
      id: 'derechos',
      titulo: '8. Tus derechos y cómo ejercerlos',
      bloques: [
        p(
          'Puedes pedir conocer los datos que tenemos sobre ti, actualizarlos, corregirlos o suprimirlos, oponerte a un tratamiento, retirar tu autorización y pedir prueba de ella. Ejercer estos derechos no tiene costo.'
        ),
        p(
          `Para ejercerlos, ${fraseContacto(
            d
          )} desde el correo de tu cuenta o indicando tu canal de Twitch, y cuéntanos qué necesitas. Podemos pedirte que confirmes que la cuenta es tuya. También puedes hacer parte de esto tú mismo: borrar archivos y generar una clave nueva en Mi cuenta, y retirar el acceso de Lalo desde las conexiones de tu cuenta de Twitch.`
        ),
        p(
          'Los plazos de respuesta y la autoridad ante la que puedes reclamar dependen de tu país. Están en el [Marco por país](legal:paises).'
        ),
      ],
    },
    {
      id: 'menores',
      titulo: '9. Menores de edad',
      bloques: [
        p(
          d.edadMinima
            ? `La Plataforma es para personas de ${d.edadMinima} años o más y no está dirigida a menores de edad. No recogemos a sabiendas datos de menores para crear cuentas. Si crees que un menor abrió una cuenta, escríbenos y la cerraremos.`
            : 'La Plataforma no está dirigida a niñas ni niños. Para tener una cuenta hace falta una cuenta de Twitch, con la edad que Twitch exige. Si crees que un menor abrió una cuenta sin autorización, escríbenos y la cerraremos.'
        ),
      ],
    },
    {
      id: 'seguridad',
      titulo: '10. Seguridad',
      bloques: [
        p(
          'Cada cuenta solo puede leer y cambiar lo suyo, y los cambios de rol, estado y plan solo los hace un administrador. Ningún sistema es infalible: si detectamos un incidente que afecte a tus datos, te avisaremos y avisaremos a la autoridad cuando la ley lo exija.'
        ),
      ],
    },
    {
      id: 'cambios',
      titulo: '11. Cambios en este documento',
      bloques: [
        p(
          'Si cambiamos este documento subiremos su versión y su fecha, y te lo avisaremos al entrar, igual que con los [Términos de servicio](legal:terminos/cambios).'
        ),
      ],
    },
  ],
};
