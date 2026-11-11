-- =============================================================================
-- 001 · Esquema base: clubes, personas, cuentas, partidos, stats, JSON crudo y
--       registro de ejecuciones del colector.
--
-- Convenciones:
--   * snake_case en todo; los nombres de campos de EA se traducen aquí
--     (p. ej. passattempts -> pass_attempts). El JSON crudo conserva los originales.
--   * IDs de EA como vienen: matchId y playerId son texto (llegan como string);
--     clubId es numérico.
--   * Restricciones (constraints) mínimas a propósito: si EA manda algo
--     inesperado, una CHECK demasiado estricta haría fallar el insert y, por la
--     ventana de 10 partidos, ese partido se perdería. La fuente de verdad
--     final es match_raw.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clubes. El clubId de EA cambia cada temporada: aquí se guarda cada club que
-- el colector encontró por nombre, con su temporada.
-- -----------------------------------------------------------------------------
create table public.clubs (
  club_id        bigint      primary key,
  name           text        not null,
  platform       text        not null,               -- p. ej. 'common-gen5'
  season         text        not null,               -- p. ej. 'FC27'
  first_seen_at  timestamptz not null default now()
);

comment on table public.clubs is
  'Clubes seguidos por el colector. El club_id de EA cambia por temporada; se busca por nombre.';

-- -----------------------------------------------------------------------------
-- Personas: agrupan una o varias cuentas de EA (p. ej. Hecodes98 en PS5 y PC).
-- Los rankings se calculan por persona.
-- -----------------------------------------------------------------------------
create table public.persons (
  person_id     bigint      generated always as identity primary key,
  display_name  text        not null,
  created_at    timestamptz not null default now()
);

comment on table public.persons is
  'Persona real. Se crea sola al aparecer una cuenta nueva; las cuentas duplicadas se unen con merge_persons().';

