CREATE TABLE "auth_rate_limit_windows" (
	"kind" text NOT NULL,
	"identifier_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limit_windows_kind_identifier_hash_window_started_at_pk" PRIMARY KEY("kind","identifier_hash","window_started_at"),
	CONSTRAINT "auth_rate_limit_windows_kind_check" CHECK ("auth_rate_limit_windows"."kind" in ('login', 'registration')),
	CONSTRAINT "auth_rate_limit_windows_hash_check" CHECK (char_length("auth_rate_limit_windows"."identifier_hash") = 64),
	CONSTRAINT "auth_rate_limit_windows_attempts_check" CHECK ("auth_rate_limit_windows"."attempts" >= 1)
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limit_windows_updated_idx" ON "auth_rate_limit_windows" USING btree ("updated_at");