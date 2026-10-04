/**
 * src/pages/CloudSetup.tsx
 *
 * Página «Nube»: solo aparece cuando la nube no está configurada. Explica qué
 * falta para activar las cuentas, el acceso y el portal de administración.
 *
 * No comprueba nada en Supabase: solo mira si las dos variables de entorno
 * tienen valor en esta copia de la app, y nunca muestra ese valor.
 */

import React from 'react';
import { SuiteNav } from '../components/SuiteNav';
import { cloudEnvStatus } from '../lib/supabase';

const VARIABLES: { name: string; present: boolean; what: string }[] = [
  { name: 'VITE_SUPABASE_URL', present: cloudEnvStatus.url, what: 'La dirección de tu proyecto de Supabase (Project URL).' },
  { name: 'VITE_SUPABASE_ANON_KEY', present: cloudEnvStatus.anonKey, what: 'La clave pública «anon» del proyecto.' },
];

const MIGRATIONS = ['0001_lalo_init.sql', '0002_widget_version.sql', '0003_admin_access.sql', '0004_invite_requires_twitch.sql'];

export const CloudSetup: React.FC = () => {
  const missing = VARIABLES.filter((variable) => !variable.present).length;

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-3xl gap-5 px-5 py-6">
        <SuiteNav currentApp="nube" />

        <section className="cab-mod">
          <h2>La nube está apagada</h2>
          <p className="cab-hint">
            Ahora mismo Lalo guarda todo en este navegador y funciona sin cuentas. Con la nube encendida aparecen la
            pantalla de acceso, «Mi cuenta» y el portal de administración (códigos de afiliado, perfiles y planes).
          </p>
          <p className="cab-note">
            {missing === 2
              ? 'Faltan las dos variables de entorno de Supabase.'
              : 'Falta una de las dos variables de entorno de Supabase.'}{' '}
            Esta página solo mira si tienen valor en esta copia de la app. No puede comprobar tu proyecto de Supabase.
          </p>
        </section>

        <section className="cab-mod">
          <h2>Qué falta, en orden</h2>
          <ol className="nube-steps">
            <li>
              <b>Crea el proyecto en Supabase y copia sus dos datos públicos</b>
              <p className="cab-hint">
                Van en el archivo <span className="cab-mono">.env.local</span> de la raíz del proyecto (y en las
                variables de entorno de Vercel para la versión publicada).
              </p>
              <ul className="cab-rows">
                {VARIABLES.map((variable) => (
                  <li key={variable.name} className="cab-row">
                    <div className="min-w-0">
                      <p className="cab-row-text cab-mono">{variable.name}</p>
                      <p className="cab-hint">{variable.what}</p>
                    </div>
                    <span className="cab-chip" data-status={variable.present ? undefined : 'skipped'}>
                      {variable.present ? 'Tiene valor' : 'Vacía'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="cab-hint">
                Después de escribirlas hay que detener y volver a arrancar la app (o volver a publicarla): se leen al
                arrancar, no al guardar el archivo.
              </p>
            </li>
            <li>
              <b>Ejecuta las migraciones en el SQL Editor de Supabase, una por una y en este orden</b>
              <ul className="cab-rows">
                {MIGRATIONS.map((file) => (
                  <li key={file} className="cab-row">
                    <span className="cab-row-text cab-mono">supabase/migrations/{file}</span>
                  </li>
                ))}
              </ul>
              <p className="cab-hint">
                Este SQL todavía no se ha probado contra un proyecto real. Si alguna falla, copia el error tal cual.
              </p>
            </li>
            <li>
              <b>Activa Twitch como proveedor de acceso</b>
              <p className="cab-hint">
                En Supabase: Authentication, Providers, Twitch. Necesita el Client ID y el Client Secret de una
                aplicación creada en dev.twitch.tv. Los streamers entran así.
              </p>
            </li>
            <li>
              <b>Crea tu usuario administrador</b>
              <p className="cab-hint">
                El administrador entra con correo y clave de administración, sin Twitch. Se crea en Authentication,
                Users, y se le da el rol con una línea de SQL. El proveedor Email tiene que estar activado.
              </p>
            </li>
          </ol>
        </section>

        <section className="cab-mod">
          <h2>Guía completa</h2>
          <p className="cab-hint">
            Todos los pasos, con las pantallas de Supabase y de Twitch, están en el archivo{' '}
            <span className="cab-mono">supabase/README.md</span> de este proyecto.
          </p>
          <p className="cab-hint">
            Cuando las dos variables tengan valor, esta página desaparece del menú y al abrir Lalo verás la pantalla de
            acceso. Si algo de los pasos 2 a 4 quedó a medias, el error aparecerá allí.
          </p>
        </section>
      </div>
    </div>
  );
};
