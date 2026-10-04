# Revisión legal pendiente: Lalo Stream Suite

Estado: **borrador**. Nada de lo publicado en la página legal (`#legal`) es un texto
definitivo ni asesoría legal. Lo redactó un asistente que no es abogado, a partir de
los textos del dueño y de lo que la app hace de verdad. Antes de abrir el servicio lo
debe revisar un abogado en Colombia y, para sus apartados, uno en México y otro en
Estados Unidos.

Dónde está cada cosa:

- Textos: `src/legal/` (un archivo por documento, con `version` y `updatedAt`).
- Datos del operador: `src/legal/datos.ts`.
- Registro de aceptaciones: `supabase/migrations/0008_terms_acceptance.sql` (sin probar).

Las notas «Para revisar con tu abogado» del prototipo se quitaron del texto publicado
y están aquí, junto con las nuevas.

## Datos del operador: por confirmar

1. **Edad mínima.** El dueño escribió «188»; se leyó como **18**. Confirmar con él.
   Confirmar con los abogados que 18 años es el umbral correcto en cada uno de los
   tres países, tanto para contratar en línea como para consentir el tratamiento de
   datos personales.
2. **Dirección.** El dueño escribió «Bucaramanga, Colombia Carrera 26 35 170». Se
   publicó como «Carrera 26 # 35-170, Bucaramanga, Santander, Colombia»: el formato
   «# 35-170» y el departamento «Santander» son una normalización nuestra. Confirmar
   la dirección exacta, que es el domicilio registrado de la sociedad y que se puede
   publicar.
3. **Correo de contacto.** El correo publicado es una dirección personal de Gmail.
   Puede convenir una dirección dedicada (por ejemplo, del dominio de la empresa)
   para avisos legales y solicitudes de datos.
4. **Domicilio en los textos.** Confirmar si las normas de Colombia y de México
   exigen publicar un domicilio físico del operador en los términos o en el aviso de
   privacidad, y con qué detalle. En el texto de la ley mexicana de 2025 que
   consultamos, el aviso de privacidad debe incluir la identidad y el domicilio del
   responsable (art. 15, según la fuente 5).
5. **Identificación de la sociedad.** Los textos no llevan NIT ni matrícula mercantil.
   Confirmar si deben figurar.

## Por documento

### Términos de servicio

- **Reembolsos y retracto** (nota del prototipo). El texto dice que los pagos no son
  reembolsables salvo que la ley exija lo contrario. El Estatuto del Consumidor
  colombiano reconoce el derecho de retracto en ventas a distancia, con excepciones.
  Confirmar cómo aplica antes de cobrar, y si la frase debe cambiar. Hoy la app no
  cobra ni procesa pagos.
- **Resolución de disputas** (nota del prototipo). Falta decidir si habrá cláusula de
  jurisdicción, arbitraje o conciliación.
- **Añadidos nuestros, por validar**: el segundo párrafo de la cláusula 1 (remite a
  Privacidad y al Marco por país), la frase de edad y de cuenta de Twitch en regla en
  la cláusula 2, y los dos párrafos finales de la cláusula 6 (derechos irrenunciables
  del país del usuario; el español como texto que rige).
- **Limitación de responsabilidad** y «tal cual»: confirmar su alcance frente a
  consumidores en cada país.

### Voces e inteligencia artificial

- **Voces de referencia** (nota del prototipo). La cláusula 2 describe una intención.
  Solo se sostiene si de verdad las voces no se generaron imitando a un intérprete o
  a un personaje concreto. Si alguna lo fue, lo prudente es retirarla o sustituirla,
  no describirla. Cambiar el nombre de una voz no cambia a qué suena. Es la duda más
  importante de todo el paquete.
