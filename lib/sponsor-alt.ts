/** Accessible names for approved sponsor logos; other sponsors keep their supplied names. */
export function sponsorAlt(title?: string, url?: string): string {
  const value = `${title || ""} ${url || ""}`.toLowerCase();
  if (/sponsor-g10(?:\\.|\\b)|\\bsportoase\\b/.test(value)) return "Sportoase logo";
  if (/sponsor-leuven(?:\\.|\\b)|\\bcity of leuven\\b|\\bstad leuven\\b/.test(value)) return "City of Leuven logo";
  if (/sponsor-parkinn(?:\\.|\\b)|park inn/.test(value)) return "Park Inn by Radisson logo";
  if (/sponsor-sportvlaanderen(?:\\.|\\b)|sport vlaanderen/.test(value)) return "Sport Vlaanderen logo";
  return title?.trim() || "Tournament sponsor";
}
