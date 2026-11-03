/**
 * src/components/done/renderers/publicUrl.ts
 *
 * URL de los módulos 3D de public/ (sin dependencias, para poder probarla).
 */

/**
 * URL absoluta de un archivo de public/. Con una ruta que empieza por «/», el cliente de Vite en
 * desarrollo le añade «?import» a los import() dinámicos y su servidor intenta transformar el archivo
 * («should not be imported from source code»): ningún modelo 3D cargaba con `npm run dev`. Con la
 * URL completa no lo toca y el archivo se sirve tal cual, igual que en producción.
 */
export function publicModuleUrl(path: string, origin: string = typeof window === 'undefined' ? '' : window.location.origin): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) ? path : `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}
