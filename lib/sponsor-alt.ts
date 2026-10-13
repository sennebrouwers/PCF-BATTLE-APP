/** Accessible names for approved sponsor logos; other sponsors keep their supplied names. */
export function sponsorAlt(title?: string, url?: string): string {
  const value = `${title || ""} ${url || ""}`.toLowerCase();
  if (value.includes("sponsor-g10.") || value.includes("sportoase")) return "Sportoase logo";
  if (value.includes("sponsor-leuven.") || value.includes("city of leuven") || value.includes("stad leuven")) return "City of Leuven logo";
  if (value.includes("sponsor-parkinn.") || value.includes("park inn")) return "Park Inn by Radisson logo";
  if (value.includes("sponsor-sportvlaanderen.") || value.includes("sport vlaanderen")) return "Sport Vlaanderen logo";
  return title?.trim() || "Tournament sponsor";
}
