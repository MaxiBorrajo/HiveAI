PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- The new foreign keys cannot point at rows that are already gone: forget those ids first.
UPDATE `execution_graphs` SET `orchestratorKeyId` = NULL WHERE `orchestratorKeyId` IS NOT NULL AND `orchestratorKeyId` NOT IN (SELECT `id` FROM `api_keys`);--> statement-breakpoint
UPDATE `model_usage` SET `key_id` = NULL WHERE `key_id` IS NOT NULL AND `key_id` NOT IN (SELECT `id` FROM `api_keys`);--> statement-breakpoint
UPDATE `run_grades` SET `judgeKeyId` = NULL WHERE `judgeKeyId` IS NOT NULL AND `judgeKeyId` NOT IN (SELECT `id` FROM `api_keys`);--> statement-breakpoint
UPDATE `schedule_runs` SET `historyId` = NULL WHERE `historyId` IS NOT NULL AND `historyId` NOT IN (SELECT `id` FROM `execution_history`);--> statement-breakpoint
CREATE TABLE `__new_execution_graphs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executionId` integer NOT NULL,
	`graph` text NOT NULL,
	`state` text NOT NULL,
	`orchestratorProvider` text,
	`orchestratorModel` text,
	`orchestratorKeyId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`orchestratorKeyId`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_execution_graphs`("id", "executionId", "graph", "state", "orchestratorProvider", "orchestratorModel", "orchestratorKeyId", "createdAt") SELECT "id", "executionId", "graph", "state", "orchestratorProvider", "orchestratorModel", "orchestratorKeyId", "createdAt" FROM `execution_graphs`;--> statement-breakpoint
DROP TABLE `execution_graphs`;--> statement-breakpoint
ALTER TABLE `__new_execution_graphs` RENAME TO `execution_graphs`;--> statement-breakpoint
CREATE TABLE `__new_model_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` text NOT NULL,
	`context_kind` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`location` text NOT NULL,
	`role` text NOT NULL,
	`key_id` text,
	`key_alias` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`reasoning_tokens` integer,
	`duration_ms` integer NOT NULL,
	`ttft_ms` integer,
	`status` text NOT NULL,
	`error_type` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_model_usage`("id", "group_id", "context_kind", "provider", "model", "location", "role", "key_id", "key_alias", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "duration_ms", "ttft_ms", "status", "error_type", "created_at") SELECT "id", "group_id", "context_kind", "provider", "model", "location", "role", "key_id", "key_alias", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "duration_ms", "ttft_ms", "status", "error_type", "created_at" FROM `model_usage`;--> statement-breakpoint
DROP TABLE `model_usage`;--> statement-breakpoint
ALTER TABLE `__new_model_usage` RENAME TO `model_usage`;--> statement-breakpoint
CREATE INDEX `model_usage_group_id_idx` ON `model_usage` (`group_id`);--> statement-breakpoint
CREATE INDEX `model_usage_created_at_idx` ON `model_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `model_usage_key_id_idx` ON `model_usage` (`key_id`);--> statement-breakpoint
CREATE INDEX `model_usage_provider_model_idx` ON `model_usage` (`provider`,`model`);--> statement-breakpoint
CREATE TABLE `__new_run_grades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`historyId` integer NOT NULL,
	`rubricId` integer NOT NULL,
	`judgeProvider` text NOT NULL,
	`judgeModel` text NOT NULL,
	`judgeKeyId` text,
	`judgeVersion` integer NOT NULL,
	`status` text NOT NULL,
	`score` integer,
	`reasoning` text,
	`error` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`historyId`) REFERENCES `execution_history`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rubricId`) REFERENCES `execution_rubrics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`judgeKeyId`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_run_grades`("id", "historyId", "rubricId", "judgeProvider", "judgeModel", "judgeKeyId", "judgeVersion", "status", "score", "reasoning", "error", "createdAt") SELECT "id", "historyId", "rubricId", "judgeProvider", "judgeModel", "judgeKeyId", "judgeVersion", "status", "score", "reasoning", "error", "createdAt" FROM `run_grades`;--> statement-breakpoint
DROP TABLE `run_grades`;--> statement-breakpoint
ALTER TABLE `__new_run_grades` RENAME TO `run_grades`;--> statement-breakpoint
CREATE UNIQUE INDEX `run_grades_run_rubric_judge_idx` ON `run_grades` (`historyId`,`rubricId`,`judgeProvider`,`judgeModel`);--> statement-breakpoint
CREATE TABLE `__new_schedule_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheduleId` integer NOT NULL,
	`executionId` integer NOT NULL,
	`scheduledFor` integer NOT NULL,
	`status` text NOT NULL,
	`historyId` integer,
	`missedCount` integer DEFAULT 0 NOT NULL,
	`error` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`startedAt` integer NOT NULL,
	`finishedAt` integer,
	FOREIGN KEY (`scheduleId`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`historyId`) REFERENCES `execution_history`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_schedule_runs`("id", "scheduleId", "executionId", "scheduledFor", "status", "historyId", "missedCount", "error", "acknowledged", "startedAt", "finishedAt") SELECT "id", "scheduleId", "executionId", "scheduledFor", "status", "historyId", "missedCount", "error", "acknowledged", "startedAt", "finishedAt" FROM `schedule_runs`;--> statement-breakpoint
DROP TABLE `schedule_runs`;--> statement-breakpoint
ALTER TABLE `__new_schedule_runs` RENAME TO `schedule_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
