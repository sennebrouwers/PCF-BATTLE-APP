import type { MetadataRoute } from "next";

const baseUrl = "https://pcfbattle.be";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "/",
    "/about",
    "/faq",
    "/livestream",
    "/gallery",
    "/terms",
    "/privacy",
    "/cookies",
    "/accessibility",
    "/teams",
    "/matches",
    "/standings",
    "/brackets",
    "/statistics",
  ];
  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" || route === "/matches" ? "daily" : "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
