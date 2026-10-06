ALTER TABLE "buy_purchases" ADD COLUMN "pay_token" text DEFAULT 'USDC' NOT NULL;--> statement-breakpoint
ALTER TABLE "buy_settings" ADD COLUMN "pay_token" text DEFAULT 'USDC' NOT NULL;