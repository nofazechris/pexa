CREATE TABLE "swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"from_token" text NOT NULL,
	"to_token" text NOT NULL,
	"amount_in" text NOT NULL,
	"expected_out" text NOT NULL,
	"min_out" text NOT NULL,
	"route" text NOT NULL,
	"status" text DEFAULT 'PREVIEW' NOT NULL,
	"gas_drip_tx" text,
	"approve_tx" text,
	"swap_tx" text,
	"amount_out" text,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swaps_swap_tx_uq" ON "swaps" USING btree ("swap_tx");--> statement-breakpoint
CREATE INDEX "swaps_user_time_idx" ON "swaps" USING btree ("user_id","created_at");