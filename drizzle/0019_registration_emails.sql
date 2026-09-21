ALTER TABLE `preregistrations` ADD `selected` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `preregistrations` ADD `registration_confirmation_sent_at` text;
--> statement-breakpoint
ALTER TABLE `preregistrations` ADD `selection_email_sent_at` text;
--> statement-breakpoint
ALTER TABLE `preregistrations` ADD `portal_invitation_sent_at` text;
