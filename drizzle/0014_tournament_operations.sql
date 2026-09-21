ALTER TABLE `delegation_members` ADD `privacy_consent` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `delegation_members` ADD `photo_consent` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `delegation_members` ADD `emergency_contact` text;
--> statement-breakpoint
ALTER TABLE `delegation_members` ADD `medical_notes` text;
--> statement-breakpoint
CREATE TABLE `match_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`team_id` text,
	`player_id` text,
	`type` text NOT NULL,
	`period` text,
	`clock` text,
	`details` text,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `match_events_match_id_idx` ON `match_events` (`match_id`);
