CREATE TABLE `preregistrations` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`club_name` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_preregistrations_tournament_email` ON `preregistrations` (`tournament_id`,`email`);--> statement-breakpoint
ALTER TABLE `tournaments` ADD `registration_enabled` integer DEFAULT 1 NOT NULL;