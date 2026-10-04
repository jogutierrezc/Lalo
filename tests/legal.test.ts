/**
 * tests/legal.test.ts
 *
 * Lógica pura de la parte legal: datos que faltan, direcciones de la página,
 * texto con marcas, versiones y qué documentos hay que volver a aceptar.
 */

import { describe, expect, it } from 'vitest';
import { DOCUMENTOS, VERSIONES_ACTUALES, versionesVigentes } from '../src/legal';
import { DATOS_LEGALES, type DatosLegales } from '../src/legal/datos';
import {
  aceptoAlgunaVez,
  claveAceptacion,
  compararVersiones,
  datosFaltantes,
  documentosPendientes,
  hrefLegal,
  leerAceptacionLocal,
  parseRutaLegal,
  partirTexto,
  resumenAceptacion,
  versionesDeFilas,
} from '../src/legal/logica';
import { DOC_IDS } from '../src/legal/tipos';

const completos: DatosLegales = {
  operador: 'Operador de prueba S.A.S.',
  correoLegal: 'legal@ejemplo.test',
  edadMinima: 18,
  direccionPostal: 'Calle 1 # 2-3, Ciudad',
  agenteDmcaRegistrado: false,
};
const vacios: DatosLegales = { ...completos, correoLegal: '', edadMinima: null, direccionPostal: '' };

const textoDe = (datos: DatosLegales) =>
  DOCUMENTOS.flatMap((doc) =>
    doc.secciones(datos).flatMap((seccion) => [
      seccion.titulo ?? '',
      ...seccion.bloques.flatMap((bloque) => ('items' in bloque ? bloque.items : [bloque.texto])),
    ])
  ).join('\n');

describe('datos que faltan', () => {
  it('con todo puesto no falta nada', () => {
    expect(datosFaltantes(completos)).toEqual([]);
  });

  it('dice qué falta: correo, edad y dirección', () => {
    expect(datosFaltantes(vacios)).toHaveLength(3);
    expect(datosFaltantes({ ...completos, correoLegal: '  ' })).toEqual([
      'Correo de contacto para avisos legales y datos personales',
    ]);
    expect(datosFaltantes({ ...completos, edadMinima: null })).toEqual(['Edad mínima para usar el servicio']);
    expect(datosFaltantes({ ...completos, edadMinima: 0 })).toHaveLength(1);
    expect(datosFaltantes({ ...completos, direccionPostal: '' })).toEqual(['Dirección para notificaciones']);
  });

  it('los datos publicados están completos', () => {
    expect(datosFaltantes(DATOS_LEGALES)).toEqual([]);
  });

  it('sin datos, los documentos se leen sin huecos ni marcadores', () => {
    const texto = textoDe(vacios);
    expect(texto).not.toMatch(/\[correo|undefined|null|NaN/);
    expect(texto).not.toMatch(/: \.|\(\)|  /);
    expect(texto).not.toMatch(/Dirección/);
  });

  it('con datos, los documentos enseñan el correo, la edad y la dirección', () => {
    const texto = textoDe(completos);
    expect(texto).toContain('legal@ejemplo.test');
    expect(texto).toContain('18 años o más');
    expect(texto).toContain('Calle 1 # 2-3, Ciudad');
  });

  it('mientras no haya agente registrado, no se invoca la protección de la DMCA', () => {
    expect(textoDe(completos)).toMatch(/no invoca(mos)? la protección de la sección 512/);
    expect(textoDe({ ...completos, agenteDmcaRegistrado: true })).not.toMatch(/no invoca/);
  });
});

describe('documentos', () => {
  it('hay uno por identificador, con versión, fecha y texto', () => {
    expect(DOCUMENTOS.map((doc) => doc.id)).toEqual([...DOC_IDS]);
    for (const doc of DOCUMENTOS) {
      expect(doc.version).toMatch(/^\d+(\.\d+)*$/);
      expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.secciones(completos).length).toBeGreaterThan(0);
    }
  });

  it('las secciones de cada documento tienen anclas únicas', () => {
    for (const doc of DOCUMENTOS) {
      const ids = doc.secciones(completos).map((seccion) => seccion.id);
      expect(new Set(ids).size).toBe(ids.length);
      ids.forEach((id) => expect(id).toMatch(/^[a-z0-9-]+$/));
    }
  });

  it('los enlaces entre documentos apuntan a documentos y secciones que existen', () => {
    for (const trozo of partirTexto(textoDe(completos))) {
      if (trozo.tipo !== 'enlace' || !trozo.href.startsWith('#legal')) continue;
      const ruta = parseRutaLegal(trozo.href);
      expect(ruta).not.toBeNull();
      if (ruta?.seccion) {
        const doc = DOCUMENTOS.find((item) => item.id === ruta.doc);
        expect(doc?.secciones(completos).map((seccion) => seccion.id)).toContain(ruta.seccion);
      }
    }
  });

  it('el texto publicado no trae notas para el abogado ni rayas largas', () => {
    const texto = textoDe(completos);
    expect(texto).not.toMatch(/Para revisar con tu abogado/i);
    expect(texto).not.toContain(String.fromCharCode(0x2014));
    expect(textoDe(vacios)).not.toContain(String.fromCharCode(0x2014));
  });

  it('el marco por país cubre Colombia, México y Estados Unidos', () => {
    const paises = DOCUMENTOS.find((doc) => doc.id === 'paises');
    expect(paises?.secciones(completos).map((seccion) => seccion.id)).toEqual(
      expect.arrayContaining(['colombia', 'mexico', 'estados-unidos'])
    );
  });
});

