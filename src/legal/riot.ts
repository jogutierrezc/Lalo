/**
 * src/legal/riot.ts
 *
 * Política de uso de la integración con Riot Games. BORRADOR pendiente de
 * revisión por los abogados del dueño.
 *
 * No forma parte de la aceptación general: solo la acepta quien vincula una
 * cuenta de Riot en «Integraciones», en ese momento. Resume lo que las
 * políticas de Riot para productos de terceros piden a Lalo y a quien lo usa, y
 * enlaza a los textos de Riot, que son los que mandan. No los reproduce.
 */

import { RIOT_POLICY_UPDATED_AT, RIOT_POLICY_VERSION } from '../../server/integrations/riotPolicy';
import { fraseContacto, p, ul, type DocumentoLegal } from './tipos';

export const RIOT: DocumentoLegal = {
  id: 'riot',
  titulo: 'Integración con Riot Games',
  version: RIOT_POLICY_VERSION,
  updatedAt: RIOT_POLICY_UPDATED_AT,
  alUsar: 'Se acepta al vincular una cuenta de Riot en Integraciones, no al entrar en Lalo.',
  secciones: (d) => [
    {
      id: 'entrada',
      titulo: null,
      bloques: [
        p(
          'Esta política solo te afecta si vinculas una cuenta de Riot Games en «Integraciones» para usar «Alertas de juego». Si no usas esa integración, no tienes que aceptarla y nada de lo que dice se te aplica.'
        ),
        p(
          'Lalo Stream Suite usa la API de Riot Games con una clave que Riot concede a este producto. Riot pone condiciones a los productos que usan su API y a las personas que los usan. Aquí están resumidas. Los textos completos son los de Riot: las [políticas para desarrolladores](https://developer.riotgames.com/policies/general) y sus [avisos legales](https://www.riotgames.com/en/legal). Si este resumen y los textos de Riot dicen cosas distintas, mandan los de Riot.'
        ),
      ],
    },
    {
      id: 'no-afiliacion',
      titulo: 'Lalo no es un producto de Riot Games',
      bloques: [
        p(
          'Lalo Stream Suite no está respaldada por Riot Games y no refleja los puntos de vista ni las opiniones de Riot Games ni de nadie que participe oficialmente en la producción o la gestión de las propiedades de Riot Games. Riot Games y todas las propiedades asociadas son marcas comerciales o marcas registradas de Riot Games, Inc.'
        ),
        p('Lalo no usa los logotipos de Riot Games ni los de sus juegos. Los nombres de los juegos aparecen solo como texto, para decir de qué juego es cada alerta.'),
      ],
    },
    {
      id: 'que-hace',
      titulo: 'Qué hace la integración',
      bloques: [
        p('Con tu cuenta vinculada, Lalo consulta a Riot y muestra en tu directo alertas sobre tu propia cuenta de League of Legends:'),
        ul(
          'El resultado de tus partidas cuando terminan: victoria o derrota, campeón y tus bajas, muertes y asistencias.',
          'Tu liga y tu división, y los avisos de subida o bajada.',
          'Jugadas destacadas de tu última partida ya terminada, tu maestría de campeón y tu racha del directo.',
          'El aviso de que empieza una partida, con tu campeón.'
        ),
        p('Lo que la integración no hace, porque las políticas de Riot no lo permiten o porque no hace falta:'),
        ul(
          'No muestra datos de tus rivales ni de tus compañeros de partida.',
          'No te da durante la partida información que no conocieras ni ninguna ventaja sobre otros jugadores.',
          'No calcula clasificaciones alternativas a las de Riot (MMR, ELO o parecidas).',
          'No ofrece apuestas ni predicciones con dinero sobre tus partidas.',
          'No te pide la contraseña de Riot ni entra en tu cuenta.'
        ),
      ],
    },
    {
      id: 'tu-parte',
      titulo: 'Lo que aceptas al vincular tu cuenta',
      bloques: [
        ul(
          '**Vinculas solo tu propia cuenta de Riot.** El Riot ID es un dato público y Lalo no puede comprobar que sea tuyo: vincular la cuenta de otra persona incumple esta política.',
          '**Aceptas que esos datos salgan en tu directo.** Lo que muestran las alertas lo verá tu audiencia.',
          '**No usas las alertas para apuestas ni para dar ventaja en partida.** Tampoco las conectas a otras herramientas de Lalo, como la ruleta o las batallas, para apostar sobre el resultado de una partida.',
          '**No colocas las capas tapando el mapa ni la interfaz del juego** de forma que oculten información de la partida.',
          '**Sigues cumpliendo las condiciones de Riot.** Usar Lalo no cambia las [condiciones de servicio de Riot](https://www.riotgames.com/en/terms-of-service) que aceptaste al crear tu cuenta de juego.'
        ),
      ],
    },
    {
      id: 'datos',
      titulo: 'Qué se guarda',
      bloques: [
        p(
          'En el servidor de Lalo se guardan tu Riot ID, el servidor en el que juegas, el identificador que Riot da a esa cuenta y la versión de esta política que aceptaste, con su fecha. No se guarda ninguna contraseña ni permiso de Riot. Los datos de tus partidas no se almacenan: se piden a Riot cuando la capa los necesita y se olvidan a los pocos minutos.'
        ),
        p('Al desvincular la cuenta en «Integraciones» se borra todo lo anterior. El resto está en la [Política de privacidad](legal:privacidad).'),
      ],
    },
    {
      id: 'cambios',
      titulo: 'Si algo cambia',
      bloques: [
        p(
          'Riot puede cambiar sus políticas, limitar su API o retirar la clave de Lalo en cualquier momento. Si eso ocurre, la integración puede dejar de funcionar del todo o en parte, sin aviso previo. Las alertas dependen además de los tiempos de Riot: llegan al terminar la partida, no al instante.'
        ),
        p(
          `Si esta política cambia, la ficha de Riot Games en «Integraciones» te pedirá aceptar la versión nueva; hasta entonces las alertas siguen funcionando con lo que ya aceptaste. Para cualquier duda, ${fraseContacto(d)}.`
        ),
      ],
    },
  ],
};
