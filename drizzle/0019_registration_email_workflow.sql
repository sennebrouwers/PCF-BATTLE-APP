ALTER TABLE `preregistrations` ADD `status` text DEFAULT 'registered' NOT NULL;
--> statement-breakpoint
ALTER TABLE `preregistrations` ADD `confirmation_sent_at` text;
--> statement-breakpoint
ALTER TABLE `preregistrations` ADD `selection_sent_at` text;
--> statement-breakpoint
ALTER TABLE `preregistrations` ADD `portal_invite_sent_at` text;
