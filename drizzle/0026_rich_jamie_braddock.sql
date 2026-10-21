CREATE TABLE "watch_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"watch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yield_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pool_id" text NOT NULL,
	"chain" text NOT NULL,
	"project" text NOT NULL,
	"symbol" text NOT NULL,
	"target_apy" real,
	"baseline_apy_base" real NOT NULL,
	"baseline_apy_reward" real NOT NULL,
	"baseline_tvl" real NOT NULL,
	"last_apy_base" real NOT NULL,
	"last_apy_reward" real NOT NULL,
	"last_tvl" real NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "watch_alerts" ADD CONSTRAINT "watch_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_alerts" ADD CONSTRAINT "watch_alerts_watch_id_yield_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."yield_watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_watches" ADD CONSTRAINT "yield_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_alerts_user_time_idx" ON "watch_alerts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "watch_alerts_watch_kind_idx" ON "watch_alerts" USING btree ("watch_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "yield_watches_user_pool_uq" ON "yield_watches" USING btree ("user_id","pool_id");--> statement-breakpoint
CREATE INDEX "yield_watches_active_idx" ON "yield_watches" USING btree ("active");