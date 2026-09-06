import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when the build was given Supabase credentials. The app shows a setup
 *  screen instead of a broken login form when this is false. */
export const isConfigured = Boolean(url && anonKey)

// A dummy URL keeps createClient from throwing at import time when the app is
// running unconfigured; the setup screen is what the user actually sees.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)
