/**
 * src/legal/contenido.ts
 *
 * Política de contenido generado por el usuario. BORRADOR pendiente de revisión
 * por los abogados del dueño.
 */

import { p, type DocumentoLegal } from './tipos';

export const CONTENIDO: DocumentoLegal = {
  id: 'contenido',
  titulo: 'Contenido generado por el usuario',
  version: '1.0',
  updatedAt: '2026-10-03',
  secciones: (d) => [
    {
      id: 'propiedad',
      titulo: '1. Propiedad de tu contenido',
      bloques: [
        p(
          'Tú conservas todos los derechos de propiedad sobre los textos, configuraciones y audios generados que crees utilizando Lalo Stream Suite.'
        ),
      ],
    },
    {
      id: 'licencia',
      titulo: '2. Licencia de operación',
      bloques: [
        p(
          `Al procesar, guardar o transmitir contenido a través de nuestra Plataforma, otorgas a ${d.operador} una licencia mundial, libre de regalías, sublicenciable y no exclusiva para alojar, almacenar, reproducir, modificar (únicamente para fines técnicos de formato) y transmitir dicho contenido con el fin exclusivo de operar y proveer el servicio.`
        ),
      ],
    },
    {
      id: 'garantia',
      titulo: '3. Garantía de derechos',
      bloques: [
        p(
          'Garantizas que posees los derechos, licencias y consentimientos necesarios para cualquier texto, guion o material que ingreses en el sistema para ser procesado, y asumes total responsabilidad por cualquier infracción de derechos de terceros derivada de tus entradas.'
        ),
      ],
    },
    {
      id: 'archivos-y-chat',
      titulo: '4. Archivos que subes y mensajes del chat',
      bloques: [
        p(
          'Esto incluye las imágenes, vídeos y sonidos que subas para tus capas. Los mensajes de tu chat que la Plataforma muestra o lee en voz alta son contenido de tus espectadores: eres responsable de moderarlos con las herramientas disponibles (palabras y usuarios bloqueados, aprobación manual, modos de lectura).'
        ),
      ],
    },
  ],
};
