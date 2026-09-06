import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Profile } from '../../lib/types'
import { Spinner } from '../ui'
import LoginPage from '../LoginPage'
import PendingApproval from './PendingApproval'

interface ProfileValue {
  profile: Profile | null
  loading: boolean
  refresh: () => Promise<void>
}

const ProfileContext = createContext<ProfileValue>({
  profile: null, loading: true, refresh: async () => {},
})

/** The signed-in user's own profile row, loaded once by the gate. Screens read
 *  `is_super_admin` and status from here instead of hitting the table again. */
// eslint-disable-next-line react-refresh/only-export-components
export function useProfile() {
  return useContext(ProfileContext)
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Spinner className="h-6 w-6 text-indigo-600" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) { setProfile(null); setLoading(false); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    setProfile((data as Profile | null) ?? null)
    setLoading(false)
  }, [user])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  if (authLoading) return <FullPageSpinner />
  if (!user) return <LoginPage />
  if (loading) return <FullPageSpinner />

  const value: ProfileValue = { profile, loading, refresh }

  if (profile?.status !== 'active') {
    return (
      <ProfileContext.Provider value={value}>
        <PendingApproval profile={profile} onActivated={() => { void refresh() }} />
      </ProfileContext.Provider>
    )
  }

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}
