/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Public half of the VAPID pair; safe to ship. Absent means push is off. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
