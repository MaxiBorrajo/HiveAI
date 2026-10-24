CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`alias` text NOT NULL,
	`last4` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
