ALTER TABLE `teams` ADD `team_photo` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_by_sender` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_by_recipient` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `live_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `opening_hours` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `hotel_name` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `hotel_address` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `venue_name` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `venue_address` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `parking_info` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `accessibility_info` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `catering_info` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `award_info` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `visitor_info` text;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `chatbot_knowledge` text;--> statement-breakpoint
ALTER TABLE `users` ADD `country` text;--> statement-breakpoint
ALTER TABLE `users` ADD `photo` text;
