CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_user_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_recipient_created` ON `messages` (`recipient_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_sender_created` ON `messages` (`sender_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `organization_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`email` text,
	`phone` text NOT NULL,
	`emergency` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_organization_contacts_sort` ON `organization_contacts` (`sort_order`);