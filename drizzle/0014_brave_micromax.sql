CREATE TABLE "auth_action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_action_tokens_purpose_check" CHECK ("auth_action_tokens"."purpose" in ('email_verification', 'password_reset')),
	CONSTRAINT "auth_action_tokens_hash_check" CHECK (char_length("auth_action_tokens"."token_hash") = 64),
	CONSTRAINT "auth_action_tokens_expiry_check" CHECK ("auth_action_tokens"."expires_at" > "auth_action_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "auth_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"outcome" text NOT NULL,
	"identifier_hash" text,
	"ip_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_security_events_identifier_hash_check" CHECK ("auth_security_events"."identifier_hash" is null or char_length("auth_security_events"."identifier_hash") = 64),
	CONSTRAINT "auth_security_events_ip_hash_check" CHECK ("auth_security_events"."ip_hash" is null or char_length("auth_security_events"."ip_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "auth_rate_limit_windows" DROP CONSTRAINT "auth_rate_limit_windows_kind_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_action_tokens" ADD CONSTRAINT "auth_action_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_security_events" ADD CONSTRAINT "auth_security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_action_tokens_hash_unique" ON "auth_action_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_action_tokens_user_purpose_idx" ON "auth_action_tokens" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "auth_security_events_user_created_idx" ON "auth_security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_security_events_type_created_idx" ON "auth_security_events" USING btree ("event_type","created_at");--> statement-breakpoint
ALTER TABLE "auth_rate_limit_windows" ADD CONSTRAINT "auth_rate_limit_windows_kind_check" CHECK ("auth_rate_limit_windows"."kind" in ('login', 'login_ip', 'registration', 'registration_ip', 'verification', 'verification_ip', 'verification_complete', 'password_reset', 'password_reset_ip', 'password_reset_complete'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_version_check" CHECK ("users"."auth_version" >= 0);