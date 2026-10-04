/// <reference types="vite/client" />

declare const __APP_BUILD_ID__: string;

// Variables públicas de Vite. Todas opcionales: sin ellas la nube queda apagada.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_TWITCH_CLIENT_ID?: string;
  readonly VITE_R2_PUBLIC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
