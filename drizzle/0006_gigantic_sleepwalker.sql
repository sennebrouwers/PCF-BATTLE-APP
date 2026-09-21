ALTER TABLE `tournaments` ADD `registration_mode` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `show_teams` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `show_matches` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `show_standings` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `show_brackets` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `show_statistics` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `public_message` text;