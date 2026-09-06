/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** '1' once Google OAuth is configured in Supabase. */
  readonly VITE_GOOGLE_AUTH?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
