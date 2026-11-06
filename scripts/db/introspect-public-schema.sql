-- Read the public catalog of a migrated harness cluster.
-- The helper schema is not public, so it never appears in the document.
-- psql runs this file in one session: helpers first, then one JSON row.

create schema if not exists db_types_introspect;

create or replace function db_types_introspect.descriptor(typ oid)
returns jsonb
language plpgsql
stable
as $$
declare
  base_oid oid := typ;
  steps int := 0;
  typ_type "char";
  base_type oid;
  type_name text;
  type_category "char";
  type_schema text;
  type_elem oid;
  elem jsonb;
begin
  if typ is null or typ = 0 then
    return 'null'::jsonb;
  end if;

  loop
    select t.typtype, t.typbasetype
      into typ_type, base_type
    from pg_type t
    where t.oid = base_oid;
    exit when typ_type is distinct from 'd' or base_type is null or base_type = 0 or steps >= 8;
    base_oid := base_type;
    steps := steps + 1;
  end loop;

  select t.typname, t.typcategory, n.nspname, t.typelem
    into type_name, type_category, type_schema, type_elem
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where t.oid = base_oid;

  elem := 'null'::jsonb;
  if type_category = 'A' and type_elem is not null and type_elem <> 0 then
    elem := db_types_introspect.descriptor(type_elem);
  end if;

  return jsonb_build_object(
    'udt', type_name,
    'category', type_category,
    'schema', type_schema,
    'elem', elem
  );
end;
$$;

create or replace function db_types_introspect.relation(target oid, kind text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'name', c.relname,
    'insertable', case
      when c.relkind = 'm' then false
      when kind = 'view' then coalesce((
        select v.is_insertable_into = 'YES'
        from information_schema.views v
        where v.table_schema = 'public'
          and v.table_name = c.relname
      ), false)
      else true
    end,
    'columns', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', a.attname,
          'position', a.attnum,
          'nullable', not a.attnotnull,
          'hasAttrDefault', d.oid is not null,
          'identity', a.attidentity::text,
          'generated', a.attgenerated::text,
          'type', db_types_introspect.descriptor(a.atttypid)
        )
        order by a.attnum
      )
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = c.oid
        and a.attnum > 0
        and not a.attisdropped
    ), '[]'::jsonb),
    'relationships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'foreignKeyName', fk.conname,
          'columns', (
            select coalesce(jsonb_agg(sa.attname order by src.ord), '[]'::jsonb)
            from unnest(fk.conkey) with ordinality as src(attnum, ord)
            join pg_attribute sa on sa.attrelid = fk.conrelid and sa.attnum = src.attnum
          ),
          'isOneToOne', exists (
            select 1
            from pg_constraint uniq
            where uniq.conrelid = fk.conrelid
              and uniq.contype in ('p', 'u')
              and uniq.conkey @> fk.conkey
              and fk.conkey @> uniq.conkey
          ),
          'referencedRelation', dst.relname,
          'referencedColumns', (
            select coalesce(jsonb_agg(da.attname order by ref.ord), '[]'::jsonb)
            from unnest(fk.confkey) with ordinality as ref(attnum, ord)
            join pg_attribute da on da.attrelid = fk.confrelid and da.attnum = ref.attnum
          )
        )
        order by fk.conname
      )
      from pg_constraint fk
      join pg_class dst on dst.oid = fk.confrelid
      where fk.conrelid = c.oid
        and fk.contype = 'f'
    ), '[]'::jsonb)
  )
  from pg_class c
  where c.oid = target;
$$;

create or replace function db_types_introspect.routine(fn oid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'name', p.proname,
    'identity', pg_get_function_identity_arguments(p.oid),
    'setof', p.proretset,
    'nargs', p.pronargs,
    'ndefaults', p.pronargdefaults,
    'returnType', db_types_introspect.descriptor(p.prorettype),
    'returnRelation', rel.relname,
    'returnRelationKind', rel.relkind,
    'args', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', coalesce(p.proargnames[gs.i], ''),
          'mode', coalesce(p.proargmodes[gs.i]::text, 'i'),
          'type', db_types_introspect.descriptor(
            case
              when p.proallargtypes is null then p.proargtypes[gs.i - 1]
              else p.proallargtypes[gs.i]
            end
          )
        )
        order by gs.i
      )
      from generate_series(
        1,
        case
          when p.proallargtypes is null then p.pronargs
          else coalesce(array_length(p.proallargtypes, 1), 0)
        end
      ) as gs(i)
    ), '[]'::jsonb)
  )
  from pg_proc p
  left join lateral (
    select c.relname, c.relkind::text as relkind
    from pg_type t
    join pg_class c on c.oid = t.typrelid
    join pg_namespace n on n.oid = c.relnamespace
    where t.oid = p.prorettype
      and n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
  ) rel on true
  where p.oid = fn;
$$;

select jsonb_build_object(
  'tables', coalesce((
    select jsonb_agg(db_types_introspect.relation(c.oid, 'table') order by c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ), '[]'::jsonb),
  'views', coalesce((
    select jsonb_agg(db_types_introspect.relation(c.oid, 'view') order by c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
  ), '[]'::jsonb),
  'enums', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', t.typname,
        'schema', n.nspname,
        'labels', (
          select coalesce(jsonb_agg(e.enumlabel order by e.enumsortorder), '[]'::jsonb)
          from pg_enum e
          where e.enumtypid = t.oid
        )
      )
      order by n.nspname, t.typname
    )
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typtype = 'e'
  ), '[]'::jsonb),
  'composites', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', t.typname,
        'schema', n.nspname,
        'attributes', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name', a.attname,
              'position', a.attnum,
              'nullable', not a.attnotnull,
              'type', db_types_introspect.descriptor(a.atttypid)
            )
            order by a.attnum
          )
          from pg_attribute a
          where a.attrelid = t.typrelid
            and a.attnum > 0
            and not a.attisdropped
        ), '[]'::jsonb)
      )
      order by t.typname
    )
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype = 'c'
      and not exists (
        select 1
        from pg_class c
        where c.oid = t.typrelid
          and c.relkind in ('r', 'p', 'v', 'm', 'f')
      )
  ), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(
      db_types_introspect.routine(p.oid)
      order by p.proname, pg_get_function_identity_arguments(p.oid)
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and p.prorettype <> 'event_trigger'::regtype
  ), '[]'::jsonb)
)::text;
