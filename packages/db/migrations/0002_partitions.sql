-- knowledge_chunks and embeddings are ordinary tables in the dummy schema.
-- Skip PARTITION OF until those tables are converted; Agency creation must still succeed.
create or replace function create_agency_partitions() returns trigger
  language plpgsql security definer set search_path = public, pg_temp
  as $$
declare
  suffix text := replace(new.id::text, '-', '');
  p text;
  is_partitioned boolean;
begin
  foreach p in array array['knowledge_chunks', 'embeddings'] loop
    select exists (
      select 1 from pg_partitioned_table where partrelid = p::regclass
    ) into is_partitioned;
    if not is_partitioned then
      continue;
    end if;
    execute format('create table if not exists %I partition of %I for values in (%L)', p || '_' || suffix, p, new.id);
    execute format('revoke all on %I from higgsden_app, higgsden_operator', p || '_' || suffix);
    execute format('alter table %I enable row level security', p || '_' || suffix);
  end loop;
  return new;
end $$;
