CREATE TABLE "compliance_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text,
	"kyc_status" text DEFAULT 'none' NOT NULL,
	"risk_flags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiat_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"quote_id" uuid,
	"side" text NOT NULL,
	"status" text DEFAULT 'QUOTE_CREATED' NOT NULL,
	"ngn_amount" text NOT NULL,
	"usdt_amount" text NOT NULL,
	"fee_ngn" text DEFAULT '0' NOT NULL,
	"asset" text DEFAULT 'USDT' NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"payout_account_id" uuid,
	"authorization_status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fiat_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"side" text NOT NULL,
	"provider" text NOT NULL,
	"provider_quote_ref" text NOT NULL,
	"ngn_amount" text NOT NULL,
	"usdt_amount" text NOT NULL,
	"rate" text NOT NULL,
	"provider_fee_ngn" text NOT NULL,
	"pexa_fee_ngn" text DEFAULT '0' NOT NULL,
	"estimated_receive" text NOT NULL,
	"estimated_receive_currency" text NOT NULL,
	"sandbox" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_name" text NOT NULL,
	"last4" text NOT NULL,
	"status" text DEFAULT 'verified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"provider_order_id" text,
	"status" text,
	"payload" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_profiles" ADD CONSTRAINT "compliance_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_orders" ADD CONSTRAINT "fiat_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_orders" ADD CONSTRAINT "fiat_orders_quote_id_fiat_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."fiat_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_orders" ADD CONSTRAINT "fiat_orders_payout_account_id_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."payout_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_quotes" ADD CONSTRAINT "fiat_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_orders_user_idem_uq" ON "fiat_orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_user_ref_uq" ON "payout_accounts" USING btree ("user_id","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_webhook_events_provider_event_uq" ON "provider_webhook_events" USING btree ("provider","event_id");