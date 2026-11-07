ALTER TABLE `chats` ADD `executionId` integer REFERENCES executions(id) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `chats` ADD `runKey` text;--> statement-breakpoint
CREATE INDEX `chats_execution_run_idx` ON `chats` (`executionId`,`runKey`);