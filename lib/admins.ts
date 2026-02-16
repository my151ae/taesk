function parseAdminUserIds(raw?: string): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

export const ADMIN_USER_IDS = parseAdminUserIds(process.env.ADMIN_USER_IDS);

export function isAdminUser(input: { id?: string | null; email?: string | null }): boolean {
  const userId = input.id?.trim();
  return Boolean(userId && ADMIN_USER_IDS.has(userId));
}
