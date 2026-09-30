CREATE TABLE "referral_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"referee_type" text NOT NULL,
	"referee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_code_referral_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."referral_codes"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_owner_uq" ON "referral_codes" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_uq" ON "referrals" USING btree ("referee_type","referee_id");