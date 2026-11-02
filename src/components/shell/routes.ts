/**
 * src/components/shell/routes.ts
 *
 * Qué vista del cascarón enseña cada ruta del creador, y qué ventana abre.
 * Las rutas viejas siguen funcionando: #alertas muestra Herramientas con la
 * ventana de Alertas abierta; #kofi y #juego, Conexiones con su ventana.
 */

import { toolById, type ToolId } from '../../lib/tools';

export type ShellView = 'inicio' | 'vivo' | 'herramientas' | 'conexiones' | 'plan' | 'nube';

export interface ShellDestination {
  id: Exclude<ShellView, 'nube'>;
  label: string;
  href: string;
}

export const DESTINATIONS: ShellDestination[] = [
  { id: 'inicio', label: 'Inicio', href: '#dashboard' },
  { id: 'vivo', label: 'En vivo', href: '#control' },
  { id: 'herramientas', label: 'Herramientas', href: '#herramientas' },
  { id: 'conexiones', label: 'Conexiones', href: '#integraciones' },
  { id: 'plan', label: 'Plan y pagos', href: '#cuenta' },
];

export interface RouteTarget {
  view: ShellView;
  /** Ventana que debe abrirse al llegar por esta ruta. */
  tool: ToolId | null;
}

export function viewForRoute(route: string): RouteTarget {
  switch (route) {
    case 'control':
      return { view: 'vivo', tool: null };
    case 'herramientas':
      return { view: 'herramientas', tool: null };
    case 'integraciones':
      return { view: 'conexiones', tool: null };
    case 'cuenta':
      return { view: 'plan', tool: null };
    case 'nube':
      return { view: 'nube', tool: null };
    case 'catalogo':
      return { view: 'inicio', tool: null };
    default: {
      const tool = toolById(route);
      if (!tool) return { view: 'inicio', tool: null };
      const inConexiones = tool.kind === 'conexion';
      return { view: inConexiones ? 'conexiones' : 'herramientas', tool: tool.id };
    }
  }
}

export const VIEW_TITLE: Record<ShellView, string> = {
  inicio: 'Inicio',
  vivo: 'En vivo',
  herramientas: 'Herramientas',
  conexiones: 'Conexiones',
  plan: 'Plan y pagos',
  nube: 'Nube',
};
