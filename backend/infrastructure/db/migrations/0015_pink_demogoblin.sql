CREATE TABLE `chat_compared_runs` (
	`chatId` integer NOT NULL,
	`historyId` integer NOT NULL,
	PRIMARY KEY(`chatId`, `historyId`),
	FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`historyId`) REFERENCES `execution_history`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedule_days` (
	`scheduleId` integer NOT NULL,
	`dayOfWeek` integer NOT NULL,
	PRIMARY KEY(`scheduleId`, `dayOfWeek`),
	FOREIGN KEY (`scheduleId`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Move the existing list/CSV values into the new tables before dropping them.
INSERT INTO `schedule_days` (`scheduleId`, `dayOfWeek`)
SELECT DISTINCT `schedules`.`id`, CAST(`j`.`value` AS integer)
FROM `schedules`, json_each(`schedules`.`daysOfWeek`) AS `j`;--> statement-breakpoint
WITH RECURSIVE `split`(`chatId`, `id`, `rest`) AS (
	SELECT `id`, NULL, `runKey` || ',' FROM `chats`
	WHERE `runKey` IS NOT NULL AND `runKey` <> ''
	UNION ALL
	SELECT `chatId`,
		CAST(substr(`rest`, 1, instr(`rest`, ',') - 1) AS integer),
		substr(`rest`, instr(`rest`, ',') + 1)
	FROM `split` WHERE `rest` <> ''
)
INSERT OR IGNORE INTO `chat_compared_runs` (`chatId`, `historyId`)
SELECT `chatId`, `id` FROM `split`
WHERE `id` IS NOT NULL
	AND `id` IN (SELECT `id` FROM `execution_history`);--> statement-breakpoint
DROP INDEX `chats_execution_run_idx`;--> statement-breakpoint
CREATE INDEX `chats_execution_idx` ON `chats` (`executionId`);--> statement-breakpoint
ALTER TABLE `chats` DROP COLUMN `runKey`;--> statement-breakpoint
ALTER TABLE `schedules` DROP COLUMN `daysOfWeek`;