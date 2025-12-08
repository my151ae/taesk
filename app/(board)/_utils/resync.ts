// Lightweight Jaro-Winkler (duplicate of API impl for client-side quick scoring if needed)
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t = t / 2;

  const m = matches;
  const jaro = (m / len1 + m / len2 + (m - t) / m) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

export type ResyncCandidate = {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  calendarId?: string | null;
  htmlLink?: string | null;
  score?: number;
};

export async function fetchResyncCandidates(params: { title: string; start?: string; end?: string }) {
  const search = new URLSearchParams();
  search.set("title", params.title);
  if (params.start) search.set("start", params.start);
  if (params.end) search.set("end", params.end);
  const res = await fetch(`/api/calendar/resync-candidates?${search.toString()}`);
  if (!res.ok) return [] as ResyncCandidate[];
  const body = await res.json().catch(() => null);
  return (body?.candidates as ResyncCandidate[] | undefined) ?? [];
}
