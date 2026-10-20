CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chatId` integer,
	`messageId` integer,
	`executionId` integer,
	`executionHistoryId` integer,
	`direction` text NOT NULL,
	`originalName` text NOT NULL,
	`mimeType` text NOT NULL,
	`sizeBytes` integer NOT NULL,
	`storagePath` text NOT NULL,
	`extractedTextPath` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`executionId`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`executionHistoryId`) REFERENCES `execution_history`(`id`) ON UPDATE no action ON DELETE cascade
);
