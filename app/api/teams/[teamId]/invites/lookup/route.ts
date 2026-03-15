import { NextRequest, NextResponse } from 'next/server';

import { hashInviteToken } from '@/lib/server/invite-token';
import { createServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin';
import { withErrorHandling } from '@/lib/server/with-error-handling';

const getHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) => {
  const { teamId } = await params;
  const token = request.nextUrl.searchParams.get('token');

  if (!token || token.length < 16) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Invite token is required' } },
      { status: 422 }
    );
  }

  const admin = createServiceRoleSupabaseClient();
  const tokenHash = hashInviteToken(token);

  const { data: invite, error } = await admin
    .from('team_invites')
    .select('id, team_id, email, accepted_at, revoked_at, expires_at')
    .eq('team_id', teamId)
    .eq('token_hash', tokenHash)
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  if (!invite) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Invite not found' } },
      { status: 404 }
    );
  }

  let status: 'pending' | 'accepted' | 'revoked' | 'expired' = 'pending';
  if (invite.accepted_at) status = 'accepted';
  else if (invite.revoked_at) status = 'revoked';
  else if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) status = 'expired';

  return NextResponse.json(
    {
      invite: {
        id: invite.id,
        team_id: invite.team_id,
        email: invite.email,
        email_normalized: invite.email,
        status,
        accepted_at: invite.accepted_at,
        revoked_at: invite.revoked_at,
        expires_at: invite.expires_at,
      },
    },
    { status: 200 }
  );
};

export const GET = withErrorHandling(getHandler, 'team-invites-lookup-get');
