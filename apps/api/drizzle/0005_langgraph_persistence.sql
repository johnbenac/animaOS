CREATE TABLE `agent_threads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `thread_id` text NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP',
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_threads_user_id_unique` ON `agent_threads` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_threads_thread_id_unique` ON `agent_threads` (`thread_id`);
--> statement-breakpoint

CREATE TABLE `langgraph_checkpoints` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `thread_id` text NOT NULL,
  `checkpoint_ns` text DEFAULT '' NOT NULL,
  `checkpoint_id` text NOT NULL,
  `parent_checkpoint_id` text,
  `checkpoint` text NOT NULL,
  `metadata` text NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `langgraph_checkpoints_thread_ns_id_unique` ON `langgraph_checkpoints` (`thread_id`, `checkpoint_ns`, `checkpoint_id`);
--> statement-breakpoint
CREATE INDEX `langgraph_checkpoints_thread_ns_idx` ON `langgraph_checkpoints` (`thread_id`, `checkpoint_ns`);
--> statement-breakpoint

CREATE TABLE `langgraph_writes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `thread_id` text NOT NULL,
  `checkpoint_ns` text DEFAULT '' NOT NULL,
  `checkpoint_id` text NOT NULL,
  `task_id` text NOT NULL,
  `idx` integer NOT NULL,
  `channel` text NOT NULL,
  `value` text NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `langgraph_writes_unique` ON `langgraph_writes` (`thread_id`, `checkpoint_ns`, `checkpoint_id`, `task_id`, `idx`);
--> statement-breakpoint
CREATE INDEX `langgraph_writes_lookup_idx` ON `langgraph_writes` (`thread_id`, `checkpoint_ns`, `checkpoint_id`);
