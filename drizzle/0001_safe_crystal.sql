CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `memos` ADD `share_token` text;