ALTER TABLE `links` ADD `target_url` text;--> statement-breakpoint
ALTER TABLE `links` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `links` ADD `active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_links_category_sort` ON `links` (`category`,`sort_order`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `team_id` text;--> statement-breakpoint
CREATE INDEX `idx_rooms_team` ON `rooms` (`team_id`);