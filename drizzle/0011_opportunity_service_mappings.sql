CREATE TABLE "opportunity_service_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_type" "opportunity_type" NOT NULL,
	"service_id" uuid NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_service_mappings_workspace_type_service_unique" UNIQUE("workspace_id","opportunity_type","service_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_service_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"service_id" uuid,
	"service_name" text NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"rank" integer NOT NULL,
	"price_status" text NOT NULL,
	"starting_price_minor" integer,
	"average_price_minor" integer,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_service_recommendations_rank_unique" UNIQUE("workspace_id","opportunity_id","rank"),
	CONSTRAINT "opportunity_service_recommendations_service_unique" UNIQUE("workspace_id","opportunity_id","service_id"),
	CONSTRAINT "opportunity_service_recommendations_rank_check" CHECK ("opportunity_service_recommendations"."rank" >= 1),
	CONSTRAINT "opportunity_service_recommendations_status_check" CHECK ("opportunity_service_recommendations"."price_status" in ('configured', 'not_configured', 'invalid')),
	CONSTRAINT "opportunity_service_recommendations_price_check" CHECK (("opportunity_service_recommendations"."starting_price_minor" is null or "opportunity_service_recommendations"."starting_price_minor" >= 0) and ("opportunity_service_recommendations"."average_price_minor" is null or "opportunity_service_recommendations"."average_price_minor" >= 0) and ("opportunity_service_recommendations"."starting_price_minor" is null or "opportunity_service_recommendations"."average_price_minor" is null or "opportunity_service_recommendations"."starting_price_minor" <= "opportunity_service_recommendations"."average_price_minor")),
	CONSTRAINT "opportunity_service_recommendations_price_state_check" CHECK (("opportunity_service_recommendations"."price_status" = 'configured' and "opportunity_service_recommendations"."currency" is not null and ("opportunity_service_recommendations"."starting_price_minor" is not null or "opportunity_service_recommendations"."average_price_minor" is not null)) or ("opportunity_service_recommendations"."price_status" <> 'configured' and "opportunity_service_recommendations"."currency" is null and "opportunity_service_recommendations"."starting_price_minor" is null and "opportunity_service_recommendations"."average_price_minor" is null))
);
--> statement-breakpoint
ALTER TABLE "opportunity_service_mappings" ADD CONSTRAINT "opportunity_service_mappings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_service_mappings" ADD CONSTRAINT "opportunity_service_mappings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_service_mappings" ADD CONSTRAINT "opportunity_service_mappings_workspace_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_service_recommendations" ADD CONSTRAINT "opportunity_service_recommendations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_service_recommendations" ADD CONSTRAINT "opportunity_service_recommendations_workspace_opportunity_fk" FOREIGN KEY ("workspace_id","audit_id","opportunity_id") REFERENCES "public"."opportunities"("workspace_id","audit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_service_recommendations" ADD CONSTRAINT "opportunity_service_recommendations_workspace_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE set null ("service_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_service_mappings_one_preferred_unique" ON "opportunity_service_mappings" USING btree ("workspace_id","opportunity_type") WHERE "opportunity_service_mappings"."is_preferred";--> statement-breakpoint
CREATE INDEX "opportunity_service_mappings_workspace_type_idx" ON "opportunity_service_mappings" USING btree ("workspace_id","opportunity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_service_recommendations_one_preferred_unique" ON "opportunity_service_recommendations" USING btree ("workspace_id","opportunity_id") WHERE "opportunity_service_recommendations"."is_preferred";--> statement-breakpoint
CREATE INDEX "opportunity_service_recommendations_workspace_opportunity_idx" ON "opportunity_service_recommendations" USING btree ("workspace_id","opportunity_id");--> statement-breakpoint
-- legacy-alias-seed:begin
-- Seeds explicit mappings only where a workspace service slug exactly equals a slug the pre-mapping
-- generator recognised. No preferred service is chosen, existing rows are never overwritten, and the
-- statement is idempotent. It reads services and inserts into the new table only.
INSERT INTO "opportunity_service_mappings" ("workspace_id", "opportunity_type", "service_id", "is_preferred")
SELECT s."workspace_id", a."opportunity_type"::"opportunity_type", s."id", false
FROM "services" s
JOIN (VALUES
	('accessibility_remediation', 'accessibility'),
	('accessibility_remediation', 'accessibility-audit'),
	('accessibility_remediation', 'web-accessibility'),
	('seo_improvement', 'seo'),
	('seo_improvement', 'search-engine-optimisation'),
	('seo_improvement', 'search-engine-optimization'),
	('security_hardening', 'web-security'),
	('security_hardening', 'website-security'),
	('security_hardening', 'security-hardening'),
	('performance_optimization', 'web-performance'),
	('performance_optimization', 'performance-optimization'),
	('performance_optimization', 'website-optimization'),
	('mobile_experience', 'responsive-design'),
	('mobile_experience', 'mobile-web-design'),
	('mobile_experience', 'mobile-experience'),
	('website_improvement', 'website-design'),
	('website_improvement', 'web-design'),
	('website_improvement', 'website-development'),
	('website_improvement', 'web-development')
) AS a("opportunity_type", "slug") ON a."slug" = s."slug"
ON CONFLICT ("workspace_id", "opportunity_type", "service_id") DO NOTHING;
-- legacy-alias-seed:end