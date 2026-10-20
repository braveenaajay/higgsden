-- Agency isolation enforced by PostgreSQL beneath the application.
-- The API and workers connect as higgsden_app, which does not own the tables and has no BYPASSRLS.
-- The operator console connects as higgsden_operator, which can read Agencies, plans, support, and cost data only.
-- Each transaction sets app.user_id and app.agency_id through withTenant() in packages/db.

do $$
begin
  if not exists (select from pg_roles where rolname = 'higgsden_app') then
    create role higgsden_app nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'higgsden_operator') then
    create role higgsden_operator nologin nobypassrls;
  end if;
end $$;
--> statement-breakpoint

create or replace function app_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

create or replace function app_agency_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.agency_id', true), '')::uuid $$;
--> statement-breakpoint

alter table agencies enable row level security;
--> statement-breakpoint
create policy agencies_member on agencies
  using (id = app_agency_id() or id in (select agency_id from memberships where user_id = app_user_id()))
  with check (id = app_agency_id());
--> statement-breakpoint
create policy agencies_operator on agencies for select to higgsden_operator using (true);
--> statement-breakpoint

-- A user can always list their own memberships, which is how the Agency switcher is built.
alter table memberships enable row level security;
--> statement-breakpoint
create policy memberships_tenant on memberships
  using (agency_id = app_agency_id() or user_id = app_user_id())
  with check (agency_id = app_agency_id());
--> statement-breakpoint

do $$
declare
  t text;
begin
  foreach t in array array[
    'invitations', 'clients', 'client_assignments', 'projects', 'discovery_sessions', 'kpis', 'constraints', 'risks',
    'requirements', 'architecture_decisions', 'decision_requirements', 'epics', 'milestones', 'stories',
    'acceptance_criteria', 'story_tasks', 'story_dependencies', 'knowledge_notes', 'audit_events', 'usage_records',
    'support_requests', 'support_replies', 'notifications', 'invoices', 'github_installations', 'repositories',
    'pull_request_links', 'workflow_runs', 'workflow_steps', 'outbox', 'store_connections', 'environments', 'builds',
    'gitops_commits', 'deployments', 'preview_themes', 'log_entries', 'spend_alerts', 'provisioned_resources',
    'custom_domains', 'db_snapshots', 'knowledge_chunks', 'embeddings', 'agent_runs', 'tool_invocations', 'proposals',
    'sla_policies', 'support_conversations', 'support_messages', 'incidents', 'resolutions', 'automation_rules',
    'automation_runs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I using (agency_id = app_agency_id()) with check (agency_id = app_agency_id())',
      t || '_tenant', t
    );
  end loop;
end $$;
--> statement-breakpoint

-- Operators answer platform support requests for any Agency. They have no grant on delivery data.
create policy support_requests_operator on support_requests to higgsden_operator using (true) with check (true);
--> statement-breakpoint
create policy support_replies_operator on support_replies to higgsden_operator using (true) with check (true);
--> statement-breakpoint

-- Retrieval tables are partitioned per Agency. Each partition gets its own HNSW index through the parent index.
create index knowledge_chunks_tsv on knowledge_chunks using gin (tsv);
--> statement-breakpoint
create index embeddings_vector_hnsw on embeddings using hnsw (vector halfvec_cosine_ops);
--> statement-breakpoint

create or replace function create_agency_partitions() returns trigger
  language plpgsql security definer set search_path = public, pg_temp
  as $$
declare
  suffix text := replace(new.id::text, '-', '');
  p text;
begin
  foreach p in array array['knowledge_chunks', 'embeddings'] loop
    execute format('create table if not exists %I partition of %I for values in (%L)', p || '_' || suffix, p, new.id);
    -- Partitions are reached through the parent only. Direct access would skip the parent's policy.
    execute format('revoke all on %I from higgsden_app, higgsden_operator', p || '_' || suffix);
    execute format('alter table %I enable row level security', p || '_' || suffix);
  end loop;
  return new;
