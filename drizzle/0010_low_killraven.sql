CREATE SCHEMA "osm_source";
--> statement-breakpoint
CREATE TYPE "osm_source"."dataset_status" AS ENUM('importing', 'ready', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "osm_source"."datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_key" text NOT NULL,
	"region_label" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text NOT NULL,
	"source_data_timestamp" timestamp with time zone NOT NULL,
	"source_sha256" text,
	"license_name" text DEFAULT 'Open Database License (ODbL) 1.0' NOT NULL,
	"license_url" text DEFAULT 'https://www.openstreetmap.org/copyright' NOT NULL,
	"attribution" text DEFAULT '© OpenStreetMap contributors' NOT NULL,
	"bbox" jsonb NOT NULL,
	"status" "osm_source"."dataset_status" DEFAULT 'importing' NOT NULL,
	"place_count" integer DEFAULT 0 NOT NULL,
	"locality_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"loader_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "osm_source"."localities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dataset_id" uuid NOT NULL,
	"osm_type" text NOT NULL,
	"osm_id" bigint NOT NULL,
	"name" text NOT NULL,
	"place_type" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"population" integer,
	CONSTRAINT "osm_localities_osm_type_check" CHECK ("osm_source"."localities"."osm_type" in ('node', 'way', 'relation')),
	CONSTRAINT "osm_localities_place_type_check" CHECK ("osm_source"."localities"."place_type" in ('city', 'town', 'suburb', 'village', 'hamlet')),
	CONSTRAINT "osm_localities_coordinates_check" CHECK ("osm_source"."localities"."lat" between -90 and 90 and "osm_source"."localities"."lon" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "osm_source"."places" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dataset_id" uuid NOT NULL,
	"osm_type" text NOT NULL,
	"osm_id" bigint NOT NULL,
	"name" text NOT NULL,
	"matched_tags" text[] NOT NULL,
	"industry" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"website" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"province" text,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "osm_places_osm_type_check" CHECK ("osm_source"."places"."osm_type" in ('node', 'way', 'relation')),
	CONSTRAINT "osm_places_coordinates_check" CHECK ("osm_source"."places"."lat" between -90 and 90 and "osm_source"."places"."lon" between -180 and 180)
);
--> statement-breakpoint
ALTER TABLE "osm_source"."localities" ADD CONSTRAINT "localities_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "osm_source"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osm_source"."places" ADD CONSTRAINT "places_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "osm_source"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "osm_datasets_region_status_idx" ON "osm_source"."datasets" USING btree ("region_key","status","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "osm_localities_dataset_object_unique" ON "osm_source"."localities" USING btree ("dataset_id","osm_type","osm_id");--> statement-breakpoint
CREATE INDEX "osm_localities_dataset_name_idx" ON "osm_source"."localities" USING btree ("dataset_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "osm_places_dataset_object_unique" ON "osm_source"."places" USING btree ("dataset_id","osm_type","osm_id");--> statement-breakpoint
CREATE INDEX "osm_places_dataset_location_idx" ON "osm_source"."places" USING btree ("dataset_id","lat","lon");--> statement-breakpoint
CREATE INDEX "osm_places_matched_tags_idx" ON "osm_source"."places" USING gin ("matched_tags");