describe('direcciones de la página legal', () => {
  it('reconoce la portada, un documento y una sección', () => {
    expect(parseRutaLegal('#legal')).toEqual({ doc: 'terminos', seccion: null });
    expect(parseRutaLegal('#legal/voces')).toEqual({ doc: 'voces', seccion: null });
    expect(parseRutaLegal('#/legal/paises/mexico/')).toEqual({ doc: 'paises', seccion: 'mexico' });
    expect(parseRutaLegal('#LEGAL/Privacidad')).toEqual({ doc: 'privacidad', seccion: null });
  });

  it('un documento desconocido lleva al primero', () => {
    expect(parseRutaLegal('#legal/otro')).toEqual({ doc: 'terminos', seccion: null });
  });

  it('lo que no es de la página legal devuelve null', () => {
    expect(parseRutaLegal('')).toBeNull();
    expect(parseRutaLegal('#cuenta')).toBeNull();
    expect(parseRutaLegal('#legales')).toBeNull();
    expect(parseRutaLegal('#admin/legal')).toBeNull();
  });

  it('escribe las direcciones que luego sabe leer', () => {
    expect(hrefLegal()).toBe('#legal');
    expect(hrefLegal('voces')).toBe('#legal/voces');
    expect(parseRutaLegal(hrefLegal('retirada', 'paises'))).toEqual({ doc: 'retirada', seccion: 'paises' });
  });
});

describe('texto con marcas', () => {
  it('parte negritas, enlaces a documentos, enlaces externos y correos', () => {
    expect(partirTexto('Lee **esto** y [las voces](legal:voces/retirada), [fuera](https://ejemplo.test) o [a@b.test](mailto:a@b.test).')).toEqual([
      { tipo: 'texto', texto: 'Lee ' },
      { tipo: 'negrita', texto: 'esto' },
      { tipo: 'texto', texto: ' y ' },
      { tipo: 'enlace', texto: 'las voces', href: '#legal/voces/retirada', externo: false },
      { tipo: 'texto', texto: ', ' },
      { tipo: 'enlace', texto: 'fuera', href: 'https://ejemplo.test', externo: true },
      { tipo: 'texto', texto: ' o ' },
      { tipo: 'enlace', texto: 'a@b.test', href: 'mailto:a@b.test', externo: false },
      { tipo: 'texto', texto: '.' },
    ]);
  });

  it('un destino que no se reconoce queda como texto, sin enlace', () => {
    expect(partirTexto('[x](javascript:alert(1))')[0]).toEqual({ tipo: 'texto', texto: 'x' });
    expect(partirTexto('[x](legal:inventado)')).toEqual([{ tipo: 'texto', texto: 'x' }]);
    expect(partirTexto('sin marcas')).toEqual([{ tipo: 'texto', texto: 'sin marcas' }]);
  });
});

