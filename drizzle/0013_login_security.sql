CREATE TABLE IF NOT EXISTS `login_attempts` (
	`identifier` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_login_attempts_updated` ON `login_attempts` (`updated_at`);
