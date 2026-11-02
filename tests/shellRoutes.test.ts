/** Rutas del cascarón: las direcciones viejas abren la vista y la ventana correctas. */

import { describe, expect, it } from 'vitest';
import { viewForRoute } from '../src/components/shell/routes';

describe('viewForRoute', () => {
  it('destinos sin ventana', () => {
    expect(viewForRoute('catalogo')).toEqual({ view: 'inicio', tool: null });
    expect(viewForRoute('control')).toEqual({ view: 'vivo', tool: null });
    expect(viewForRoute('herramientas')).toEqual({ view: 'herramientas', tool: null });
    expect(viewForRoute('integraciones')).toEqual({ view: 'conexiones', tool: null });
    expect(viewForRoute('cuenta')).toEqual({ view: 'plan', tool: null });
  });

  it('#alertas muestra Herramientas con la ventana de Alertas', () => {
    expect(viewForRoute('alertas')).toEqual({ view: 'herramientas', tool: 'alertas' });
    expect(viewForRoute('done')).toEqual({ view: 'herramientas', tool: 'done' });
  });

  it('Ko-fi y Alertas de juego abren Conexiones con su ventana', () => {
    expect(viewForRoute('kofi')).toEqual({ view: 'conexiones', tool: 'kofi' });
    expect(viewForRoute('juego')).toEqual({ view: 'conexiones', tool: 'juego' });
  });
});
