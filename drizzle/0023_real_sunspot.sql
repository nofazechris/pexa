CREATE TABLE "platform_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"city" text NOT NULL,
	"platform" text NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"shown" integer DEFAULT 0 NOT NULL,
	"established" integer DEFAULT 0 NOT NULL,
	"risky" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"times_seen" integer DEFAULT 0 NOT NULL,
	"last_verdict" text,
	"last_rating" integer,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rated_count" integer DEFAULT 0 NOT NULL,
	"good" integer DEFAULT 0 NOT NULL,
	"bad" integer DEFAULT 0 NOT NULL,
	"scam" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_feedback" ADD CONSTRAINT "vendor_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_stats_uq" ON "platform_stats" USING btree ("category","city","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_feedback_uq" ON "vendor_feedback" USING btree ("user_id","platform","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_memory_account_uq" ON "vendor_memory" USING btree ("platform","handle");