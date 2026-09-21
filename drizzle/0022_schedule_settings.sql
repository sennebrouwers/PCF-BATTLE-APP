ALTER TABLE `tournaments` ADD `schedule_start_time` text DEFAULT '09:00';
ALTER TABLE `tournaments` ADD `schedule_changeover_minutes` integer DEFAULT 5;
ALTER TABLE `tournaments` ADD `schedule_half_duration_minutes` integer DEFAULT 20;
