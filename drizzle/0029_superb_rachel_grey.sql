CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"target_text" text,
	"place" text DEFAULT '' NOT NULL,
	"platforms" text DEFAULT 'instagram,tiktok' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"options_json" text DEFAULT '[]' NOT NULL,
	"changes_json" text DEFAULT '[]' NOT NULL,
	"researched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_sessions" ADD COLUMN "shopping_item_id" uuid;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_items_user_idx" ON "shopping_items" USING btree ("user_id","status","updated_at");