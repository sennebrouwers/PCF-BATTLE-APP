ALTER TABLE `matches` ADD `clock_running` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `matches` ADD `clock_started_at` text;
