/**
 * src/legal/voces.ts
 *
 * Política de voces e inteligencia artificial. BORRADOR pendiente de revisión
 * por los abogados del dueño. La cláusula 3 nombra marcas de terceros porque así
 * está en el texto aprobado; la duda sobre si conviene está en
 * docs/legal/REVISION-ABOGADO.md.
 */

import { p, ul, type DocumentoLegal } from './tipos';

export const VOCES: DocumentoLegal = {
  id: 'voces',
  titulo: 'Voces e inteligencia artificial',
  version: '1.0',
  updatedAt: '2026-10-03',
  secciones: () => [
    {
      id: 'sintetica',
      titulo: '1. Naturaleza sintética',
      bloques: [
        p(
          'Las voces, audios y modelos generativos disponibles o creados a través de Lalo Stream Suite son generados mediante algoritmos de inteligencia artificial. No son grabaciones reales de individuos, actores de doblaje o figuras públicas.'
        ),
      ],
    },
    {
      id: 'referencia',
      titulo: '2. Voces de referencia',
      bloques: [
        p(
          'Las voces del catálogo son voces de referencia: están modeladas y adaptadas para evocar un estilo o un arquetipo reconocible, y buscan sonar auténticas dentro de ese estilo. No son la voz de ninguna persona ni de ningún personaje concreto, y no pretenden sustituir a sus intérpretes. Lalo Stream Suite respeta los derechos de las actrices y los actores de voz y de los titulares de las obras; por eso los nombres de las voces son genéricos y no hacen referencia a personajes ni a marcas.'
        ),
      ],
    },
    {
      id: 'afiliacion',
      titulo: '3. Ausencia de afiliación',
      bloques: [
        p(
          'Los modelos de voz inspirados en arquetipos de la cultura pop son parodias o referencias no oficiales. La Plataforma no está patrocinada, respaldada ni afiliada con Riot Games, Marvel, The Walt Disney Company, ni con ningún estudio de animación, desarrollador de videojuegos o actor de voz.'
        ),
      ],
    },
    {
      id: 'prohibidos',
      titulo: '4. Usos prohibidos',
      bloques: [
        p('Queda estrictamente prohibido utilizar el motor de generación de voz de Lalo Stream Suite para:'),
        ul(
          'Generar contenido difamatorio, discursos de odio o material discriminatorio.',
          'Cometer fraude, suplantación de identidad (phishing) o extorsión.',
          'Crear deepfakes no consentidos con fines de desinformación política o contenido explícito.',
          'Comercializar el audio generado atribuyéndolo falsamente a un individuo real o afirmando afiliación oficial con una marca registrada.'
        ),
      ],
    },
    {
      id: 'retirada',
      titulo: '5. Retirada de voces',
      bloques: [
        p(
          'Si eres titular de derechos y consideras que una voz te afecta, puedes pedir su retirada con el [procedimiento de notificación](legal:retirada). Podemos retirar o sustituir cualquier voz del catálogo sin previo aviso.'
        ),
      ],
    },
  ],
};
