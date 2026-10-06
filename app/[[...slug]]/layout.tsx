import type { Metadata } from "next";
import { defaultDescription, getPageMetadata } from "@/lib/page-metadata";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/public-organization";

const baseUrl = "https://www.pcfbattle.be";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const slug = (await params).slug || [];
  const path = `/${slug.join("/")}`.replace(/\/$/, "") || "/";
  const canonicalPath = path === "/about" ? "/practical" : path;
  const metadata = getPageMetadata(path);
  const privatePage = [
    "/terms",
    "/privacy",
    "/cookies",
    "/accessibility",
    "/login",
    "/signup",
    "/admin",
  ].includes(path) || path === "/signup" || path.startsWith("/signup/") ||
  ["/my-team", "/referee", "/scoreboard"].some((route) => path === route || path.startsWith(route + "/"));
  return {
    title: metadata.title,
    description: metadata.description,
    robots: privatePage ? { index: false, follow: false } : undefined,
    alternates: {
      canonical: `${baseUrl}${canonicalPath === "/" ? "/" : canonicalPath}`,
    },
    openGraph: {
      title: metadata.title,
      description: metadata.description,
      url: `${baseUrl}${canonicalPath === "/" ? "/" : canonicalPath}`,
      siteName: "PCF BATTLE",
      type: "website",
      images: [{ url: "/pcf-social-graph.jpg", width: 2048, height: 1075, alt: "Powerchair Floorball Battle" }],
    },
    twitter: {
      card: "summary_large_image",
      title: metadata.title,
      description: metadata.description,
      images: ["/pcf-social-graph.jpg"],
    },
  };
}

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${baseUrl}/#organization`,
      name: "PCF BATTLE",
      url: baseUrl,
      logo: `${baseUrl}/PFB_Logo_Pink.svg`,
      email: PUBLIC_CONTACT_EMAIL,
    },
    {
      "@type": "WebSite",
      "@id": `${baseUrl}/#website`,
      url: baseUrl,
      name: "PCF BATTLE | Powerchair Floorball Battle",
      description: defaultDescription,
      publisher: { "@id": `${baseUrl}/#organization` },
    },
  ],
};

export default function PublicSeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      {children}
    </>
  );
}
