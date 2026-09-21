CREATE TABLE `goal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text NOT NULL,
	`period` text,
	`clock` text,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_goal_events_match_created` ON `goal_events` (`match_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_goal_events_player` ON `goal_events` (`player_id`);--> statement-breakpoint
CREATE INDEX `idx_goal_events_team` ON `goal_events` (`team_id`);
