-- C12 Microsoft Teams: Agency connection, transcripts, and unanswered questions as stories.
-- Tables carry agency_id and use the same tenant RLS policy as GitHub and Shopify rows.

CREATE TYPE "public"."teams_mode" AS ENUM('fake', 'graph');--> statement-breakpoint
CREATE TYPE "public"."teams_match_kind" AS ENUM('organizer', 'subject_prefix');--> statement-breakpoint

ALTER TABLE "stories" ADD COLUMN "source" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "source_ref" text;--> statement-breakpoint
CREATE INDEX "stories_project_source" ON "stories" USING btree ("project_id","source");--> statement-breakpoint

CREATE TABLE "teams_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"entra_tenant_id" text NOT NULL,
	"mode" "teams_mode" DEFAULT 'fake' NOT NULL,
	"subscription_id" text,
	"client_state_encrypted" text,
	"subscription_expires_at" timestamp with time zone,
	"consented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "teams_connections" ADD CONSTRAINT "teams_connections_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_connections_agency" ON "teams_connections" USING btree ("agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_connections_tenant" ON "teams_connections" USING btree ("entra_tenant_id");--> statement-breakpoint

CREATE TABLE "teams_organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entra_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "teams_organizers" ADD CONSTRAINT "teams_organizers_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_organizers" ADD CONSTRAINT "teams_organizers_connection_id_teams_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."teams_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_organizers_connection_user" ON "teams_organizers" USING btree ("connection_id","entra_user_id");--> statement-breakpoint

CREATE TABLE "teams_project_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"match_kind" "teams_match_kind" NOT NULL,
	"organizer_id" uuid,
	"subject_prefix" text,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_project_maps_match_check" CHECK (
		("match_kind" = 'organizer' AND "organizer_id" IS NOT NULL)
		OR ("match_kind" = 'subject_prefix' AND "subject_prefix" IS NOT NULL AND length(trim("subject_prefix")) > 0)
	)
);--> statement-breakpoint
ALTER TABLE "teams_project_maps" ADD CONSTRAINT "teams_project_maps_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_project_maps" ADD CONSTRAINT "teams_project_maps_connection_id_teams_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."teams_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_project_maps" ADD CONSTRAINT "teams_project_maps_organizer_id_teams_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."teams_organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_project_maps" ADD CONSTRAINT "teams_project_maps_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_project_maps" ADD CONSTRAINT "teams_project_maps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teams_project_maps_connection" ON "teams_project_maps" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_project_maps_organizer" ON "teams_project_maps" ("connection_id", "organizer_id") WHERE "match_kind" = 'organizer';--> statement-breakpoint
CREATE UNIQUE INDEX "teams_project_maps_prefix" ON "teams_project_maps" ("connection_id", lower("subject_prefix")) WHERE "match_kind" = 'subject_prefix';--> statement-breakpoint

CREATE TABLE "meeting_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"graph_meeting_id" text NOT NULL,
	"graph_transcript_id" text NOT NULL,
	"organizer_entra_user_id" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"join_url" text,
	"started_at" timestamp with time zone,
	"raw_text" text DEFAULT '' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_connection_id_teams_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."teams_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_transcripts_agency_graph" ON "meeting_transcripts" USING btree ("agency_id","graph_transcript_id");--> statement-breakpoint
CREATE INDEX "meeting_transcripts_project" ON "meeting_transcripts" USING btree ("project_id");--> statement-breakpoint

CREATE TABLE "meeting_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"transcript_id" uuid NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"story_id" uuid,
	"duplicate_of_story_id" uuid,
	"question" text NOT NULL,
	"quote" text NOT NULL,
	"speaker" text,
	"assignee_hint" text,
	"confidence" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_questions_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);--> statement-breakpoint
ALTER TABLE "meeting_questions" ADD CONSTRAINT "meeting_questions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_questions" ADD CONSTRAINT "meeting_questions_transcript_id_meeting_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."meeting_transcripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_questions" ADD CONSTRAINT "meeting_questions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_questions" ADD CONSTRAINT "meeting_questions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_questions" ADD CONSTRAINT "meeting_questions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_questions" ADD CONSTRAINT "meeting_questions_duplicate_of_story_id_stories_id_fk" FOREIGN KEY ("duplicate_of_story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_questions_transcript_quote" ON "meeting_questions" USING btree ("transcript_id","quote");--> statement-breakpoint
CREATE INDEX "meeting_questions_story" ON "meeting_questions" USING btree ("story_id");--> statement-breakpoint

do $$
declare
  t text;
begin
  foreach t in array array[
    'teams_connections', 'teams_organizers', 'teams_project_maps', 'meeting_transcripts', 'meeting_questions'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I using (agency_id = app_agency_id()) with check (agency_id = app_agency_id())',
      t || '_tenant', t
    );
  end loop;
end $$;
--> statement-breakpoint

create or replace function resolve_teams_tenant(p_tenant_id text) returns uuid
  language sql stable security definer set search_path = public, pg_temp
  as $$ select agency_id from teams_connections where entra_tenant_id = p_tenant_id $$;
--> statement-breakpoint

drop function if exists operator_agency_overview();--> statement-breakpoint
create function operator_agency_overview()
  returns table (
    agency_id uuid,
    members bigint,
    pending_invites bigint,
    clients bigint,
    projects bigint,
    teams_connected boolean
  )
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select a.id,
      (select count(*) from memberships m where m.agency_id = a.id and m.status = 'active'),
      (select count(*) from invitations i where i.agency_id = a.id and i.status = 'pending'),
      (select count(*) from clients c where c.agency_id = a.id and c.deleted_at is null),
      (select count(*) from projects p where p.agency_id = a.id),
      exists (select 1 from teams_connections t where t.agency_id = a.id)
    from agencies a
  $$;
--> statement-breakpoint

revoke execute on function resolve_teams_tenant(text) from public;--> statement-breakpoint
grant execute on function resolve_teams_tenant(text) to higgsden_app;--> statement-breakpoint
grant execute on function operator_agency_overview() to higgsden_operator;--> statement-breakpoint
grant usage on type teams_mode, teams_match_kind to higgsden_app;--> statement-breakpoint
grant select, insert, update, delete on teams_connections, teams_organizers, teams_project_maps, meeting_transcripts, meeting_questions to higgsden_app;
