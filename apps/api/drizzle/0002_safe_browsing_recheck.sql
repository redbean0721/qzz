ALTER TABLE "links" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "safe_browsing_threats" text[];--> statement-breakpoint
CREATE INDEX "links_checked_at_idx" ON "links" USING btree ("checked_at");