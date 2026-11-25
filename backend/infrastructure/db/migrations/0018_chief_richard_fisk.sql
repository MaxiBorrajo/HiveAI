PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_execution_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`executionId` integer NOT NULL,
	`iteration` integer NOT NULL,
	`result` text NOT NULL,
	`graphId` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`graphId`) REFERENCES `execution_graphs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- `version` held the id of the graph a run was made with. Keep it as `graphId` only
-- when that graph still exists and belongs to the same execution (older rows hold
-- the default 1, which is not a real reference).
INSERT INTO `__new_execution_history`("id", "executionId", "iteration", "result", "graphId", "createdAt")
SELECT "id", "executionId", "iteration", "result",
	CASE WHEN "version" IN (
		SELECT `g`.`id` FROM `execution_graphs` AS `g` WHERE `g`.`executionId` = `execution_history`.`executionId`
	) THEN "version" END,
	"createdAt"
FROM `execution_history`;--> statement-breakpoint
DROP TABLE `execution_history`;--> statement-breakpoint
ALTER TABLE `__new_execution_history` RENAME TO `execution_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;