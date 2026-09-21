CREATE TABLE `schedule_items` (
  `id` text PRIMARY KEY NOT NULL,
  `tournament_id` text NOT NULL,
  `item_type` text NOT NULL,
  `match_id` text,
  `label` text,
  `match_date` text,
  `start_time` text,
  `duration_minutes` integer,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `idx_schedule_items_tournament_order` ON `schedule_items` (`tournament_id`,`sort_order`);
