/**
 * src/legal/terminos.ts
 *
 * Términos de servicio. BORRADOR pendiente de revisión por los abogados del
 * dueño: no es un texto definitivo ni asesoría legal. Las dudas abiertas están
 * en docs/legal/REVISION-ABOGADO.md.
 */

import { fraseContacto, p, type DocumentoLegal } from './tipos';

export const TERMINOS: DocumentoLegal = {
  id: 'terminos',
  titulo: 'Términos de servicio',
  version: '1.0',
  updatedAt: '2026-10-03',
  secciones: (d) => [
    {
      id: 'aceptacion',
      titulo: '1. Aceptación y naturaleza del servicio',
      bloques: [
        p(
          `Lalo Stream Suite (en adelante, la «Plataforma»), operada por ${d.operador}, proporciona herramientas de software como servicio orientadas a la creación, gestión y transmisión de contenido digital. Al registrarte o utilizar la Plataforma, aceptas vincularte a estos Términos y a las políticas que los acompañan: la de [voces e inteligencia artificial](legal:voces), la de [contenido generado por el usuario](legal:contenido) y el procedimiento de [notificación y retirada](legal:retirada).`
        ),
        p(
          'Cómo tratamos los datos personales se explica en [Privacidad y tratamiento de datos](legal:privacidad). Lo que cambia según vivas en Colombia, México o Estados Unidos está en el [Marco por país](legal:paises).'
        ),
      ],
    },
    {
      id: 'cuentas',
      titulo: '2. Cuentas y suscripciones',
      bloques: [
        p(
          'El acceso es por invitación. Cada cuenta se vincula a una cuenta de Twitch y tiene un plan con límites de uso. Algunas funciones de la Plataforma pueden estar sujetas a modelos de suscripción o pago por uso (tokens o créditos). Los pagos no son reembolsables salvo que la ley exija lo contrario. Nos reservamos el derecho de suspender o cancelar cuentas que incumplan estos Términos, sin derecho a reembolso.'
        ),
        p(
          d.edadMinima
            ? `La Plataforma es para personas de ${d.edadMinima} años o más. Para tener una cuenta también necesitas una cuenta de Twitch propia y en regla, es decir, activa y que cumpla las condiciones de Twitch.`
            : 'Para tener una cuenta necesitas una cuenta de Twitch propia y en regla, es decir, activa y que cumpla las condiciones de Twitch, incluida la edad que Twitch exige en tu país.'
        ),
      ],
    },
    {
      id: 'disponibilidad',
      titulo: '3. Disponibilidad del servicio',
      bloques: [
        p(
          'La Plataforma se proporciona «tal cual» y «según disponibilidad». No garantizamos un tiempo de actividad ininterrumpido y nos reservamos el derecho de modificar o descontinuar APIs de terceros o funciones específicas del motor en cualquier momento. La Plataforma depende de servicios de terceros como Twitch, el proveedor de voz y los de almacenamiento; sus cambios o caídas pueden afectarla.'
        ),
      ],
    },
    {
      id: 'responsabilidad',
      titulo: '4. Limitación de responsabilidad',
      bloques: [
        p(
          `En la máxima medida permitida por la ley aplicable, ${d.operador} no será responsable por daños indirectos, punitivos, incidentales o consecuentes que resulten del uso o la imposibilidad de uso de la Plataforma.`
        ),
      ],
    },
    {
      id: 'cambios',
      titulo: '5. Cambios en estos Términos',
      bloques: [
        p(
          'Si cambiamos estos Términos, te lo avisaremos al entrar y te pediremos aceptarlos de nuevo. La fecha y la versión figuran al inicio de cada documento.'
        ),
      ],
    },
    {
      id: 'ley',
      titulo: '6. Ley aplicable y contacto',
      bloques: [
        p(
          `Estos Términos se rigen por las leyes de la República de Colombia. Para cualquier consulta, ${fraseContacto(d)}.${
            d.direccionPostal ? ` Dirección para notificaciones: ${d.direccionPostal}.` : ''
          }`
        ),
        p(
          'Que estos Términos se rijan por la ley colombiana no te quita los derechos que las normas de protección al consumidor y de datos personales de tu país te reconocen de forma irrenunciable. El [Marco por país](legal:paises) resume los de Colombia, México y Estados Unidos.'
        ),
        p('El texto en español es el que rige. Si se publica una traducción, es solo de ayuda.'),
      ],
    },
  ],
};
