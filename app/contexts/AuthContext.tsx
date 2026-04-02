'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type AuthContextType = {
  user: User | null
  loading: boolean
  signInWithGoogle: (nextPath?: string | null) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const FALLBACK_AUTH_CONTEXT: AuthContextType = {
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithPassword: async () => {},
  signOut: async () => {},
}

const AuthContext = createContext<AuthContextType>(FALLBACK_AUTH_CONTEXT)

// Check if auth bypass is enabled (for testing)
const BYPASS_AUTH = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

// Mock user for bypass mode (using valid UUID format)
const MOCK_USER: User = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'test@example.com',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: new Date().toISOString(),
} as User

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Bypass auth for testing
    if (BYPASS_AUTH) {
      console.warn('⚠️ AUTH BYPASS MODE ENABLED - DO NOT USE IN PRODUCTION')
      setUser(MOCK_USER)
      setLoading(false)
      return
    }

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = async (nextPath?: string | null) => {
    if (BYPASS_AUTH) {
      console.warn('Sign in bypassed in test mode')
      return
    }

    const callbackUrl = new URL(`${window.location.origin}/auth/callback`)
    if (nextPath && nextPath.startsWith('/')) {
      callbackUrl.searchParams.set('next', nextPath)
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl.toString(),
        queryParams: {
          // Force Google to show account selection screen
          prompt: 'select_account',
        },
      },
    })
    if (error) {
      console.error('Error signing in with Google:', error.message)
      throw error
    }
  }

  const signInWithPassword = async (email: string, password: string) => {
    if (BYPASS_AUTH) {
      console.warn('Sign in bypassed in test mode')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) {
      console.error('Error signing in with password:', error.message)
      throw error
    }
  }

  const signOut = async () => {
    if (BYPASS_AUTH) {
      console.warn('Sign out bypassed in test mode')
      return
    }

    // Clear user state immediately for better UX
    setUser(null)

    // Use 'global' scope to ensure complete sign out and force account selection on next login
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      console.error('Error signing out:', error.message)
      throw error
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInWithPassword, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  return context
}
