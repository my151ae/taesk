'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/app/contexts/AuthContext'

type AcceptState = 'idle' | 'submitting' | 'success' | 'error'
type InviteMetadataState = 'loading' | 'ready' | 'error'

type InviteMetadata = {
  email: string | null
  email_normalized: string | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
}

type SessionUser = {
  id: string
  email: string | null
} | null

function getInviteErrorMessage(code?: string, fallback?: string): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 'ログインしてから招待を受け取ってください。'
    case 'FORBIDDEN':
    case 'INVITE_EMAIL_MISMATCH':
      return 'この招待リンクは、招待されたメールアドレスでログインした場合のみ利用できます。'
    case 'GONE':
    case 'INVITE_EXPIRED':
      return 'この招待リンクは有効期限切れです。'
    case 'CONFLICT':
    case 'ALREADY_ACCEPTED':
      return 'この招待リンクはすでに使用済みです。'
    case 'INVITE_REVOKED':
      return 'この招待リンクは取り消されています。'
    case 'NOT_FOUND':
      return '招待リンクが見つかりません。'
    default:
      return fallback || '招待の受諾に失敗しました。'
  }
}

function TeamInvitePageInner() {
  const searchParams = useSearchParams()
  const { user, loading, signOut } = useAuth()

  const teamId = searchParams.get('teamId')
  const token = searchParams.get('token')
  const [state, setState] = useState<AcceptState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [consumedBoardAccesses, setConsumedBoardAccesses] = useState(0)
  const [inviteMetadata, setInviteMetadata] = useState<InviteMetadata | null>(null)
  const [inviteMetadataState, setInviteMetadataState] = useState<InviteMetadataState>('loading')
  const [serverUser, setServerUser] = useState<SessionUser>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const effectiveUserEmail = user?.email ?? serverUser?.email ?? null

  const loginHref = useMemo(() => {
    const params = new URLSearchParams()
    if (teamId) params.set('teamId', teamId)
    if (token) params.set('token', token)
    return `/login?next=${encodeURIComponent(`/invite/team?${params.toString()}`)}`
  }, [teamId, token])

  const isInviteEmailMismatch = Boolean(
    effectiveUserEmail &&
    inviteMetadata?.email_normalized &&
    effectiveUserEmail.toLowerCase() !== inviteMetadata.email_normalized.toLowerCase()
  )

  useEffect(() => {
    let cancelled = false

    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' })
        const body = (await response.json()) as { user?: SessionUser }
        if (cancelled) return
        setServerUser(body.user ?? null)
      } catch {
        if (cancelled) return
        setServerUser(null)
      } finally {
        if (!cancelled) {
          setSessionChecked(true)
        }
      }
    }

    void loadSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!teamId || !token) {
      return
    }

    let cancelled = false

    const loadInviteMetadata = async () => {
      setInviteMetadataState('loading')
      try {
        const response = await fetch(`/api/teams/${teamId}/invites/lookup?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        })
        const body = (await response.json()) as {
          invite?: InviteMetadata
          error?: { code?: string; message?: string }
        }

        if (!response.ok || !body.invite) {
          throw new Error(JSON.stringify(body.error ?? { message: 'Failed to load invite' }))
        }

        if (cancelled) return
        setInviteMetadata(body.invite)
        setInviteMetadataState('ready')
      } catch (error) {
        if (cancelled) return
        let fallback = '招待情報の取得に失敗しました。'
        if (error instanceof Error) {
          try {
            const parsed = JSON.parse(error.message) as { message?: string }
            fallback = parsed.message || fallback
          } catch {
            fallback = error.message
          }
        }
        setInviteMetadataState('error')
        setState('error')
        setMessage(fallback)
      }
    }

    void loadInviteMetadata()

    return () => {
      cancelled = true
    }
  }, [teamId, token])

  const handleSwitchAccount = async () => {
    await signOut()
    window.location.href = loginHref
  }

  const handleAcceptInvite = async () => {
    if (
      loading ||
      (!user && !serverUser) ||
      !sessionChecked ||
      !teamId ||
      !token ||
      inviteMetadataState !== 'ready' ||
      inviteMetadata?.status !== 'pending' ||
      isInviteEmailMismatch
    ) {
      return
    }

    setState('submitting')
    setMessage(null)

    try {
      const response = await fetch(`/api/teams/${teamId}/invites/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const body = (await response.json()) as {
        success?: boolean
        consumed_board_accesses?: number
        error?: { code?: string; message?: string }
      }

      if (!response.ok || !body.success) {
        throw new Error(JSON.stringify(body.error ?? { message: 'Failed to accept invite' }))
      }

      const nextConsumed = body.consumed_board_accesses ?? 0
      setConsumedBoardAccesses(nextConsumed)
      setState('success')
      setMessage(nextConsumed > 0 ? 'Team に参加し、Board access を付与しました。' : 'Team に参加しました。')
      setInviteMetadata((current) => current ? { ...current, status: 'accepted' } : current)
    } catch (error) {
      let code: string | undefined
      let fallback: string | undefined
      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message) as { code?: string; message?: string }
          code = parsed.code
          fallback = parsed.message
        } catch {
          fallback = error.message
        }
      }
      setState('error')
      setMessage(getInviteErrorMessage(code, fallback))
    }
  }

  if (!teamId || !token) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
        <div className="w-full rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">招待リンクが不正です</h1>
          <p className="mt-3 text-sm text-slate-600">Team 招待に必要な情報が不足しています。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">Team Invite</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Team に参加する</h1>

        {!(user || serverUser) ? (
          <>
            <p className="mt-4 text-sm text-slate-600">
              この Team に参加するには、招待されたメールアドレスでログインしてください。
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div>現在ログイン中: 未ログイン</div>
              {inviteMetadata?.email && <div>招待先: {inviteMetadata.email}</div>}
            </div>
            <Link
              href={loginHref}
              className="mt-6 inline-flex rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              ログインして参加する
            </Link>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm text-slate-600">
              {inviteMetadataState === 'loading' && '招待の内容を確認しています。'}
              {inviteMetadataState === 'ready' && state === 'submitting' && '招待を受諾しています。'}
              {inviteMetadataState === 'ready' && state === 'success' && message}
              {inviteMetadataState === 'ready' && state === 'error' && message}
              {inviteMetadataState === 'ready' && state === 'idle' && !isInviteEmailMismatch && '招待を受諾する準備ができました。'}
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div>現在ログイン中: {effectiveUserEmail ?? user?.id ?? serverUser?.id ?? '不明'}</div>
              {inviteMetadata?.email && <div>招待先: {inviteMetadata.email}</div>}
            </div>
            {isInviteEmailMismatch && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                別のアカウントでログインしています。招待されたメールアドレスでログインし直してください。
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => void handleSwitchAccount()}
                    className="inline-flex rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                  >
                    ログアウトして招待先アカウントで入り直す
                  </button>
                </div>
              </div>
            )}
            {!isInviteEmailMismatch && inviteMetadata?.status === 'pending' && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => void handleAcceptInvite()}
                  disabled={state === 'submitting'}
                  className="inline-flex rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {state === 'submitting' ? '招待を受諾しています...' : '招待を受諾する'}
                </button>
              </div>
            )}
            {state === 'success' && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                <p>
                  {consumedBoardAccesses > 0
                    ? 'Board access もあわせて付与されました。'
                    : 'Team への参加が完了しました。'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = '/board'
                  }}
                  className="mt-3 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  board 一覧へ移動
                </button>
              </div>
            )}
            {state === 'error' && (
              <div className="mt-6">
                <Link
                  href="/board"
                  className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  board 一覧へ戻る
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function TeamInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
          <div className="text-sm text-slate-500">招待を読み込んでいます...</div>
        </div>
      }
    >
      <TeamInvitePageInner />
    </Suspense>
  )
}
