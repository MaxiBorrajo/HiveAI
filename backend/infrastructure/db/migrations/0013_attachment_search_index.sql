CREATE TABLE `attachment_chunks` (
	`attachmentId` integer NOT NULL,
	`chunkIndex` integer NOT NULL,
	`startChar` integer NOT NULL,
	`text` text NOT NULL,
	`vector` text NOT NULL,
	PRIMARY KEY(`attachmentId`, `chunkIndex`),
	FOREIGN KEY (`attachmentId`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `attachments` ADD `indexedAt` integer;