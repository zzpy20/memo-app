CREATE TABLE `memos` (
	`id` text PRIMARY KEY NOT NULL,
	`memo_id` text NOT NULL,
	`uid` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_file` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memos_memo_id_unique` ON `memos` (`memo_id`);