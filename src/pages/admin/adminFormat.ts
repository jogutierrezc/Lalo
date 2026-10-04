/**
 * src/pages/admin/adminFormat.ts
 *
 * Formato de fechas de la consola de administración.
 */

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin caducidad';

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
