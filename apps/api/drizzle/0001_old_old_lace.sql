CREATE TABLE `agent_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text DEFAULT 'ollama' NOT NULL,
	`model` text DEFAULT 'llama3.1:8b' NOT NULL,
	`api_key` text,
	`ollama_url` text DEFAULT 'http://localhost:11434',
	`system_prompt` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP',
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`content` text NOT NULL,
	`category` text,
	`source` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text,
	`provider` text,
	`tool_name` text,
	`tool_args` text,
	`tool_result` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_config_user_id_unique` ON `agent_config` (`user_id`);