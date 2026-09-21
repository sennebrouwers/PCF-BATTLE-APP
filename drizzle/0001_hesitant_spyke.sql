CREATE INDEX `idx_delegation_team_role` ON `delegation_members` (`team_id`,`role`);--> statement-breakpoint
CREATE INDEX `idx_matches_status_start` ON `matches` (`status`,`start_time`);--> statement-breakpoint
CREATE INDEX `idx_matches_home_team` ON `matches` (`home_team_id`);--> statement-breakpoint
CREATE INDEX `idx_matches_away_team` ON `matches` (`away_team_id`);--> statement-breakpoint
CREATE INDEX `idx_room_assignments_room` ON `room_assignments` (`room_id`);--> statement-breakpoint
PRAGMA optimize;
