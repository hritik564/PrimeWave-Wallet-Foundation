CREATE TYPE "public"."notification_delivery_state" AS ENUM('pending', 'sending', 'sent', 'delivered', 'failed', 'disabled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_environment" AS ENUM('development', 'testnet', 'mainnet');--> statement-breakpoint
CREATE TYPE "public"."notification_event_type" AS ENUM('transaction_confirmed', 'transaction_reverted', 'incoming_transaction', 'swap_completed', 'security_event');--> statement-breakpoint
CREATE TYPE "public"."notification_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_event_id" varchar(128) NOT NULL,
	"registration_id" varchar(128) NOT NULL,
	"state" "notification_delivery_state" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_id" varchar(64),
	"provider_message_id" varchar(256),
	"last_error_code" varchar(64),
	"last_error_message" varchar(512),
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_attempt_count_nonnegative" CHECK ("notification_deliveries"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_devices" (
	"registration_id" varchar(128) PRIMARY KEY NOT NULL,
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"account_address" varchar(42) NOT NULL,
	"device_identifier" varchar(128) NOT NULL,
	"platform" "notification_platform" NOT NULL,
	"push_token" varchar(512) NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"environment" "notification_environment" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_delivery_at" timestamp with time zone,
	CONSTRAINT "notification_devices_chain_id_positive" CHECK ("notification_devices"."chain_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"notification_event_id" varchar(128) PRIMARY KEY NOT NULL,
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"account_address" varchar(42) NOT NULL,
	"event_type" "notification_event_type" NOT NULL,
	"transaction_hash" varchar(66),
	"log_index" integer,
	"asset_descriptor" varchar(256),
	"amount_raw" varchar(80),
	"counterparty_address" varchar(42),
	"event_timestamp" timestamp with time zone NOT NULL,
	"source" varchar(64) NOT NULL,
	"deduplication_key" varchar(256) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_events_chain_id_positive" CHECK ("notification_events"."chain_id" > 0),
	CONSTRAINT "notification_events_log_index_nonnegative" CHECK ("notification_events"."log_index" is null or "notification_events"."log_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"network_id" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"account_address" varchar(42) NOT NULL,
	"transaction_confirmations" boolean DEFAULT false NOT NULL,
	"incoming_transactions" boolean DEFAULT false NOT NULL,
	"transaction_failures" boolean DEFAULT false NOT NULL,
	"swaps" boolean DEFAULT false NOT NULL,
	"security_events" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_chain_id_positive" CHECK ("notification_preferences"."chain_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_event_registration_idx" ON "notification_deliveries" USING btree ("notification_event_id","registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_devices_scope_identifier_idx" ON "notification_devices" USING btree ("network_id","chain_id","account_address","device_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_events_scope_deduplication_idx" ON "notification_events" USING btree ("network_id","chain_id","account_address","deduplication_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_scope_idx" ON "notification_preferences" USING btree ("network_id","chain_id","account_address");