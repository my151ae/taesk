type TimeZonePart = Intl.DateTimeFormatPart | undefined;

const normalizeOffsetLabel = (raw: string): string => {
  const normalized = raw.replace("UTC", "GMT").trim();
  if (normalized === "GMT") return "GMT";

  const match = normalized.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return normalized;

  const sign = match[1] ?? "+";
  const hours = Number(match[2] ?? "0");
  const minutes = match[3] ?? "00";
  if (minutes === "00") {
    return `GMT${sign}${hours}`;
  }
  return `GMT${sign}${hours}:${minutes}`;
};

const timeZoneNamePart = (
  timeZone: string,
  timeZoneName: "short" | "shortOffset",
  date: Date
): TimeZonePart => {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName,
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName");
};

export type TimeZoneDisplay = {
  abbreviation: string;
  offset: string;
  label: string;
};

export const resolveTimeZoneDisplay = (
  timeZone: string,
  date: Date = new Date()
): TimeZoneDisplay => {
  const abbrRaw = timeZoneNamePart(timeZone, "short", date)?.value?.trim() || timeZone;
  const offsetRaw =
    timeZoneNamePart(timeZone, "shortOffset", date)?.value?.trim() || "GMT";
  const offset = normalizeOffsetLabel(offsetRaw);
  const abbreviation = abbrRaw.startsWith("GMT") ? timeZone : abbrRaw;
  return {
    abbreviation,
    offset,
    label: `${abbreviation} (${offset})`,
  };
};
