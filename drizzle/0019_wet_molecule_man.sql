CREATE TABLE "deposit_cursors" (
	"wallet_address" text PRIMARY KEY NOT NULL,
	"last_block" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"token" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"from_address" text NOT NULL,
	"block_number" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_state" ADD CONSTRAINT "notification_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_deposits" ADD CONSTRAINT "wallet_deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_deposits_tx_log_uq" ON "wallet_deposits" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "wallet_deposits_user_time_idx" ON "wallet_deposits" USING btree ("user_id","occurred_at");