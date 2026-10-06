CREATE TABLE "buy_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"capability_id" text NOT NULL,
	"title" text NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"request_body" text NOT NULL,
	"price_atomic" text NOT NULL,
	"pay_to" text NOT NULL,
	"status" text DEFAULT 'QUOTED' NOT NULL,
	"mode" text,
	"requirement_json" text NOT NULL,
	"authorization_json" text NOT NULL,
	"tx_hash" text,
	"correlation_id" text,
	"response_json" text,
	"error_code" text,
	"error_message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buy_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"autonomous" boolean DEFAULT false NOT NULL,
	"auto_limit_atomic" text DEFAULT '100000' NOT NULL,
	"daily_budget_atomic" text DEFAULT '1000000' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buy_purchases" ADD CONSTRAINT "buy_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buy_settings" ADD CONSTRAINT "buy_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buy_purchases_user_created_idx" ON "buy_purchases" USING btree ("user_id","created_at");