end $$;
--> statement-breakpoint
create trigger agencies_partitions after insert on agencies for each row execute function create_agency_partitions();
--> statement-breakpoint

-- Lookups for requests that arrive without a signed-in member: webhooks, invite links, and the merchant widget.
-- Each returns only the Agency id, so the caller can then set app.agency_id and continue under row-level security.
create or replace function resolve_github_installation(p_installation_id bigint) returns uuid
  language sql stable security definer set search_path = public, pg_temp
  as $$ select agency_id from github_installations where installation_id = p_installation_id $$;
--> statement-breakpoint
create or replace function resolve_stripe_customer(p_customer text) returns uuid
  language sql stable security definer set search_path = public, pg_temp
  as $$ select id from agencies where stripe_customer_id = p_customer $$;
--> statement-breakpoint
create or replace function resolve_invitation(p_token_hash text) returns uuid
  language sql stable security definer set search_path = public, pg_temp
  as $$ select agency_id from invitations where token_hash = p_token_hash and status = 'pending' and expires_at > now() $$;
--> statement-breakpoint
create or replace function resolve_widget(p_key text) returns table (agency_id uuid, client_id uuid)
  language sql stable security definer set search_path = public, pg_temp
  as $$ select agency_id, id from clients where widget_key = p_key and deleted_at is null $$;
--> statement-breakpoint
create or replace function resolve_conversation(p_token_hash text) returns table (agency_id uuid, conversation_id uuid)
  language sql stable security definer set search_path = public, pg_temp
  as $$ select agency_id, id from support_conversations where access_token_hash = p_token_hash $$;
--> statement-breakpoint
create or replace function list_agency_ids() returns setof uuid
  language sql stable security definer set search_path = public, pg_temp
  as $$ select id from agencies order by created_at $$;
--> statement-breakpoint

-- The operator console sees counts, never member, Client, or project rows.
create or replace function operator_agency_overview()
  returns table (agency_id uuid, members bigint, pending_invites bigint, clients bigint, projects bigint)
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select a.id,
      (select count(*) from memberships m where m.agency_id = a.id and m.status = 'active'),
      (select count(*) from invitations i where i.agency_id = a.id and i.status = 'pending'),
      (select count(*) from clients c where c.agency_id = a.id and c.deleted_at is null),
      (select count(*) from projects p where p.agency_id = a.id)
    from agencies a
  $$;
--> statement-breakpoint

revoke execute on function resolve_github_installation(bigint), resolve_stripe_customer(text), resolve_invitation(text),
  resolve_widget(text), resolve_conversation(text), list_agency_ids(), operator_agency_overview(), create_agency_partitions()
  from public;
--> statement-breakpoint

grant usage on schema public to higgsden_app, higgsden_operator;
--> statement-breakpoint
grant select, insert, update, delete on all tables in schema public to higgsden_app;
--> statement-breakpoint
grant execute on function app_user_id(), app_agency_id() to higgsden_app, higgsden_operator;
--> statement-breakpoint
grant execute on function resolve_github_installation(bigint), resolve_stripe_customer(text), resolve_invitation(text),
  resolve_widget(text), resolve_conversation(text), list_agency_ids() to higgsden_app;
--> statement-breakpoint
grant execute on function operator_agency_overview() to higgsden_operator;
--> statement-breakpoint

-- Audit events are append-only for the application.
revoke update, delete on audit_events from higgsden_app;
--> statement-breakpoint

grant select on agencies, plans, hosting_tiers, cells, db_instances, cost_reports, autonomous_evaluations to higgsden_operator;
--> statement-breakpoint
grant select (id, name, email, is_operator) on users to higgsden_operator;
--> statement-breakpoint
grant select, insert, update on support_requests, support_replies, platform_articles, platform_chunks, operator_alerts to higgsden_operator;
--> statement-breakpoint
grant delete on platform_chunks to higgsden_operator;
