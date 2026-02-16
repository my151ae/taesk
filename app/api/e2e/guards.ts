import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * E2E API Guard
 *
 * Ensures that E2E endpoints are only accessible when:
 * 1. E2E_ENABLED environment variable is set to 'true'
 * 2. Request includes correct x-e2e-secret header
 *
 * This prevents accidental exposure in production.
 */
export function assertE2EEnabled(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    throw new Error('E2E_NOT_FOUND');
  }

  const enabled = process.env.E2E_ENABLED === 'true';
  const secret = process.env.E2E_SECRET;
  const header = req.headers.get('x-e2e-secret');

  if (!enabled) {
    throw new Error('E2E_NOT_FOUND');
  }

  if (!secret || !header) {
    throw new Error('E2E_NOT_FOUND');
  }

  const headerBuffer = Buffer.from(header);
  const secretBuffer = Buffer.from(secret);
  if (headerBuffer.length !== secretBuffer.length) {
    throw new Error('E2E_NOT_FOUND');
  }

  if (!timingSafeEqual(headerBuffer, secretBuffer)) {
    throw new Error('E2E_NOT_FOUND');
  }
}
