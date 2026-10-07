ALTER TABLE "profiles" ADD COLUMN "uid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_uid_uq" ON "profiles" USING btree ("uid");