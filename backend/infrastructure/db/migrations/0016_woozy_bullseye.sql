ALTER TABLE `execution_graphs` ADD `orchestratorProvider` text;--> statement-breakpoint
ALTER TABLE `execution_graphs` ADD `orchestratorModel` text;--> statement-breakpoint
ALTER TABLE `execution_graphs` ADD `orchestratorKeyId` text;--> statement-breakpoint
UPDATE `execution_graphs` SET
	`orchestratorProvider` = json_extract(`orchestrator`, '$.provider'),
	`orchestratorModel` = json_extract(`orchestrator`, '$.model'),
	`orchestratorKeyId` = json_extract(`orchestrator`, '$.keyId')
WHERE `orchestrator` IS NOT NULL AND json_valid(`orchestrator`);--> statement-breakpoint
ALTER TABLE `execution_graphs` DROP COLUMN `orchestrator`;