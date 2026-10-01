export type Tournament = {
  id: string;
  name?: string;
  active?: number;
  live_enabled?: number;
  show_tournament?: number;
  show_referees?: number;
  emergency_enabled?: number;
  emergency_message?: string;
  show_matches?: number;
  show_standings?: number;
  show_brackets?: number;
  show_statistics?: number;
  show_gallery?: number;
  show_about?: number;
  show_livestream?: number;
  registration_mode?: number;
  city?: string;
  livestream_url?: string;
  accessibility_info?: string;
  venue_name?: string;
  venue_address?: string;
  venue_image?: string;
  parking_info?: string;
  hotel_name?: string;
  hotel_address?: string;
  hotel_image?: string;
  hotel_checkin?: string;
  hotel_checkout?: string;
  hotel_accessibility_info?: string;
  hotel_info?: string;
  opening_hours?: string;
  catering_info?: string;
  visitor_info?: string;
  award_info?: string;
  format_rules?: string;
  instagram_url?: string;
  start_date?: string;
  end_date?: string;
  country?: string;
  [key: string]: unknown;
};

export type Team = {
  id: string;
  name: string;
  group_id?: string;
  color?: string;
  logo?: string;
  team_photo?: string;
  country?: string;
  description?: string;
  website?: string;
};

export type Match = {
  id: string;
  home_team_id?: string;
  away_team_id?: string;
  group_id?: string;
  status?: string;
  period?: string;
  home_score?: number;
  away_score?: number;
  match_date?: string;
  start_time?: string;
  court?: string;
  referee_ids?: string[];
  referee_names?: string[];
  clock?: string;
  clock_running?: number;
  clock_started_at?: string;
  version?: number;
  [key: string]: unknown;
};

export type StandingRow = {
  id: string;
  group_id?: string;
  name: string;
  played?: number;
  won?: number;
  drawn?: number;
  lost?: number;
  goalDifference?: number;
  points?: number;
  [key: string]: unknown;
};

export type PublicBracketData = {
  teams: Team[];
  matches: Match[];
  standings: StandingRow[];
  referees?: Referee[];
};

export type Referee = { id: string; name: string; country?: string };

export type PublicLink = {
  id: string;
  title?: string;
  url?: string;
  logo?: string;
  logo_light?: string;
  logo_dark?: string;
  category?: string;
  active?: number;
  sort_order?: number;
  target_url?: string;
  dark_url?: string;
};

export type PublicScheduleItem = {
  id: string;
  match_id?: string;
  match_date?: string;
  start_time?: string;
  court?: string;
  active?: number;
  sort_order?: number;
};

export type PublicPlayer = {
  id: string;
  team_id?: string;
  name: string;
  number?: number | string;
  photo?: string;
};

export type PublicScorer = {
  id?: string;
  name: string;
  goals?: number;
  team_name?: string;
  team_id?: string;
};

export type PublicData = {
  teams: Team[];
  matches: Match[];
  standings: StandingRow[];
  links: PublicLink[];
  brackets: Array<Record<string, unknown>>;
  tournaments: Tournament[];
  referees: Referee[];
  scorers: PublicScorer[];
  players: PublicPlayer[];
  schedule_items: PublicScheduleItem[];
  ready: boolean;
  error?: string;
  updatedAt: string | null;
};

export type ApiError = { error?: string; conflicts?: Array<{ message?: string }> };

export function errorMessage(error: unknown, fallback = "Something went wrong") {
  return error instanceof Error ? error.message : fallback;
}
