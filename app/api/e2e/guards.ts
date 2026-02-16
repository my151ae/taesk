import { NextRequest } from 'next/server';

function safeEqualSecret(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const max = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;

  for (let i = 0; i < max; i += 1) {
    const av = i < aBytes.length ? aBytes[i] : 0;
    const bv = i < bBytes.length ? bBytes[i] : 0;
    diff |= av ^ bv;
  }

  return diff === 0;
}

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

  if (!safeEqualSecret(header, secret)) {
    throw new Error('E2E_NOT_FOUND');
  }
}
