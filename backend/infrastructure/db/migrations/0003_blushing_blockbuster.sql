CREATE TABLE `chat_usage` (
	`usage_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer,
	FOREIGN KEY (`usage_id`) REFERENCES `model_usage`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_usage_usage_id_idx` ON `chat_usage` (`usage_id`);--> statement-breakpoint
CREATE INDEX `chat_usage_chat_id_idx` ON `chat_usage` (`chat_id`);--> statement-breakpoint
CREATE INDEX `chat_usage_message_id_idx` ON `chat_usage` (`message_id`);--> statement-breakpoint
CREATE TABLE `execution_usage` (
	`usage_id` integer NOT NULL,
	`execution_id` integer NOT NULL,
	`history_id` integer,
	`node_id` text,
	FOREIGN KEY (`usage_id`) REFERENCES `model_usage`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`history_id`) REFERENCES `execution_history`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_usage_usage_id_idx` ON `execution_usage` (`usage_id`);--> statement-breakpoint
CREATE INDEX `execution_usage_execution_id_idx` ON `execution_usage` (`execution_id`);--> statement-breakpoint
CREATE INDEX `execution_usage_history_id_idx` ON `execution_usage` (`history_id`);--> statement-breakpoint
CREATE TABLE `generation_usage` (
	`usage_id` integer NOT NULL,
	`execution_id` integer,
	FOREIGN KEY (`usage_id`) REFERENCES `model_usage`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_usage_usage_id_idx` ON `generation_usage` (`usage_id`);--> statement-breakpoint
CREATE INDEX `generation_usage_execution_id_idx` ON `generation_usage` (`execution_id`);--> statement-breakpoint
CREATE TABLE `model_usage` (
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_usage_group_id_idx` ON `model_usage` (`group_id`);--> statement-breakpoint
CREATE INDEX `model_usage_created_at_idx` ON `model_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `model_usage_key_id_idx` ON `model_usage` (`key_id`);--> statement-breakpoint
CREATE INDEX `model_usage_provider_model_idx` ON `model_usage` (`provider`,`model`);