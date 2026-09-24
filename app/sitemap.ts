import type { MetadataRoute } from "next";

const baseUrl = "https://www.pcfbattle.be";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "/",
    "/about",
    "/faq",
    "/livestream",
    "/gallery",
    "/tournament/live",
    "/tournament/schedule",
    "/tournament/standings",
    "/tournament/brackets",
    "/tournament/statistics",
  ];
  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" || route === "/tournament/live" || route === "/tournament/schedule" ? "daily" : "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
