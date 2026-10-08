CREATE TABLE "bridge_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"origin_chain_id" integer NOT NULL,
	"deposit_address" text NOT NULL,
	"request_id" text NOT NULL,
	"recipient" text NOT NULL,
	"estimate_fee_usd" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_addresses" ADD CONSTRAINT "bridge_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_addresses_user_chain_uq" ON "bridge_addresses" USING btree ("user_id","origin_chain_id");