- **Marcas en la exención** (nota del prototipo). La cláusula 3 nombra a Riot Games,
  Marvel y The Walt Disney Company. Nombrarlas puede leerse como reconocer la
  inspiración. Valorar una exención general sin nombres. Además, la cláusula 3 habla
  de «parodias o referencias no oficiales» y la cláusula 2 dice que las voces no son
  de ningún personaje concreto: confirmar que no se contradicen.
- Los identificadores internos de las voces no cambiaron (son los del proveedor de
  voz). Confirmar con el proveedor el origen y la licencia de cada modelo de voz.

### Contenido generado por el usuario

- La licencia es «sublicenciable»: confirmar que basta para los proveedores que
  alojan y procesan el contenido, y si conviene acotarla más.
- El streamer responde de moderar su chat: confirmar el alcance de esa
  responsabilidad en cada país.

### Notificación y retirada

- **Fórmula de veracidad.** Fuera del apartado de Estados Unidos se cambió «bajo pena
  de perjurio» por una declaración de que la información es veraz y exacta. Confirmar
  la fórmula adecuada en Colombia y en México.
- **Contranotificación** (nota del prototipo). Se añadió un apartado general, «Si
  retiramos algo tuyo», y la mención a cuentas reincidentes. Son compromisos nuevos:
  validar su redacción y si conviene fijar plazos.
- Se mantiene «derechos de imagen» del texto original. Confirmar que el mismo
  procedimiento sirve para reclamos de imagen y de voz.

### Privacidad y tratamiento de datos

Documento nuevo, escrito a partir del código. Por validar:

- **Autorización.** La aceptación en la app tiene dos casillas (Términos y contenido;
  voces). No hay una casilla aparte para el tratamiento de datos. Confirmar si en
  Colombia hace falta una autorización previa, expresa e informada separada, y si en
  México basta el consentimiento tácito con el aviso de privacidad.
- **Espectadores.** Los nombres y los mensajes del chat de personas que no tienen
  cuenta en Lalo se muestran, se leen en voz alta y se envían al proveedor de voz.
  Las listas de usuarios bloqueados que escribe el streamer se guardan en la
  configuración de su cuenta. Confirmar la base legal y si el operador actúa como
  responsable o como encargado del streamer.
- **Transferencias internacionales.** Los proveedores (Supabase, Cloudflare, Vercel,
  Fish Audio, Twitch, Google Fonts) pueden tratar datos fuera del país del usuario.
  El texto lo dice en general. Confirmar qué exige cada país y si hacen falta
  contratos de transmisión o de encargo con cada proveedor.
- **Conservación.** El texto promete borrar los datos al cerrar la cuenta, salvo lo
  que deba conservarse. No hay plazos concretos y la app no tiene todavía un botón de
  «cerrar mi cuenta»: se hace a mano. Al borrar un usuario, sus archivos en el
  almacenamiento no se borran solos y la prueba de aceptación sí se borra (regla de
  la migración 0008). Decidir plazos y si la prueba de aceptación debe conservarse.
- **Registro de bases de datos y oficial de datos.** No comprobamos si el operador
  debe inscribir sus bases de datos ante la autoridad colombiana ni designar una
  persona encargada. En la ley mexicana de 2025 consultada, todo responsable designa
  a una persona o un departamento de datos personales (art. 29, fuente 5).
- **Incidentes de seguridad.** El texto dice que se avisará «cuando la ley lo exija».
  Confirmar obligaciones y plazos en cada país.
- **Fuentes tipográficas.** La app carga tipografías desde Google Fonts. Valorar
  servirlas desde el propio dominio.

## Por país

### Colombia

- Confirmar todo lo que el Marco por país afirma (ver fuentes 1 a 3).
- **Retracto.** Publicamos el plazo de cinco días hábiles y una de las excepciones.
  La fuente consultada dice que el plazo cuenta desde la entrega del bien; no
  pudimos comprobar en ella desde cuándo cuenta en servicios, así que el texto no lo
  dice. Confirmar.
