import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthValue {
  user: User | null
  session: Session | null
  loading: boolean
  /** True while a password-reset link is being completed. */
  recovering: boolean
  endRecovery: () => void
  signOut: () => Promise<void>
}

// Read before the client is constructed: supabase-js consumes the hash on init
// with detectSessionInUrl, so by the time a component mounts it is gone. The
// PASSWORD_RECOVERY event below is the primary signal; this is the belt to its
// braces, for the case where the listener attaches a tick too late.
const RECOVERY_IN_URL = typeof window !== 'undefined'
  && /[#&?]type=recovery(&|$)/.test(window.location.hash + window.location.search)

const AuthContext = createContext<AuthValue>({
  user: null, session: null, loading: true,
  recovering: false, endRecovery: () => {}, signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(RECOVERY_IN_URL)

  useEffect(() => {
    // Restore an existing session before the first paint of the board, so a
    // returning user never sees the login screen flash.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(next)
      setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value: AuthValue = {
    user: session?.user ?? null,
    session,
    loading,
    recovering,
    endRecovery: () => setRecovering(false),
    signOut: async () => { setRecovering(false); await supabase.auth.signOut() },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
