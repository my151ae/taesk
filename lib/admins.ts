export const ADMIN_EMAILS = new Set(["matsumocy@gmail.com"]);

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.trim().toLowerCase());
}
