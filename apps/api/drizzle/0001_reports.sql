CREATE TABLE "reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"link_id" bigint,
	"paste_id" bigint,
	"reason" varchar(32) NOT NULL,
	"details" text,
	"reporter_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "reports_one_target" CHECK (num_nonnulls("reports"."link_id", "reports"."paste_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_paste_id_pastes_id_fk" FOREIGN KEY ("paste_id") REFERENCES "public"."pastes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_link_reporter_unique" ON "reports" USING btree ("link_id","reporter_ip") WHERE "reports"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_paste_reporter_unique" ON "reports" USING btree ("paste_id","reporter_ip") WHERE "reports"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "reports_link_id_idx" ON "reports" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "reports_paste_id_idx" ON "reports" USING btree ("paste_id");