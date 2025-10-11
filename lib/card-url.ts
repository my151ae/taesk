/**
 * Generate slug from card title
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build canonical URL for a card
 */
export function buildCardUrl(shortId: string, title: string): string {
  const slug = generateSlug(title);
  return slug ? `/c/${shortId}/${slug}` : `/c/${shortId}`;
}
