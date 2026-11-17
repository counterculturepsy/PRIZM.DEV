CREATE TABLE "capability_kit_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"change_note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_kit_versions_unique" UNIQUE("workspace_id","kit_id","version"),
	CONSTRAINT "capability_kit_versions_version_check" CHECK ("capability_kit_versions"."version" >= 1),
	CONSTRAINT "capability_kit_versions_note_check" CHECK ("capability_kit_versions"."change_note" is null or char_length("capability_kit_versions"."change_note") <= 300)
);
--> statement-breakpoint
CREATE TABLE "capability_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "capability_kits_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "capability_kits_name_check" CHECK (char_length("capability_kits"."name") between 2 and 120),
	CONSTRAINT "capability_kits_status_check" CHECK (("capability_kits"."status" = 'active' and "capability_kits"."archived_at" is null) or ("capability_kits"."status" = 'archived' and "capability_kits"."archived_at" is not null)),
	CONSTRAINT "capability_kits_version_check" CHECK ("capability_kits"."current_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "case_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_name" text NOT NULL,
	"problem" text DEFAULT '' NOT NULL,
	"solution" text DEFAULT '' NOT NULL,
	"tech_stack" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"responsibilities" text DEFAULT '' NOT NULL,
	"architecture_summary" text DEFAULT '' NOT NULL,
	"repository_url" text,
	"demo_url" text,
	"results" text,
	"results_verified" boolean DEFAULT false NOT NULL,
	"development_status" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "case_studies_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "case_studies_name_check" CHECK (char_length("case_studies"."project_name") between 2 and 160),
	CONSTRAINT "case_studies_development_status_check" CHECK ("case_studies"."development_status" in ('concept', 'in_development', 'prototype', 'live', 'retired')),
	CONSTRAINT "case_studies_status_check" CHECK (("case_studies"."status" = 'active' and "case_studies"."archived_at" is null) or ("case_studies"."status" = 'archived' and "case_studies"."archived_at" is not null)),
	CONSTRAINT "case_studies_urls_check" CHECK (("case_studies"."repository_url" is null or "case_studies"."repository_url" like 'https://%') and ("case_studies"."demo_url" is null or "case_studies"."demo_url" like 'https://%'))
);
--> statement-breakpoint
CREATE TABLE "case_study_assets" (
	"workspace_id" uuid NOT NULL,
	"case_study_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"caption" text,
	CONSTRAINT "case_study_assets_pk" PRIMARY KEY("workspace_id","case_study_id","asset_id"),
	CONSTRAINT "case_study_assets_caption_check" CHECK ("case_study_assets"."caption" is null or char_length("case_study_assets"."caption") <= 200)
);
--> statement-breakpoint
CREATE TABLE "kit_access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"link_id" uuid,
	"pack_id" uuid,
	"asset_id" uuid,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kit_access_events_type_check" CHECK ("kit_access_events"."event_type" in ('link_download', 'link_denied_expired', 'link_denied_revoked', 'link_denied_limit', 'pack_download', 'asset_download')),
	CONSTRAINT "kit_access_events_ip_check" CHECK ("kit_access_events"."ip_hash" is null or char_length("kit_access_events"."ip_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "kit_asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer,
	"width" integer,
	"height" integer,
	"data" "bytea" NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kit_asset_versions_unique" UNIQUE("workspace_id","asset_id","version"),
	CONSTRAINT "kit_asset_versions_version_check" CHECK ("kit_asset_versions"."version" >= 1),
	CONSTRAINT "kit_asset_versions_type_check" CHECK ("kit_asset_versions"."content_type" in ('application/pdf', 'image/png', 'image/jpeg')),
	CONSTRAINT "kit_asset_versions_size_check" CHECK ("kit_asset_versions"."byte_size" between 1 and 4000000 and octet_length("kit_asset_versions"."data") = "kit_asset_versions"."byte_size"),
	CONSTRAINT "kit_asset_versions_sha_check" CHECK (char_length("kit_asset_versions"."sha256") = 64),
	CONSTRAINT "kit_asset_versions_filename_check" CHECK (char_length("kit_asset_versions"."filename") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "kit_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "kit_assets_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "kit_assets_title_check" CHECK (char_length("kit_assets"."title") between 1 and 160),
	CONSTRAINT "kit_assets_kind_check" CHECK ("kit_assets"."kind" in ('pdf', 'image')),
	CONSTRAINT "kit_assets_status_check" CHECK (("kit_assets"."status" = 'active' and "kit_assets"."archived_at" is null) or ("kit_assets"."status" = 'archived' and "kit_assets"."archived_at" is not null)),
	CONSTRAINT "kit_assets_version_check" CHECK ("kit_assets"."current_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "kit_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"proposal_id" uuid,
	"lead_id" uuid,
	"campaign_id" uuid,
	"attached_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kit_attachments_target_check" CHECK (("kit_attachments"."target_type" = 'proposal' and "kit_attachments"."proposal_id" is not null and "kit_attachments"."lead_id" is null and "kit_attachments"."campaign_id" is null) or ("kit_attachments"."target_type" = 'lead' and "kit_attachments"."lead_id" is not null and "kit_attachments"."proposal_id" is null and "kit_attachments"."campaign_id" is null) or ("kit_attachments"."target_type" = 'campaign' and "kit_attachments"."campaign_id" is not null and "kit_attachments"."proposal_id" is null and "kit_attachments"."lead_id" is null))
);
--> statement-breakpoint
CREATE TABLE "kit_pack_assets" (
	"workspace_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_version" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "kit_pack_assets_pk" PRIMARY KEY("workspace_id","pack_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "kit_pack_case_studies" (
	"workspace_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"case_study_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "kit_pack_case_studies_pk" PRIMARY KEY("workspace_id","pack_id","case_study_id")
);
--> statement-breakpoint
CREATE TABLE "kit_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kit_id" uuid NOT NULL,
	"kit_version" integer NOT NULL,
	"template_key" text NOT NULL,
	"title" text NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_organisation" text,
	"message" text DEFAULT '' NOT NULL,
	"lead_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_digest" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kit_packs_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "kit_packs_template_check" CHECK ("kit_packs"."template_key" in ('senior_developer_application', 'saas_architect_application', 'full_stack_engineer_application', 'software_development_proposal', 'ecommerce_development_proposal', 'ai_automation_proposal', 'partnership_introduction')),
	CONSTRAINT "kit_packs_text_check" CHECK (char_length("kit_packs"."title") between 2 and 160 and char_length("kit_packs"."recipient_name") between 2 and 120 and char_length("kit_packs"."message") <= 5000),
	CONSTRAINT "kit_packs_status_check" CHECK (("kit_packs"."status" = 'draft' and "kit_packs"."approved_at" is null and "kit_packs"."approved_by_user_id" is null and "kit_packs"."approved_digest" is null) or ("kit_packs"."status" = 'approved' and "kit_packs"."approved_at" is not null and "kit_packs"."approved_by_user_id" is not null and char_length("kit_packs"."approved_digest") = 64))
);
--> statement-breakpoint
CREATE TABLE "kit_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"max_downloads" integer,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kit_share_links_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "kit_share_links_hash_check" CHECK (char_length("kit_share_links"."token_hash") = 64),
	CONSTRAINT "kit_share_links_limits_check" CHECK ("kit_share_links"."download_count" >= 0 and ("kit_share_links"."max_downloads" is null or "kit_share_links"."max_downloads" between 1 and 100) and "kit_share_links"."expires_at" > "kit_share_links"."created_at"),
	CONSTRAINT "kit_share_links_revocation_check" CHECK (("kit_share_links"."revoked_at" is null) = ("kit_share_links"."revoked_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "capability_kit_versions" ADD CONSTRAINT "capability_kit_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_kit_versions" ADD CONSTRAINT "capability_kit_versions_kit_fk" FOREIGN KEY ("workspace_id","kit_id") REFERENCES "public"."capability_kits"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_kit_versions" ADD CONSTRAINT "capability_kit_versions_creator_fk" FOREIGN KEY ("workspace_id","created_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_kits" ADD CONSTRAINT "capability_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_kits" ADD CONSTRAINT "capability_kits_creator_fk" FOREIGN KEY ("workspace_id","created_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_creator_fk" FOREIGN KEY ("workspace_id","created_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_study_assets" ADD CONSTRAINT "case_study_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_study_assets" ADD CONSTRAINT "case_study_assets_case_study_fk" FOREIGN KEY ("workspace_id","case_study_id") REFERENCES "public"."case_studies"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_study_assets" ADD CONSTRAINT "case_study_assets_asset_fk" FOREIGN KEY ("workspace_id","asset_id") REFERENCES "public"."kit_assets"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_access_events" ADD CONSTRAINT "kit_access_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_access_events" ADD CONSTRAINT "kit_access_events_link_fk" FOREIGN KEY ("workspace_id","link_id") REFERENCES "public"."kit_share_links"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_asset_versions" ADD CONSTRAINT "kit_asset_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_asset_versions" ADD CONSTRAINT "kit_asset_versions_asset_fk" FOREIGN KEY ("workspace_id","asset_id") REFERENCES "public"."kit_assets"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_asset_versions" ADD CONSTRAINT "kit_asset_versions_uploader_fk" FOREIGN KEY ("workspace_id","uploaded_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_assets" ADD CONSTRAINT "kit_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_assets" ADD CONSTRAINT "kit_assets_creator_fk" FOREIGN KEY ("workspace_id","created_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_attachments" ADD CONSTRAINT "kit_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_attachments" ADD CONSTRAINT "kit_attachments_pack_fk" FOREIGN KEY ("workspace_id","pack_id") REFERENCES "public"."kit_packs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_attachments" ADD CONSTRAINT "kit_attachments_proposal_fk" FOREIGN KEY ("workspace_id","proposal_id") REFERENCES "public"."proposals"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_attachments" ADD CONSTRAINT "kit_attachments_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_attachments" ADD CONSTRAINT "kit_attachments_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_attachments" ADD CONSTRAINT "kit_attachments_attacher_fk" FOREIGN KEY ("workspace_id","attached_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_pack_assets" ADD CONSTRAINT "kit_pack_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_pack_assets" ADD CONSTRAINT "kit_pack_assets_pack_fk" FOREIGN KEY ("workspace_id","pack_id") REFERENCES "public"."kit_packs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_pack_assets" ADD CONSTRAINT "kit_pack_assets_version_fk" FOREIGN KEY ("workspace_id","asset_id","asset_version") REFERENCES "public"."kit_asset_versions"("workspace_id","asset_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_pack_case_studies" ADD CONSTRAINT "kit_pack_case_studies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_pack_case_studies" ADD CONSTRAINT "kit_pack_case_studies_pack_fk" FOREIGN KEY ("workspace_id","pack_id") REFERENCES "public"."kit_packs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_pack_case_studies" ADD CONSTRAINT "kit_pack_case_studies_case_study_fk" FOREIGN KEY ("workspace_id","case_study_id") REFERENCES "public"."case_studies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_packs" ADD CONSTRAINT "kit_packs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_packs" ADD CONSTRAINT "kit_packs_kit_version_fk" FOREIGN KEY ("workspace_id","kit_id","kit_version") REFERENCES "public"."capability_kit_versions"("workspace_id","kit_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_packs" ADD CONSTRAINT "kit_packs_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_packs" ADD CONSTRAINT "kit_packs_creator_fk" FOREIGN KEY ("workspace_id","created_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_packs" ADD CONSTRAINT "kit_packs_approver_fk" FOREIGN KEY ("workspace_id","approved_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_share_links" ADD CONSTRAINT "kit_share_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_share_links" ADD CONSTRAINT "kit_share_links_pack_fk" FOREIGN KEY ("workspace_id","pack_id") REFERENCES "public"."kit_packs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_share_links" ADD CONSTRAINT "kit_share_links_creator_fk" FOREIGN KEY ("workspace_id","created_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_share_links" ADD CONSTRAINT "kit_share_links_revoker_fk" FOREIGN KEY ("workspace_id","revoked_by_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_kits_workspace_status_idx" ON "capability_kits" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "case_studies_workspace_status_idx" ON "case_studies" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "kit_access_events_workspace_created_idx" ON "kit_access_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "kit_access_events_link_idx" ON "kit_access_events" USING btree ("workspace_id","link_id","created_at");--> statement-breakpoint
CREATE INDEX "kit_assets_workspace_status_idx" ON "kit_assets" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kit_attachments_pack_target_unique" ON "kit_attachments" USING btree ("workspace_id","pack_id","target_type",coalesce("proposal_id", "lead_id", "campaign_id"));--> statement-breakpoint
CREATE INDEX "kit_attachments_workspace_pack_idx" ON "kit_attachments" USING btree ("workspace_id","pack_id");--> statement-breakpoint
CREATE INDEX "kit_packs_workspace_status_idx" ON "kit_packs" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kit_share_links_token_hash_unique" ON "kit_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "kit_share_links_workspace_pack_idx" ON "kit_share_links" USING btree ("workspace_id","pack_id","created_at");