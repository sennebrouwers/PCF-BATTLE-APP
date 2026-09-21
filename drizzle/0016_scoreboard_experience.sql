ALTER TABLE `tournaments` ADD `match_duration_minutes` integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
ALTER TABLE `tournaments` ADD `halftime_duration_minutes` integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE `tournaments` ADD `scoreboard_background` text DEFAULT '#100d12' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tournaments` ADD `scoreboard_accent` text DEFAULT '#f72585' NOT NULL;
--> statement-breakpoint
ALTER TABLE `tournaments` ADD `scoreboard_logo_scale` integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
ALTER TABLE `tournaments` ADD `scoreboard_show_sponsors` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `matches` ADD `scoreboard_mode` text DEFAULT 'scoreboard' NOT NULL;
