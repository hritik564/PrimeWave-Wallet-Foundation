CREATE TYPE "public"."indexed_transaction_status" AS ENUM('success', 'reverted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."indexing_status" AS ENUM('disabled', 'idle', 'running', 'completed', 'failed', 'reorg_detected');--> statement-breakpoint
CREATE TABLE "indexed_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"parent_hash" varchar(66) NOT NULL,
	"timestamp" bigint NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_blocks_number_nonnegative" CHECK ("indexed_blocks"."block_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "indexed_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"transaction_index" integer NOT NULL,
	"log_index" integer NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"topics" jsonb NOT NULL,
	"data" varchar(262146) NOT NULL,
	"timestamp" bigint NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_logs_index_nonnegative" CHECK ("indexed_logs"."log_index" >= 0 and "indexed_logs"."transaction_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "indexed_token_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"token_contract_address" varchar(42) NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"amount_raw" varchar(80) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"timestamp" bigint NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_token_transfers_log_index_nonnegative" CHECK ("indexed_token_transfers"."log_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "indexed_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"transaction_index" integer NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42),
	"value" varchar(80) NOT NULL,
	"gas" varchar(80) NOT NULL,
	"gas_price" varchar(80),
	"max_fee_per_gas" varchar(80),
	"max_priority_fee_per_gas" varchar(80),
	"nonce" varchar(80) NOT NULL,
	"input" varchar(262146) NOT NULL,
	"transaction_type" varchar(32),
	"timestamp" bigint NOT NULL,
	"status" "indexed_transaction_status" NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_transactions_index_nonnegative" CHECK ("indexed_transactions"."transaction_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"network_id" varchar(64) PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"last_successful_block" bigint,
	"latest_observed_block" bigint,
	"status" "indexing_status" NOT NULL,
	"last_successful_run" timestamp with time zone,
	"last_error_code" varchar(64),
	"last_error_message" varchar(512),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_blocks_identity_idx" ON "indexed_blocks" USING btree ("network_id","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_blocks_hash_idx" ON "indexed_blocks" USING btree ("network_id","block_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_logs_identity_idx" ON "indexed_logs" USING btree ("network_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_token_transfers_identity_idx" ON "indexed_token_transfers" USING btree ("network_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_transactions_identity_idx" ON "indexed_transactions" USING btree ("network_id","transaction_hash");