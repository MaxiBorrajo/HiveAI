CREATE TABLE `plugin_config` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_name` text NOT NULL,
	`key` text NOT NULL,
	`last4` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
