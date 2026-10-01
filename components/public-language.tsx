"use client";

export type PublicLanguage = string;

export function usePublicLanguage() {
  return { language: "en" as PublicLanguage };
}

const englishCopy = {
    practical: "Practical",
    contact: "Contact",
    faq: "FAQ",
    tournament: "Tournament",
    livestream: "Livestream",
    media: "Media",
    practicalTitle: "Practical information",
    pcfTitle: "What is Powerchair Floorball Battle?",
    pcfText: "Powerchair Floorball Battle is an international powerchair floorball tournament bringing teams together for competitive matches in an energetic tournament environment.",
    faqTitle: "Frequently asked questions",
    faqIntro: "Find answers about PCF BATTLE and powerchair floorball tournaments.",
    language: "Language",
    closeMenu: "Close navigation menu", openMenu: "Open navigation menu", mainNavigation: "Main navigation",
    watchLive: "Watch live", schedule: "Schedule", standings: "Standings", brackets: "Brackets", statistics: "Statistics",
    participatingTeams: "Participating teams", teamsEmpty: "Participating teams will appear here once they are published.",
    referees: "Tournament referees", group: "Group", team: "Team", noLive: "No match is live right now.", comingUp: "Coming up",
    scheduleEmpty: "The match schedule has not been published yet.", openMaps: "Open in Google Maps", notPublished: "This section is not published yet.",
    tournamentSections: "Tournament sections", totalGoals: "Total goals", finishedMatches: "finished matches", matchesPlayed: "Matches played",
    playersWithGoals: "Players with goals", recordedGoalscorers: "recorded goalscorers", liveNow: "Live now", matches: "Matches",
    noGoals: "No player goals have been recorded yet.", livestreamIntro: "Watch the tournament live.", livestreamNotStarted: "The livestream has not started yet.",
    tournamentAssistant: "Tournament assistant", liveData: "LIVE DATA", liveMatches: "Live matches", send: "Send", question: "Question for tournament assistant",
    mediaIntro: "Photos and media from the tournament.", tournamentMedia: "Tournament media", closePhoto: "Close photo", previousPhoto: "Previous photo", nextPhoto: "Next photo",
    teamNotFound: "This team is not available.", teamSelection: "Team selection", noPlayers: "No players have been published yet.", scheduled: "scheduled", noTeamMatches: "No matches are scheduled for this team yet.", visitTeam: "Visit team website", live: "Live", viewLiveAction: "View live action", viewAllMatches: "View all matches", viewRankings: "View rankings", viewKnockout: "View knockout stage", practicalInformation: "Practical information", tournamentTag: "TOURNAMENT", liveTournament: "LIVE TOURNAMENT", registrationOpen: "REGISTRATION OPEN", registrationClosed: "REGISTRATION CLOSED", followTournament: "Scores, schedules, standings and brackets — everything you need to follow the tournament.", playoffs: "Play Offs", finals: "Finals", groupLabel: "Group",
    terms: "Terms & Conditions", privacy: "Privacy Policy", cookies: "Cookie Policy", accessibility: "Accessibility",
} as const;

// The public site is English-only. Keep the legacy shape for internal callers while
// making any stale language value resolve to the same English copy.
export const publicCopy: Record<string, typeof englishCopy> = { en: englishCopy };
