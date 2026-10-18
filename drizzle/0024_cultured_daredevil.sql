ALTER TABLE "research_sessions" ADD COLUMN "priority" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD COLUMN "radius_km" real;