-- -----------------------------------------------------------------------------
-- Cuentas de EA (solo jugadores de nuestro club; los rivales quedan en match_raw).
-- La llave es el playerId numérico y estable; el nombre puede cambiar.
-- -----------------------------------------------------------------------------
create table public.accounts (
  player_id        text        primary key check (player_id ~ '^[0-9]+$'),
  person_id        bigint      not null
                               references public.persons (person_id) on delete restrict,
  last_known_name  text        not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

create index accounts_person_id_idx on public.accounts (person_id);

comment on column public.accounts.person_id is
  'Lo rellena el trigger accounts_assign_person si el colector no lo manda.';

-- Asigna (o crea) la persona de una cuenta.
-- OJO: en un upsert (INSERT ... ON CONFLICT) los triggers BEFORE INSERT se
-- disparan ANTES de detectar el conflicto, así que primero se busca la cuenta
-- existente; si no, cada upsert crearía una persona huérfana.
create function public.accounts_assign_person()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.person_id is null then
    select a.person_id
      into new.person_id
      from public.accounts a
     where a.player_id = new.player_id;

    if new.person_id is null then
      insert into public.persons (display_name)
      values (new.last_known_name)
      returning person_id into new.person_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger accounts_assign_person
  before insert on public.accounts
  for each row execute function public.accounts_assign_person();

-- -----------------------------------------------------------------------------
-- JSON crudo de cada partido, tal como lo devuelve EA.
-- Sin FK a matches A PROPÓSITO: el colector debe guardar esto PRIMERO, para que
-- el partido no se pierda aunque falle la normalización.
-- -----------------------------------------------------------------------------
create table public.match_raw (
  match_id     text        primary key,
  club_id      bigint      not null references public.clubs (club_id) on delete cascade,
  match_type   text        not null,
  payload      jsonb       not null,
  fetched_at   timestamptz not null default now()
);

create index match_raw_club_id_idx on public.match_raw (club_id);

comment on table public.match_raw is
  'JSON crudo por partido. Permite reprocesar si EA cambia campos o se descifra match_event_aggregate. No se expone al dashboard.';

-- -----------------------------------------------------------------------------
-- Partidos (vistos desde nuestro club).
-- -----------------------------------------------------------------------------
create table public.matches (
  match_id            text        primary key,
  club_id             bigint      not null references public.clubs (club_id) on delete cascade,
  match_type          text        not null
                                  check (match_type in ('leagueMatch', 'playoffMatch', 'friendlyMatch')),
  played_at           timestamptz not null,
  goals_for           smallint    not null check (goals_for >= 0),
  goals_against       smallint    not null check (goals_against >= 0),
  outcome             text        check (outcome in ('win', 'draw', 'loss')),
  winner_by_dnf       boolean     not null default false,
  opponent_club_id    bigint,
  opponent_name       text,
  first_collected_at  timestamptz not null default now(),
  last_collected_at   timestamptz not null default now()
);

create index matches_club_played_idx on public.matches (club_id, played_at desc);
create index matches_type_played_idx on public.matches (match_type, played_at desc);

comment on column public.matches.outcome is
  'Derivado por el colector de wins/losses/ties del club (no de los goles, por los abandonos/DNF).';

-- -----------------------------------------------------------------------------
-- Stats de cada jugador de nuestro club en cada partido.
-- No guarda person_id: se resuelve vía accounts, así que unir cuentas en una
-- persona afecta también a los partidos ya guardados.
-- -----------------------------------------------------------------------------
create table public.player_match_stats (
  match_id         text     not null references public.matches (match_id) on delete cascade,
  player_id        text     not null references public.accounts (player_id) on delete restrict,
  playername       text     not null,          -- nombre en ese partido
  position         text     not null,          -- forward/midfielder/defender/goalkeeper; sin CHECK por si EA agrega otro
  archetype_id     integer,
  rating           numeric(4, 2) check (rating between 0 and 10),
  goals            smallint not null check (goals >= 0),
  assists          smallint not null check (assists >= 0),
  shots            smallint not null check (shots >= 0),
  pass_attempts    smallint not null check (pass_attempts >= 0),
  passes_made      smallint not null check (passes_made >= 0),
  tackle_attempts  smallint not null check (tackle_attempts >= 0),
  tackles_made     smallint not null check (tackles_made >= 0),
  is_mom           boolean  not null,
  red_cards        smallint not null check (red_cards >= 0),
  saves            smallint not null check (saves >= 0),
  goals_conceded   smallint not null check (goals_conceded >= 0),
  clean_sheets_def smallint not null check (clean_sheets_def >= 0),
  clean_sheets_gk  smallint not null check (clean_sheets_gk >= 0),
  seconds_played   integer  check (seconds_played >= 0),
  game_time        integer  check (game_time >= 0),
  -- Atajadas detalladas: nulas si EA no las manda.
  parry_saves          smallint check (parry_saves >= 0),
  punch_saves          smallint check (punch_saves >= 0),
  reflex_saves         smallint check (reflex_saves >= 0),
  cross_saves          smallint check (cross_saves >= 0),
  ball_dive_saves      smallint check (ball_dive_saves >= 0),
  good_direction_saves smallint check (good_direction_saves >= 0),
  primary key (match_id, player_id)
);

create index player_match_stats_player_id_idx on public.player_match_stats (player_id);

-- -----------------------------------------------------------------------------
-- Registro de ejecuciones del colector (detección de fallas + heartbeat que
-- evita que Supabase pause el proyecto por inactividad).
-- -----------------------------------------------------------------------------
create table public.collector_runs (
  run_id         bigint      generated always as identity primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text        not null default 'running'
                             check (status in ('running', 'success', 'error')),
  runner         text        not null,          -- p. ej. 'github-actions', 'home'
  club_id        bigint      references public.clubs (club_id) on delete set null,
  matches_seen   integer     check (matches_seen >= 0),
  matches_new    integer     check (matches_new >= 0),
  error_code     text,
  error_message  text,
  constraint collector_runs_finished_consistency
    check ((status = 'running') = (finished_at is null))
);

create index collector_runs_started_at_idx on public.collector_runs (started_at desc);
create index collector_runs_status_finished_idx on public.collector_runs (status, finished_at desc);

-- =============================================================================
-- Funciones de administración (solo service_role / SQL Editor).
-- =============================================================================

-- Une dos personas: mueve las cuentas de absorb a keep y borra absorb.
-- Uso: select public.merge_persons(<id que se queda>, <id que desaparece>);
create function public.merge_persons(keep_person_id bigint, absorb_person_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if keep_person_id = absorb_person_id then
    raise exception 'merge_persons: los dos IDs son iguales (%)', keep_person_id;
  end if;

  if not exists (select 1 from public.persons where person_id = keep_person_id) then
    raise exception 'merge_persons: no existe la persona %', keep_person_id;
  end if;

  update public.accounts
     set person_id = keep_person_id
   where person_id = absorb_person_id;

  delete from public.persons where person_id = absorb_person_id;
end;
$$;

-- Borra un club con todos sus datos (para limpiar el club de prueba) y luego
-- las cuentas y personas que quedaron sin partidos.
-- Uso: select public.purge_club(1330384);
create function public.purge_club(p_club_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Cascada: matches -> player_match_stats, match_raw; collector_runs.club_id -> null.
  delete from public.clubs where club_id = p_club_id;

  delete from public.accounts a
   where not exists (select 1 from public.player_match_stats s where s.player_id = a.player_id);

  delete from public.persons p
   where not exists (select 1 from public.accounts a where a.person_id = p.person_id);
end;
$$;

-- Supabase da EXECUTE a anon/authenticated en funciones nuevas: se quita.
revoke execute on function public.accounts_assign_person()            from public, anon, authenticated;
revoke execute on function public.merge_persons(bigint, bigint)       from public, anon, authenticated;
revoke execute on function public.purge_club(bigint)                  from public, anon, authenticated;
