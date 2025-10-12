type BoardMetaResponse = {
  short_id: string;
  id_short: number;
  slug: string;
};

function resolveBaseUrl(origin?: string) {
  if (origin) return origin;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function getBoardMeta(uuid: string, origin?: string): Promise<BoardMetaResponse | null> {
  if (!uuid) return null;

  const baseUrl = resolveBaseUrl(origin);
  const url = new URL("/api/board-meta", baseUrl);
  url.searchParams.set("uuid", uuid);

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as BoardMetaResponse;
    if (!data?.short_id || typeof data.id_short !== "number" || !data.slug) {
      return null;
    }

    return data;
  } catch (error) {
    console.warn("[edge/get-board-meta] fetch failed:", error);
    return null;
  }
}
