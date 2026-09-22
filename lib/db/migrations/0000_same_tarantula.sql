CREATE TYPE "public"."discovery_status" AS ENUM('not_discovered', 'user_declared', 'observed');--> statement-breakpoint
CREATE TYPE "public"."freshness_status" AS ENUM('fresh', 'cached', 'stale', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."metadata_provenance" AS ENUM('verified_provider', 'user_provided', 'registry', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."metadata_status" AS ENUM('available', 'partial', 'invalid', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."network_configuration_status" AS ENUM('configured', 'unavailable', 'placeholder');--> statement-breakpoint
CREATE TYPE "public"."network_environment" AS ENUM('development', 'testnet', 'mainnet');--> statement-breakpoint
CREATE TYPE "public"."trust_status" AS ENUM('unassessed', 'review_required', 'not_trusted');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."visibility_status" AS ENUM('public', 'hidden');--> statement-breakpoint
CREATE TABLE "public_network_metadata" (
	"network_id" varchar(64) PRIMARY KEY NOT NULL,
	"chain_id" integer,
	"display_name" varchar(120) NOT NULL,
	"native_currency_name" varchar(80) NOT NULL,
	"native_currency_symbol" varchar(24) NOT NULL,
	"native_currency_decimals" integer NOT NULL,
	"explorer_name" varchar(120) NOT NULL,
	"explorer_base_url" varchar(512),
	"explorer_address_url_template" varchar(512),
	"explorer_transaction_url_template" varchar(512),
	"environment" "network_environment" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration_status" "network_configuration_status" NOT NULL,
	"configuration_note" varchar(512),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_network_metadata_native_decimals_range" CHECK ("public_network_metadata"."native_currency_decimals" between 0 and 36)
);
--> statement-breakpoint
CREATE TABLE "public_token_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"network_id" varchar(64) NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"name" varchar(120),
	"symbol" varchar(32),
	"decimals" integer,
	"description" varchar(2000),
	"logo_reference" varchar(512),
	"logo_provenance" "metadata_provenance" NOT NULL,
	"metadata_status" "metadata_status" NOT NULL,
	"provenance" "metadata_provenance" NOT NULL,
	"provenance_reference" varchar(512),
	"verification_status" "verification_status" NOT NULL,
	"discovery_status" "discovery_status" NOT NULL,
	"visibility" "visibility_status" NOT NULL,
	"trust_status" "trust_status" NOT NULL,
	"freshness_status" "freshness_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_token_metadata_contract_address_format" CHECK ("public_token_metadata"."contract_address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "public_token_metadata_decimals_range" CHECK ("public_token_metadata"."decimals" is null or "public_token_metadata"."decimals" between 0 and 255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_token_metadata_identity_idx" ON "public_token_metadata" USING btree ("network_id","contract_address");