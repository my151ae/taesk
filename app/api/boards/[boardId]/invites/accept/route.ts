import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/server/with-error-handling';

const postHandler = async () =>
  NextResponse.json(
    {
      error: {
        code: 'GONE',
        message: 'Board invite acceptance has been removed. Ask a team admin for a Team invite instead.',
      },
    },
    { status: 410 }
  );

export const POST = withErrorHandling(postHandler, 'board-invites-accept-post');
