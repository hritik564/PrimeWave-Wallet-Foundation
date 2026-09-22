CREATE TABLE "analytics_errors" (
	"telemetry_id" varchar(128) PRIMARY KEY NOT NULL,
	"error_category" varchar(64) NOT NULL,
	"error_code" varchar(64) NOT NULL,
	"area" varchar(64) NOT NULL,
	"operation" varchar(64) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"environment" varchar(16) NOT NULL,
	"duration_bucket" varchar(32),
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"event_id" varchar(128) PRIMARY KEY NOT NULL,
	"event_name" varchar(64) NOT NULL,
	"event_version" integer NOT NULL,
	"anonymous_id" varchar(128) NOT NULL,
	"identity_scope" varchar(16) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"environment" varchar(16) NOT NULL,
	"properties" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analytics_events_version_positive" CHECK ("analytics_events"."event_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_performance" (
	"telemetry_id" varchar(128) PRIMARY KEY NOT NULL,
	"metric_name" varchar(64) NOT NULL,
	"value_bucket" varchar(32) NOT NULL,
	"area" varchar(64) NOT NULL,
	"operation" varchar(64) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"environment" varchar(16) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analytics_errors_expiry_idx" ON "analytics_errors" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "analytics_events_expiry_idx" ON "analytics_events" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "analytics_performance_expiry_idx" ON "analytics_performance" USING btree ("expires_at");