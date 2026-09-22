CREATE TABLE `execution_graphs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executionId` integer NOT NULL,
	`graph` text NOT NULL,
	`state` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `execution_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executionId` integer NOT NULL,
	`iteration` integer NOT NULL,
	`result` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`lastResultId` integer,
	`lastGraphId` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`lastResultId`) REFERENCES `execution_history`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lastGraphId`) REFERENCES `execution_graphs`(`id`) ON UPDATE no action ON DELETE no action
);
