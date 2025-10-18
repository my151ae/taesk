/**
 * Phase 3 Feature Flags
 *
 * These flags control the rollout of Phase 3 collaboration features:
 * - Board permissions (owner/editor/commenter/viewer roles)
 * - Comments (with mentions and threading)
 * - Notifications (in-app and PWA push)
 */

export const featureFlags = {
  boardPermissions: process.env.NEXT_PUBLIC_FF_BOARD_PERMISSIONS === 'true',
  comments: process.env.NEXT_PUBLIC_FF_COMMENTS === 'true',
  notifications: process.env.NEXT_PUBLIC_FF_NOTIFICATIONS === 'true',
  push: process.env.NEXT_PUBLIC_FF_PUSH === 'true',
} as const;

export function isFeatureEnabled(feature: keyof typeof featureFlags): boolean {
  return featureFlags[feature];
}
