CREATE TABLE "money_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"description" text NOT NULL,
	"token" text DEFAULT 'USDC' NOT NULL,
	"percent_bps" integer,
	"destination_user_id" uuid,
	"destination_username" text,
	"threshold_raw" text,
	"last_run_at" timestamp with time zone,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "money_rules" ADD CONSTRAINT "money_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_rules" ADD CONSTRAINT "money_rules_destination_user_id_users_id_fk" FOREIGN KEY ("destination_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;