CREATE TABLE `execution_rubrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executionId` integer NOT NULL,
	`version` integer NOT NULL,
	`rubric` text NOT NULL,
	`reference` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_rubrics_execution_version_idx` ON `execution_rubrics` (`executionId`,`version`);--> statement-breakpoint
CREATE TABLE `run_grades` (
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
	FOREIGN KEY (`rubricId`) REFERENCES `execution_rubrics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_grades_run_rubric_judge_idx` ON `run_grades` (`historyId`,`rubricId`,`judgeProvider`,`judgeModel`);