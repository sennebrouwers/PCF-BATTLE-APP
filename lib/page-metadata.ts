// Per-page titles and descriptions, shared by the server metadata
// (app/[[...slug]]/layout.tsx) and the client-side title update in page.tsx,
// so both always agree.

export const defaultDescription =
  "Powerchair Floorball Battle brings teams together for high-level international powerchair floorball competition in an exciting arena atmosphere.";

type PageMetadata = { title: string; description: string };

const tournamentDescription = "Follow the Powerchair Floorball Battle schedule, standings, live matches and tournament bracket.";

const pageMetadata: Record<string, PageMetadata> = {
  "/": {
    title: "PCF BATTLE | Powerchair Floorball Battle",
    description: defaultDescription,
  },
  "/about": {
    title: "Practical Information | PCF BATTLE",
    description: "Discover the venue, accommodation, tournament format and practical information for the Powerchair Floorball Battle in Leuven, Belgium.",
  },
  "/practical": {
    title: "Practical Information | PCF BATTLE",
    description: "Discover the venue, accommodation, tournament format and practical information for the Powerchair Floorball Battle in Leuven, Belgium.",
  },
  "/contact": {
    title: "Contact | Powerchair Floorball Battle",
    description: "Contact the Powerchair Floorball Battle organisation or follow PCF BATTLE on social media.",
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
    title: "Media | Powerchair Floorball Battle",
    description: "See photos and highlights from the Powerchair Floorball Battle.",
  },
  "/tournament/live": { title: "Live Matches | PCF BATTLE", description: tournamentDescription },
  "/tournament/schedule": { title: "Match Schedule | PCF BATTLE", description: tournamentDescription },
  "/tournament/standings": { title: "Standings | PCF BATTLE", description: tournamentDescription },
  "/tournament/brackets": { title: "Tournament Bracket | PCF BATTLE", description: tournamentDescription },
  "/tournament/statistics": { title: "Statistics | PCF BATTLE", description: tournamentDescription },
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
  "/login": {
    title: "Sign In | PCF BATTLE",
    description: "Sign in to the PCF BATTLE team, referee or administrator portal.",
  },
  "/signup": {
    title: "Create Your Team Login | PCF BATTLE",
    description: "Create a team portal account with your PCF BATTLE invitation.",
  },
};

export function getPageMetadata(path: string): PageMetadata {
  if (pageMetadata[path]) return pageMetadata[path];
  if (path.startsWith("/teams/")) {
    return {
      title: "Participating Team | PCF BATTLE",
      description: "Meet the teams, players and coaches taking part in the Powerchair Floorball Battle.",
    };
  }
  return { title: "PCF BATTLE | Powerchair Floorball Battle", description: defaultDescription };
}
