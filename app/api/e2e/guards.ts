import { NextRequest } from 'next/server';

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
  const enabled = process.env.E2E_ENABLED === 'true';
  const secret = process.env.E2E_SECRET;
  const header = req.headers.get('x-e2e-secret');

  if (!enabled) {
    throw new Error('E2E endpoints are disabled');
  }

  if (!secret) {
    throw new Error('E2E_SECRET not configured');
  }

  if (header !== secret) {
    throw new Error('Invalid E2E secret');
  }
}
