CREATE TABLE "research_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"what" text NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"cap_atomic" text NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"steps_json" text DEFAULT '[]' NOT NULL,
	"result_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_sessions_user_created_idx" ON "research_sessions" USING btree ("user_id","created_at");