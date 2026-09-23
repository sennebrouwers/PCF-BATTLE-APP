import type { Metadata } from "next";

const baseUrl = "https://pcfbattle.be";
const defaultDescription =
  "Powerchair Floorball Battle brings teams together for high-level international powerchair floorball competition in an exciting arena atmosphere.";
const pageMetadata: Record<string, { title: string; description: string }> = {
  "/": {
    title: "PCF BATTLE | Powerchair Floorball Battle",
    description: defaultDescription,
  },
  "/about": {
    title: "Practical Information | PCF BATTLE",
    description: "Discover the venue, accommodation, tournament format and practical information for the Powerchair Floorball Battle in Leuven, Belgium.",
  },
  "/faq": {
    title: "FAQ | Powerchair Floorball Battle",
    description: "Find answers about registration, teams, accommodation, matches and the international Powerchair Floorball Battle.",
  },
  "/livestream": {
    title: "Watch PCF BATTLE Live | Powerchair Floorball",
    description: "Follow live Powerchair Floorball Battle matches, tournament updates and results from Leuven, Belgium.",
  },
  "/gallery": {
    title: "Gallery | Powerchair Floorball Battle",
    description: "See photos and highlights from the Powerchair Floorball Battle.",
  },
  "/terms": {
    title: "Terms & Conditions | PCF BATTLE",
    description: "Read the registration, participation, payment and cancellation terms for the Powerchair Floorball Battle.",
  },
  "/privacy": {
    title: "Privacy Policy | PCF BATTLE",
    description: "Read the privacy policy for the Powerchair Floorball Battle website and tournament platform.",
  },
  "/cookies": {
    title: "Cookie Policy | PCF BATTLE",
    description: "Read how cookies and similar technologies are used on the Powerchair Floorball Battle website.",
  },
  "/accessibility": {
    title: "Accessibility | PCF BATTLE",
    description: "Learn about accessibility at the Powerchair Floorball Battle website, venue and tournament.",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const slug = (await params).slug || [];
  const path = `/${slug.join("/")}`.replace(/\/$/, "") || "/";
  const metadata = pageMetadata[path] ||
    (path.startsWith("/teams/")
      ? {
          title: "Participating Team | PCF BATTLE",
          description: "Meet the teams, players and coaches taking part in the Powerchair Floorball Battle.",
        }
      : path.startsWith("/tournament/")
        ? {
            title: "Tournament Results & Schedule | PCF BATTLE",
            description: "Follow the Powerchair Floorball Battle schedule, standings, live matches and tournament bracket.",
          }
        : {
            title: "PCF BATTLE | Powerchair Floorball Battle",
            description: defaultDescription,
          });
  return {
    title: metadata.title,
    description: metadata.description,
    alternates: { canonical: `${baseUrl}${path === "/" ? "/" : path}` },
    openGraph: {
      title: metadata.title,
      description: metadata.description,
      url: `${baseUrl}${path === "/" ? "/" : path}`,
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
      name: "PCF BATTLE",
      url: baseUrl,
      logo: `${baseUrl}/PFB_Logo_Pink.svg`,
      email: "hello@pcfbattle.be",
    },
    {
      "@type": "SportsEvent",
      name: "Powerchair Floorball Battle",
      description: defaultDescription,
      url: baseUrl,
      startDate: "2027-05-01",
      endDate: "2027-05-02",
      location: {
        "@type": "Place",
        name: "Leuven, Belgium",
        address: { "@type": "PostalAddress", addressLocality: "Leuven", addressCountry: "BE" },
      },
      sport: "Powerchair Floorball",
      organizer: { "@type": "Organization", name: "PCF BATTLE", url: baseUrl },
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
