CREATE TABLE "ticker_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"watch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticker_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text,
	"baseline_authors" integer DEFAULT 0 NOT NULL,
	"baseline_posts" integer DEFAULT 0 NOT NULL,
	"baseline_price" real,
	"last_authors" integer DEFAULT 0 NOT NULL,
	"last_posts" integer DEFAULT 0 NOT NULL,
	"traction_at" timestamp with time zone,
	"ref_price" real,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ticker_alerts" ADD CONSTRAINT "ticker_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticker_alerts" ADD CONSTRAINT "ticker_alerts_watch_id_ticker_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."ticker_watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticker_watches" ADD CONSTRAINT "ticker_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticker_alerts_user_time_idx" ON "ticker_alerts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ticker_alerts_watch_kind_idx" ON "ticker_alerts" USING btree ("watch_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticker_watches_user_symbol_uq" ON "ticker_watches" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "ticker_watches_active_idx" ON "ticker_watches" USING btree ("active");