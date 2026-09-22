CREATE TYPE "public"."account_sync_status" AS ENUM('idle', 'running', 'completed', 'failed', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_match_evidence" AS ENUM('hash', 'supporting_signals', 'none', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_identity_type" AS ENUM('transaction', 'erc20_transfer', 'local_activity');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_state" AS ENUM('local_only', 'indexed', 'matched', 'confirmed', 'reverted', 'unknown', 'conflict', 'unresolved');--> statement-breakpoint
CREATE TABLE "account_sync_state" (
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"account_address" varchar(42) NOT NULL,
	"last_synchronized_block" bigint,
	"last_synchronized_at" timestamp with time zone,
	"status" "account_sync_status" NOT NULL,
	"last_error_code" varchar(64),
	"last_error_message" varchar(512),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_sync_state_identity" PRIMARY KEY("network_id","chain_id","account_address"),
	CONSTRAINT "account_sync_state_block_nonnegative" CHECK ("account_sync_state"."last_synchronized_block" is null or "account_sync_state"."last_synchronized_block" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"account_address" varchar(42) NOT NULL,
	"identity" varchar(180) NOT NULL,
	"identity_type" "reconciliation_identity_type" NOT NULL,
	"transaction_hash" varchar(66),
	"log_index" integer,
	"local_activity_id" varchar(128),
	"state" "reconciliation_state" NOT NULL,
	"match_evidence" "reconciliation_match_evidence" NOT NULL,
	"block_number" bigint,
	"block_hash" varchar(66),
	"observed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_log_index_nonnegative" CHECK ("reconciliation_records"."log_index" is null or "reconciliation_records"."log_index" >= 0),
	CONSTRAINT "reconciliation_block_nonnegative" CHECK ("reconciliation_records"."block_number" is null or "reconciliation_records"."block_number" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_scope_identity_idx" ON "reconciliation_records" USING btree ("network_id","chain_id","account_address","identity");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_scope_local_activity_idx" ON "reconciliation_records" USING btree ("network_id","chain_id","account_address","local_activity_id");