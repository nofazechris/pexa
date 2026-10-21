CREATE TABLE "investor_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"risk" text,
	"horizon" text,
	"amount_usd" integer,
	"skipped" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investor_profiles" ADD CONSTRAINT "investor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;