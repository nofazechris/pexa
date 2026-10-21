CREATE TABLE "earn_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"action" text NOT NULL,
	"token" text NOT NULL,
	"amount" text NOT NULL,
	"is_max" boolean DEFAULT false NOT NULL,
	"base_apy_bps" integer,
	"status" text DEFAULT 'PREVIEW' NOT NULL,
	"gas_drip_tx" text,
	"approve_tx" text,
	"action_tx" text,
	"amount_out" text,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "earn_actions" ADD CONSTRAINT "earn_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "earn_actions_tx_uq" ON "earn_actions" USING btree ("action_tx");--> statement-breakpoint
CREATE INDEX "earn_actions_user_time_idx" ON "earn_actions" USING btree ("user_id","created_at");