CREATE TYPE "public"."account_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TABLE "account_approval_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_status" "account_status" NOT NULL,
	"next_status" "account_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_approval_audits_action_check" CHECK ("account_approval_audits"."action" in ('approve', 'reject', 'suspend', 'reactivate'))
);
--> statement-breakpoint
CREATE TABLE "account_notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_user_id" uuid,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"audience" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_notification_events_type_check" CHECK ("account_notification_events"."event_type" in ('registration_pending', 'account_approved', 'account_rejected', 'account_suspended', 'account_reactivated')),
	CONSTRAINT "account_notification_events_audience_check" CHECK ("account_notification_events"."audience" in ('platform_admin', 'user'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status" "account_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "account_status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_approval_audits" ADD CONSTRAINT "account_approval_audits_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_approval_audits" ADD CONSTRAINT "account_approval_audits_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_notification_events" ADD CONSTRAINT "account_notification_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_notification_events" ADD CONSTRAINT "account_notification_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_approval_audits_target_created_idx" ON "account_approval_audits" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "account_approval_audits_actor_created_idx" ON "account_approval_audits" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "account_notification_events_target_created_idx" ON "account_notification_events" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "account_notification_events_audience_read_idx" ON "account_notification_events" USING btree ("audience","read_at","created_at");