describe('versiones y aceptación', () => {
  const actuales = [
    { id: 'terminos', version: '1.1' },
    { id: 'voces', version: '1.0' },
    { id: 'privacidad', version: '2.0' },
  ] as const;

  it('compara versiones por números, no por letras', () => {
    expect(compararVersiones('1.0', '1.0')).toBe(0);
    expect(compararVersiones('1.2', '1.10')).toBeLessThan(0);
    expect(compararVersiones('2.0', '1.9')).toBeGreaterThan(0);
    expect(compararVersiones('1', '1.0.0')).toBe(0);
  });

  it('una cuenta que nunca aceptó tiene todo pendiente', () => {
    expect(documentosPendientes({}, actuales)).toEqual(['terminos', 'voces', 'privacidad']);
    expect(aceptoAlgunaVez({})).toBe(false);
  });

  it('con todo aceptado no hay nada pendiente', () => {
    expect(documentosPendientes({ terminos: '1.1', voces: '1.0', privacidad: '2.0' }, actuales)).toEqual([]);
    expect(documentosPendientes(versionesVigentes(), VERSIONES_ACTUALES)).toEqual([]);
  });

  it('al subir la versión de un documento, solo ese vuelve a estar pendiente', () => {
    const aceptadas = { terminos: '1.0', voces: '1.0', privacidad: '2.0' };
    expect(documentosPendientes(aceptadas, actuales)).toEqual(['terminos']);
    expect(aceptoAlgunaVez(aceptadas)).toBe(true);
  });

  it('haber aceptado una versión posterior no pide nada', () => {
    expect(documentosPendientes({ terminos: '3.0', voces: '1.0', privacidad: '2.0' }, actuales)).toEqual([]);
  });

  it('un documento nuevo queda pendiente aunque el resto esté aceptado', () => {
    expect(documentosPendientes({ terminos: '1.1', voces: '1.0' }, actuales)).toEqual(['privacidad']);
  });

  it('de las filas de la nube se queda con la versión más alta de cada documento conocido', () => {
    const filas = [
      { document: 'terminos', version: '1.0', accepted_at: '2026-01-01T00:00:00Z' },
      { document: 'terminos', version: '1.10', accepted_at: '2026-03-01T00:00:00Z' },
      { document: 'terminos', version: '1.2', accepted_at: '2026-02-01T00:00:00Z' },
      { document: 'otro', version: '9.0', accepted_at: '2026-02-01T00:00:00Z' },
    ];
    expect(versionesDeFilas(filas)).toEqual({ terminos: '1.10' });
  });

  it('resume para el administrador si la cuenta está al día y cuándo aceptó', () => {
    expect(resumenAceptacion([], actuales)).toEqual({ estado: 'nunca', fecha: null });
    const viejas = [{ document: 'terminos', version: '1.0', accepted_at: '2026-01-01T00:00:00Z' }];
    expect(resumenAceptacion(viejas, actuales)).toEqual({ estado: 'anterior', fecha: '2026-01-01T00:00:00Z' });
    const todas = [
      ...viejas,
      { document: 'terminos', version: '1.1', accepted_at: '2026-05-01T00:00:00Z' },
      { document: 'voces', version: '1.0', accepted_at: '2026-01-01T00:00:00Z' },
      { document: 'privacidad', version: '2.0', accepted_at: '2026-05-01T00:00:00Z' },
    ];
    expect(resumenAceptacion(todas, actuales)).toEqual({ estado: 'al-dia', fecha: '2026-05-01T00:00:00Z' });
  });
});

describe('recuerdo en este navegador', () => {
  it('se guarda por cuenta', () => {
    expect(claveAceptacion('a')).not.toBe(claveAceptacion('b'));
  });

  it('lee lo guardado e ignora lo que no reconoce', () => {
    expect(leerAceptacionLocal(null)).toEqual({});
    expect(leerAceptacionLocal('no es json')).toEqual({});
    expect(leerAceptacionLocal('[]')).toEqual({});
    expect(leerAceptacionLocal('{"terminos":"1.0","voces":7,"otro":"1.0","privacidad":"uno"}')).toEqual({ terminos: '1.0' });
    expect(leerAceptacionLocal(JSON.stringify(versionesVigentes()))).toEqual(versionesVigentes());
  });
});
