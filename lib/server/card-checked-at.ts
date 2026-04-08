export function resolveCheckedAtMutation(args: {
  currentChecked: boolean;
  nextChecked: boolean;
  nowIso?: string;
}): string | null | undefined {
  if (args.currentChecked === args.nextChecked) return undefined;
  return args.nextChecked ? (args.nowIso ?? new Date().toISOString()) : null;
}
