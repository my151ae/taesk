import { createServerSupabaseClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

function getSafeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) {
    return '/'
  }

  return raw.startsWith('//') ? '/' : raw
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const error_description = requestUrl.searchParams.get('error_description')
  const nextPath = getSafeNextPath(requestUrl.searchParams.get('next'))

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error, error_description)
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error_description || error)}`, requestUrl.origin)
    )
  }

  if (code) {
    const supabase = await createServerSupabaseClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
      console.error('Error exchanging code for session:', exchangeError)
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(exchangeError.message)}&next=${encodeURIComponent(nextPath)}`, requestUrl.origin)
      )
    }
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin))
}
