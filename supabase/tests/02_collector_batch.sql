-- Lote de escrituras como las haría el colector (orden del contrato del README).
-- Datos inventados: 2 partidos, 3 cuentas (111 y 222 = Hecodes98 en PS5 y PC).

-- 1. JSON crudo primero
insert into public.match_raw (match_id, club_id, match_type, payload) values
  ('m1', 1330384, 'leagueMatch',   '{"matchId":"m1"}'),
  ('m2', 1330384, 'friendlyMatch', '{"matchId":"m2"}')
on conflict (match_id) do update set payload = excluded.payload, fetched_at = now();

-- 2. Partidos
insert into public.matches (match_id, club_id, match_type, played_at, goals_for, goals_against,
                            outcome, opponent_club_id, opponent_name) values
  ('m1', 1330384, 'leagueMatch',   '2026-11-01T20:00:00Z', 2, 1, 'win',  999, 'Rival A'),
  ('m2', 1330384, 'friendlyMatch', '2026-11-01T21:00:00Z', 0, 1, 'loss', 998, 'Rival B')
on conflict (match_id) do update set
  goals_for = excluded.goals_for, goals_against = excluded.goals_against,
  outcome = excluded.outcome, last_collected_at = now();

-- 3. Cuentas, sin person_id (lo pone el trigger). La 333 cambia de nombre entre lotes.
insert into public.accounts (player_id, last_known_name) values
  ('111', 'Hecodes98'),
  ('222', 'Hecodes98PC'),
  ('333', case when exists (select 1 from public.accounts where player_id = '333')
               then 'PinedaDS' else 'PinedaDS_old' end)
on conflict (player_id) do update set
  last_known_name = excluded.last_known_name, last_seen_at = now();

-- 4. Stats por jugador y partido
insert into public.player_match_stats (
  match_id, player_id, playername, position, archetype_id, rating,
  goals, assists, shots, pass_attempts, passes_made, tackle_attempts, tackles_made,
  is_mom, red_cards, saves, goals_conceded, clean_sheets_def, clean_sheets_gk,
  seconds_played, game_time) values
  ('m1', '111', 'Hecodes98',   'forward',    1, 7.50, 1, 0, 3, 10,  8, 1, 0, true,  0, 0, 1, 0, 0, 5400, 5400),
  ('m1', '333', 'PinedaDS',    'midfielder', 2, 8.00, 1, 1, 2, 20, 15, 4, 3, false, 0, 0, 1, 0, 0, 5400, 5400),
  ('m2', '222', 'Hecodes98PC', 'forward',    1, 6.00, 0, 1, 1, 12,  9, 2, 1, false, 0, 0, 1, 0, 0, 5400, 5400),
  ('m2', '333', 'PinedaDS',    'midfielder', 2, 6.50, 0, 0, 0, 20, 15, 3, 1, false, 0, 0, 1, 0, 0, 5400, 5400)
on conflict (match_id, player_id) do update set
  rating = excluded.rating, goals = excluded.goals, assists = excluded.assists;
