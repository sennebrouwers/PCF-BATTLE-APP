import type { MetadataRoute } from "next";
import { getDatabase } from "@/lib/turso-db";

const baseUrl = "https://www.pcfbattle.be";

type PublishSettings = {
  show_tournament?: number;
  live_enabled?: number;
  show_matches?: number;
  show_standings?: number;
  show_brackets?: number;
  show_statistics?: number;
  show_livestream?: number;
  show_gallery?: number;
};

// Same visibility rules as the public pages (app/[[...slug]]/page.tsx), so the
// sitemap never points search engines at "not published yet" sections.
function publishedSections(t: PublishSettings) {
  const tournament = t.show_tournament !== 0;
  return [
    tournament && t.live_enabled !== 0 && t.show_matches !== 0 && "/tournament/live",
    tournament && t.show_matches !== 0 && "/tournament/schedule",
    tournament && t.show_standings !== 0 && "/tournament/standings",
    tournament && t.show_brackets !== 0 && "/tournament/brackets",
    tournament && t.show_statistics !== 0 && "/tournament/statistics",
    t.show_livestream === 1 && "/livestream",
    t.show_gallery === 1 && "/gallery",
  ].filter((route): route is string => Boolean(route));
}

async function activeTournamentSettings(): Promise<PublishSettings | null> {
  try {
    return await getDatabase()
      .prepare("SELECT show_tournament,live_enabled,show_matches,show_standings,show_brackets,show_statistics,show_livestream,show_gallery FROM tournaments WHERE active=1 LIMIT 1")
      .first<PublishSettings>();
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await activeTournamentSettings();
  // Without settings, list only the pages that are always public.
  const routes = ["/", "/about", "/faq", ...(settings ? publishedSections(settings) : [])];
  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" || route === "/tournament/live" || route === "/tournament/schedule" ? "daily" : "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