- **Derecho de autor.** Citamos la Ley 23 de 1982 y la Decisión Andina 351 de 1993.
  No encontramos un procedimiento legal de notificación y retirada para proveedores
  de internet, así que el texto no afirma que exista ni que no exista. Confirmar, y
  confirmar cómo tratar los reclamos de imagen y de voz.
- Confirmar qué otras normas de comercio electrónico aplican al operador.

### México

- Confirmar todo lo que el Marco por país afirma (ver fuentes 5 a 8).
- **Plazos ARCO.** Publicamos «veinte días» y «quince días» como los leímos en la
  ley de 2025 (art. 31). Confirmar si son hábiles y cómo se computan.
- **Aviso de privacidad.** El texto dice que el documento de Privacidad «busca
  cumplir la función» de aviso de privacidad. Confirmar si cumple el contenido
  mínimo (art. 15) o si hace falta un aviso aparte.
- **Aviso y retirada.** Solo afirmamos que la Ley Federal del Derecho de Autor lo
  prevé desde 2020 (art. 114 Octies). No publicamos requisitos ni plazos porque no
  pudimos leer el texto oficial. Fuentes secundarias mencionan un plazo de 15 días
  para que quien avisa inicie un procedimiento; confirmar y completar el apartado.
- **Consumo.** Solo afirmamos en general lo que pide el art. 76 bis. En diciembre de
  2025 se añadieron reglas sobre cobros recurrentes y cancelación (fuente 7). Si la
  Plataforma llega a cobrar suscripciones, revisarlas. No comprobamos si el operador
  debe registrar su contrato ante PROFECO.
- Confirmar si la ley mexicana se aplica a un operador colombiano sin
  establecimiento en México y con qué alcance.

### Estados Unidos

- **Agente DMCA.** Ya hay una dirección física, pero el agente todavía tiene que
  inscribirse de verdad en el directorio de la U.S. Copyright Office antes de que el
  apartado de Estados Unidos pueda invocar la protección de la sección 512. Mientras
  tanto el texto dice que no se invoca. Cuando esté inscrito, cambiar
  `agenteDmcaRegistrado` a `true` en `src/legal/datos.ts` y subir la versión de los
  documentos afectados. Según la oficina, el proveedor debe dar una dirección física
  (no un apartado postal, salvo autorización previa), la tasa es de 6 dólares por
  designación y hay que renovarla cada tres años (fuentes 10 y 11).
- **Otros requisitos de la sección 512.** La protección exige además, entre otras
  cosas, una política de cuentas reincidentes (512(i)). Confirmar que lo redactado
  basta.
- **Privacidad estatal.** Publicamos los umbrales de la ley de California (fuente
  12) y decimos que su aplicación al operador está por confirmar. No revisamos las
  leyes de otros estados.
- **Menores.** Decimos que el servicio no está dirigido a menores de 13 años y que
  no se busca recoger sus datos (fuente 13). La edad mínima de Twitch la leímos en
  una fuente secundaria que cita sus condiciones (fuente 14), porque la página
  oficial no se dejó leer: confirmar en legal.twitch.com.
- **Voz e imagen.** Citamos la ley ELVIS de Tennessee como ejemplo (fuente 15), a
  partir de notas de despachos de abogados, no del texto oficial. Confirmar, y
  revisar otras leyes estatales de derecho de imagen y de réplicas digitales.
- **Ley aplicable.** Confirmar si la elección de la ley colombiana se sostiene
  frente a consumidores de Estados Unidos y de México.

## Idiomas

No hay versión en inglés. El texto dice que el español es el que rige y que la
traducción, cuando exista, será solo de ayuda. Queda pendiente para el público de
Estados Unidos; conviene que la haga o la revise un profesional.

## Lo que se dejó en términos generales por no poder comprobarlo

