import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/my-team", "/referee", "/scoreboard"] }],
    sitemap: "https://pcfbattle.be/sitemap.xml",
    host: "https://pcfbattle.be",
  };
}
