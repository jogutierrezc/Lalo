/**
 * src/legal/paises.ts
 *
 * Marco por país: Colombia, México y Estados Unidos. BORRADOR pendiente de
 * revisión por abogados de cada país. No es asesoría legal.
 *
 * Solo se afirma lo que se comprobó en una fuente oficial o claramente fiable;
 * la lista de fuentes y lo que quedó escrito en general por no poder
 * comprobarlo está en docs/legal/REVISION-ABOGADO.md. Antes de cambiar una
 * cifra, un plazo o una autoridad, comprobarlo otra vez.
 */

import { fraseContacto, h3, p, ul, type DocumentoLegal } from './tipos';

export const PAISES: DocumentoLegal = {
  id: 'paises',
  titulo: 'Marco por país',
  version: '1.0',
  updatedAt: '2026-10-03',
  secciones: (d) => {
    const contacto = `Contacto: ${fraseContacto(d)}.${d.direccionPostal ? ` Dirección: ${d.direccionPostal}.` : ''}`;
    const edad = d.edadMinima ? `La Plataforma es para personas de ${d.edadMinima} años o más. ` : '';

    return [
      {
        id: 'entrada',
        titulo: null,
        bloques: [
          p(
            `Lalo Stream Suite la opera ${d.operador} desde Colombia y se puede usar desde Colombia, México y Estados Unidos. Este documento resume, para cada uno de esos países, qué ley rige el contrato, qué derechos conservas siempre y a quién acudir. Es un resumen para orientarte; no sustituye a la ley ni es asesoría legal.`
          ),
          p(
            'En los tres países vale lo mismo: los [Términos de servicio](legal:terminos) se rigen por la ley colombiana, pero eso no te quita los derechos de consumidor y de protección de datos que la ley de tu país declara irrenunciables.'
          ),
        ],
      },
      {
        id: 'colombia',
        titulo: 'Colombia',
        bloques: [
          h3('Ley del contrato'),
          p('Los Términos se rigen por las leyes de la República de Colombia.'),
          h3('Datos personales'),
          p(
            'El tratamiento de datos personales se rige por la Ley 1581 de 2012 y sus normas reglamentarias. La autoridad es la Superintendencia de Industria y Comercio, a través de su Delegatura para la Protección de Datos Personales. Como titular tienes derecho a:'
          ),
          ul(
            'Conocer, actualizar y rectificar tus datos.',
            'Pedir prueba de la autorización que diste.',
            'Saber, si lo pides, qué uso se ha dado a tus datos.',
            'Presentar quejas ante la Superintendencia de Industria y Comercio.',
            'Revocar la autorización y pedir que se supriman tus datos.',
            'Acceder gratis a los datos que se hayan tratado.'
          ),
          p(
            'Las consultas se responden en un máximo de diez días hábiles y los reclamos en un máximo de quince días hábiles, con las prórrogas que permite esa ley. Antes de acudir a la Superintendencia debes haber presentado la consulta o el reclamo ante nosotros.'
          ),
          h3('Consumo'),
          p(
            'El Estatuto del Consumidor (Ley 1480 de 2011) reconoce el derecho de retracto en las ventas a distancia, entre ellas las de comercio electrónico: cinco días hábiles para deshacer la compra, con devolución del dinero. La misma ley fija excepciones; una de ellas son los servicios cuya prestación ya comenzó con tu acuerdo. Hoy la Plataforma no cobra. Si llega a cobrar, la frase de los Términos sobre pagos no reembolsables se aplica sin perjuicio de este derecho.'
          ),
          h3('Derecho de autor'),
          p(
            'Se rige por la Ley 23 de 1982 y la Decisión Andina 351 de 1993. Para avisarnos de una infracción, usa la [Notificación y retirada](legal:retirada/paises).'
          ),
          h3('Contacto'),
          p(contacto),
        ],
      },
      {
        id: 'mexico',
        titulo: 'México',
        bloques: [
          h3('Ley del contrato'),
          p(
            'Los Términos se rigen por la ley colombiana. Si resides en México conservas los derechos que las leyes mexicanas de protección al consumidor y de datos personales declaran irrenunciables.'
          ),
          h3('Datos personales'),
          p(
            'Rige la Ley Federal de Protección de Datos Personales en Posesión de los Particulares publicada en el Diario Oficial de la Federación el 20 de marzo de 2025. La autoridad es la Secretaría Anticorrupción y Buen Gobierno. El documento de [Privacidad](legal:privacidad) busca cumplir la función de aviso de privacidad: dice quién es el responsable, qué datos se tratan, para qué y cómo ejercer tus derechos.'
          ),
          p(
            `Tienes los derechos de acceso, rectificación, cancelación y oposición (derechos ARCO). Para ejercerlos, ${fraseContacto(
              d
            )}. Te comunicaremos nuestra decisión en un máximo de veinte días y, si procede, la haremos efectiva dentro de los quince días siguientes, como dispone esa ley.`
          ),
          h3('Consumo'),
          p(
            'La Ley Federal de Protección al Consumidor tiene reglas para las operaciones hechas por medios electrónicos, entre ellas el uso confidencial de tu información, que el proveedor te dé sus datos de contacto y que conozcas las condiciones y los costos antes de aceptar. La autoridad es la Procuraduría Federal del Consumidor (PROFECO). Hoy la Plataforma no cobra.'
          ),
          h3('Derecho de autor'),
          p(
            'La Ley Federal del Derecho de Autor prevé un mecanismo de aviso y retirada para los proveedores de servicios en línea. Está en [Notificación y retirada](legal:retirada/paises).'
          ),
          h3('Contacto'),
          p(contacto),
        ],
      },
      {
        id: 'estados-unidos',
        titulo: 'Estados Unidos',
        bloques: [
          h3('Ley del contrato'),
          p(
            'Los Términos se rigen por la ley colombiana. Si resides en Estados Unidos conservas los derechos de consumidor y de privacidad que la ley federal o la de tu estado no permiten renunciar.'
          ),
          h3('Privacidad'),
          p(
            'Estados Unidos no tiene una ley federal general de privacidad para empresas privadas; hay leyes por sector y leyes de los estados. La de California (CCPA) se aplica a empresas con ánimo de lucro que superan alguno de estos umbrales: ingresos brutos anuales de 26,625 millones de dólares o más, comprar, vender o compartir datos personales de 100.000 o más residentes u hogares de California, o que la mitad o más de sus ingresos anuales venga de vender o compartir esos datos. Que una ley estatal se nos aplique depende del tamaño y de la actividad del operador y está por confirmar. En cualquier caso, los derechos del documento de [Privacidad](legal:privacidad/derechos) valen para ti: no vendemos datos personales.'
          ),
          h3('Menores'),
          p(
            `${edad}No está dirigida a menores de 13 años y no buscamos recoger datos personales de ellos, que es lo que regula la ley federal de privacidad infantil (COPPA). Para tener una cuenta hace falta además una cuenta de Twitch en regla, y las condiciones de Twitch tampoco admiten a menores de 13 años.`
          ),
          h3('Derecho de autor'),
          p(
            d.agenteDmcaRegistrado
              ? 'Tenemos un agente designado inscrito ante la U.S. Copyright Office para recibir notificaciones conforme a la DMCA. Los elementos de la notificación y de la contranotificación están en [Notificación y retirada](legal:retirada/paises).'
              : 'Todavía no tenemos un agente designado inscrito ante la U.S. Copyright Office, así que hoy no invocamos la protección de la sección 512 de la DMCA. Atendemos igualmente las notificaciones; sus elementos y los de la contranotificación están en [Notificación y retirada](legal:retirada/paises).'
          ),
          h3('Voz e imagen'),
          p(
            'Varios estados protegen el nombre, la imagen y la voz de las personas frente a usos comerciales no autorizados. Por ejemplo, la ley ELVIS de Tennessee, en vigor desde el 1 de julio de 2024, protege la voz de una persona también frente a imitaciones hechas con inteligencia artificial. Por eso la política de [Voces e inteligencia artificial](legal:voces/prohibidos) prohíbe atribuir un audio a una persona real, y cualquier titular puede pedir la [retirada de una voz](legal:voces/retirada).'
          ),
          h3('Contacto'),
          p(contacto),
        ],
      },
      {
        id: 'idiomas',
        titulo: 'Idiomas',
        bloques: [
          p(
            'El texto en español es el que rige. Todavía no hay versión en inglés de estos documentos; cuando la haya, será una ayuda de lectura y, si hay diferencias, valdrá el texto en español.'
          ),
        ],
      },
    ];
  },
};