- Desde cuándo cuenta el retracto en servicios (Colombia).
- Requisitos y plazos del aviso y retirada mexicano.
- Si los días de los plazos ARCO son hábiles.
- Plazos de conservación de datos.
- Reglas de transferencia internacional de datos de cada país.
- Aplicación de las leyes estatales de privacidad de Estados Unidos al operador.
- Normas colombianas sobre notificación y retirada.

## Fuentes consultadas (3 de octubre de 2026)

Varias páginas oficiales no respondieron (funcionpublica.gov.co,
secretariasenado.gov.co, suin-juriscol.gov.co, diputados.gob.mx, oag.ca.gov). En esos
casos se usó otra copia del texto legal, indicada abajo.

1. Ley 1581 de 2012 (Colombia), arts. 2, 8, 14, 15, 16 y 19. Copia en el normograma
   de Colpensiones: https://normativa.colpensiones.gov.co/colpens/docs/ley_1581_2012.htm
2. Ley 1480 de 2011 (Colombia), arts. 47, 50 y 51. Copia en el normograma de
   Colpensiones: https://normativa.colpensiones.gov.co/colpens/docs/ley_1480_2011_pr001.htm
3. Conceptos de la Superintendencia de Industria y Comercio sobre el retracto en
   ventas a distancia (resultados de búsqueda): https://sedeelectronica.sic.gov.co/sites/default/files/normatividad/102018/Rad18_18185219excepcionesDerRetracto.PDF
4. Ley 23 de 1982, Decisión Andina 351 de 1993 y Ley 1915 de 2018 (Colombia), solo
   su existencia y materia: https://www.wipo.int/wipolex/es/legislation/details/14801
5. Ley Federal de Protección de Datos Personales en Posesión de los Particulares
   (México, DOF 20-03-2025), arts. 7, 8, 15, 29 y 31. Orden Jurídico Nacional:
   https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo125102.html
6. Nota sobre la ley mexicana de 2025 y la Secretaría Anticorrupción y Buen Gobierno:
   https://www.hoganlovells.com/es/publications/mexicos-new-federal-data-protection-law-what-it-means-for-companies
7. Ley Federal de Protección al Consumidor (México), arts. 56 y 76 bis:
   https://mley.mx/LFPC/articulo/76-bis/ y https://mley.mx/LFPC/articulo/56/ ; reforma
   de diciembre de 2025: https://www.cuatrecasas.com/es/latam/publico/art/regulacion-sobre-cancelacion-renovacion-revocacion-en-transacciones-electronicas
8. Ley Federal del Derecho de Autor (México), art. 114 Octies, por fuentes
   secundarias: https://idconline.mx/corporativo/2020/11/27/notice-and-takedowns-en-mexico-mito-o-realidad
   y https://www.elfinanciero.com.mx/nacional/2024/05/30/suprema-corte-avala-medidas-sobre-derechos-de-autor/
9. 17 U.S.C. § 512 (Estados Unidos), apartados (c)(2), (c)(3), (g)(2), (g)(3) e
   (i): https://www.law.cornell.edu/uscode/text/17/512
10. U.S. Copyright Office, directorio de agentes designados: https://www.copyright.gov/dmca-directory/
11. U.S. Copyright Office, preguntas frecuentes del directorio: https://www.copyright.gov/dmca-directory/faq.html
12. California Privacy Protection Agency, preguntas frecuentes (umbrales de la
    CCPA): https://cppa.ca.gov/faq.html
13. Federal Trade Commission, regla COPPA: https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa
14. Condiciones de Twitch, edad mínima (fuente secundaria): https://conductatlas.com/platform/twitch/twitch-terms-of-service/age-restriction-and-minors-policy/
15. Ley ELVIS de Tennessee: https://www.manatt.com/insights/newsletters/client-alert/tennessees-elvis-act-expands-publicity-rights-for
    y https://www.dwt.com/blogs/artificial-intelligence-law-advisor/2024/04/tennessee-elvis-act-ai-voice-replica
