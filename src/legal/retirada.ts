/**
 * src/legal/retirada.ts
 *
 * Notificación y retirada. BORRADOR pendiente de revisión por los abogados del
 * dueño. El procedimiento general vale para cualquier país; debajo hay un
 * apartado corto para Colombia, México y Estados Unidos. Las fuentes de lo que
 * se dice de cada ley están en docs/legal/REVISION-ABOGADO.md.
 */

import { fraseContacto, h3, ol, p, ul, type DocumentoLegal } from './tipos';

export const RETIRADA: DocumentoLegal = {
  id: 'retirada',
  titulo: 'Notificación y retirada',
  version: '1.0',
  updatedAt: '2026-10-03',
  secciones: (d) => [
    {
      id: 'entrada',
      titulo: null,
      bloques: [
        p(
          'Respetamos la propiedad intelectual de terceros y exigimos a nuestros usuarios que hagan lo mismo. Si crees que un modelo, texto o contenido alojado públicamente en Lalo Stream Suite infringe tus derechos de autor, derechos conexos o derechos de imagen, puedes enviar una notificación.'
        ),
      ],
    },
    {
      id: 'como',
      titulo: 'Cómo realizar una notificación',
      bloques: [
        p(
          d.correoLegal
            ? `Envía un correo electrónico a [${d.correoLegal}](mailto:${d.correoLegal}) con la siguiente información:`
            : 'Envía tu notificación por el canal de contacto que se publicará en esta página antes de abrir el servicio, con la siguiente información:'
        ),
        ol(
          'Una firma electrónica o física de la persona autorizada para actuar en nombre del titular de los derechos.',
          'Una descripción detallada de la obra protegida o del derecho que se alega infringido.',
          'La ubicación exacta dentro de Lalo Stream Suite donde se encuentra el material (nombre de la voz, canal o identificador de usuario).',
          'Tus datos de contacto: dirección, teléfono y correo electrónico.',
          'Una declaración de buena fe de que el uso cuestionado no está autorizado por el titular, su agente o la ley.',
          'Una declaración de que la información de la notificación es veraz y exacta, y de que eres el titular del derecho o actúas con su autorización.'
        ),
        p(
          'Una vez recibida una notificación válida, procederemos a investigar y, de ser procedente, deshabilitaremos o eliminaremos el acceso al material infractor de nuestros servidores, notificando al usuario responsable.'
        ),
      ],
    },
    {
      id: 'respuesta',
      titulo: 'Si retiramos algo tuyo',
      bloques: [
        p(
          `Si retiramos o deshabilitamos un contenido de tu cuenta y crees que fue un error, ${fraseContacto(
            d,
            'escribe'
          )} explicando por qué tienes derecho a usarlo. Lo revisaremos y te responderemos. Las cuentas que infrinjan derechos de terceros de forma repetida pueden suspenderse o cancelarse, como prevén los [Términos de servicio](legal:terminos/cuentas).`
        ),
      ],
    },
    {
      id: 'paises',
      titulo: 'Particularidades por país',
      bloques: [
        p(
          'El procedimiento anterior es el mismo vivas donde vivas. Estos apartados añaden lo propio de cada país. Son un resumen, no asesoría legal.'
        ),
        h3('Colombia'),
        p(
          'El derecho de autor y los derechos conexos se rigen por la Ley 23 de 1982 y por la Decisión Andina 351 de 1993. Las notificaciones sobre contenidos en Lalo Stream Suite se tramitan con el procedimiento general de esta página. Enviarnos una notificación no te impide acudir a las autoridades o a los jueces colombianos.'
        ),
        h3('México'),
        p(
          'La Ley Federal del Derecho de Autor prevé, desde su reforma de 2020, un mecanismo de aviso y retirada para los proveedores de servicios en línea (artículo 114 Octies). Si resides en México puedes usar el procedimiento general de esta página como aviso. La persona cuyo contenido se retire puede responder con un contraaviso por el mismo medio.'
        ),
        h3('Estados Unidos'),
        p(
          d.agenteDmcaRegistrado
            ? `${d.operador} tiene un agente designado para recibir notificaciones conforme a la sección 512 de la Digital Millennium Copyright Act (DMCA), inscrito en el directorio de la U.S. Copyright Office. Sus datos de contacto son los de esta página.`
            : `${d.operador} todavía no tiene un agente designado inscrito en el directorio de la U.S. Copyright Office, así que hoy no invoca la protección de la sección 512 de la Digital Millennium Copyright Act (DMCA). Aun así, atendemos las notificaciones que traigan los elementos que esa ley pide.`
        ),
        p('Una notificación conforme a la sección 512(c)(3) contiene:'),
        ul(
          'La firma física o electrónica de una persona autorizada para actuar en nombre del titular del derecho exclusivo que se dice infringido.',
          'La identificación de la obra protegida que se dice infringida.',
          'La identificación del material que se dice infractor y datos suficientes para que podamos localizarlo.',
          'Datos suficientes para contactar a quien notifica: dirección, teléfono y correo electrónico.',
          'Una declaración de que quien notifica cree de buena fe que el uso no está autorizado por el titular, su agente o la ley.',
          'Una declaración de que la información de la notificación es exacta y, bajo pena de perjurio, de que quien notifica está autorizado para actuar en nombre del titular.'
        ),
        p('Una contranotificación conforme a la sección 512(g)(3) contiene:'),
        ul(
          'La firma física o electrónica de la persona usuaria.',
          'La identificación del material retirado y del lugar donde estaba antes de retirarse.',
          'Una declaración, bajo pena de perjurio, de que la persona usuaria cree de buena fe que el material se retiró por error o por una identificación equivocada.',
          'Su nombre, dirección y teléfono, y una declaración de que acepta la jurisdicción del tribunal federal de distrito que corresponda a su dirección (o, si vive fuera de Estados Unidos, de cualquier distrito judicial en el que se pueda encontrar al proveedor) y de que aceptará la notificación judicial de quien envió la notificación original.'
        ),
        p(
          'La fórmula «bajo pena de perjurio» solo se aplica a las notificaciones y contranotificaciones presentadas conforme a esa ley de Estados Unidos.'
        ),
      ],
    },
  ],
};
