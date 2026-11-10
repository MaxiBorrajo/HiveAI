CREATE TABLE `schedule_runs` (
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
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executionId` integer NOT NULL,
	`frequency` text NOT NULL,
	`timeOfDay` text NOT NULL,
	`daysOfWeek` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`nextRunAt` integer NOT NULL,
	`lastRunAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
