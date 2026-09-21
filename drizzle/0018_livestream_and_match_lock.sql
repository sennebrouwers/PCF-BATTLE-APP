ALTER TABLE `tournaments` ADD `show_livestream` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `tournaments` ADD `livestream_url` text;
--> statement-breakpoint
ALTER TABLE `matches` ADD `confirmed` integer DEFAULT 0 NOT NULL;
