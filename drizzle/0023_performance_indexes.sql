CREATE INDEX IF NOT EXISTS `idx_matches_tournament_schedule` ON `matches` (`tournament_id`,`match_date`,`start_time`);
CREATE INDEX IF NOT EXISTS `idx_matches_tournament_group` ON `matches` (`tournament_id`,`group_id`);
CREATE INDEX IF NOT EXISTS `idx_schedule_items_match` ON `schedule_items` (`match_id`);
