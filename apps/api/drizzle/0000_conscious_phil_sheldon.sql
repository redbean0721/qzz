CREATE TABLE "links" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(16) NOT NULL,
	"url" text NOT NULL,
	"delete_token_hash" text NOT NULL,
	"creator_ip" "inet",
	"user_id" bigint,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pastes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pastes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"language" varchar(32),
	"delete_token_hash" text NOT NULL,
	"creator_ip" "inet",
	"user_id" bigint,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "pastes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX "links_expires_at_idx" ON "links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pastes_expires_at_idx" ON "pastes" USING btree ("expires_at");