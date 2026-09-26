CREATE TABLE "vault_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount_raw" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"ref" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token" text DEFAULT 'USDC' NOT NULL,
	"balance_raw" text DEFAULT '0' NOT NULL,
	"target_raw" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "money_rules" ADD COLUMN "destination_vault_id" uuid;--> statement-breakpoint
ALTER TABLE "vault_transactions" ADD CONSTRAINT "vault_transactions_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_transactions" ADD CONSTRAINT "vault_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_transactions_vault_ref_uq" ON "vault_transactions" USING btree ("vault_id","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "vaults_user_name_uq" ON "vaults" USING btree ("user_id","name");