-- ============================================================
-- Migracja 0001: Schemat gry Statki (Battleships)
-- ============================================================

CREATE TYPE game_status AS ENUM ('waiting', 'placing', 'playing', 'finished');
CREATE TYPE shot_result  AS ENUM ('miss', 'hit', 'sunk');

-- ------------------------------------------------------------
-- Tabela: games
-- ------------------------------------------------------------
CREATE TABLE games (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player2_id    UUID                 REFERENCES auth.users(id) ON DELETE SET NULL,
  status        game_status NOT NULL DEFAULT 'waiting',
  current_turn  UUID                 REFERENCES auth.users(id) ON DELETE SET NULL,
  winner_id     UUID                 REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT games_players_different
    CHECK (player2_id IS NULL OR player1_id <> player2_id),
  CONSTRAINT games_current_turn_is_participant
    CHECK (current_turn IS NULL OR current_turn = player1_id OR current_turn = player2_id),
  CONSTRAINT games_winner_is_participant
    CHECK (winner_id IS NULL OR winner_id = player1_id OR winner_id = player2_id),
  CONSTRAINT games_winner_requires_finished
    CHECK (winner_id IS NULL OR status = 'finished'),
  CONSTRAINT games_current_turn_requires_playing
    CHECK (current_turn IS NULL OR status IN ('placing', 'playing'))
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER games_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX games_player1_id_idx ON games (player1_id);
CREATE INDEX games_player2_id_idx ON games (player2_id);
CREATE INDEX games_status_idx      ON games (status);

COMMENT ON TABLE  games              IS 'Rozgrywki — śledzi stan gry i kolejność ruchów';
COMMENT ON COLUMN games.status       IS 'waiting=czeka na gracza2; placing=układanie floty; playing=gra; finished=koniec';
COMMENT ON COLUMN games.current_turn IS 'UUID gracza, który teraz strzela; NULL poza fazą playing';

-- ------------------------------------------------------------
-- Tabela: boards
-- ------------------------------------------------------------
-- ships JSONB: [{ship_def_id, orientation:'h'|'v', cells:[[r,c],...], sunk:false}]
CREATE TABLE boards (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ships      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ready      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT boards_unique_player_per_game UNIQUE (game_id, player_id),
  CONSTRAINT boards_ships_is_array CHECK (jsonb_typeof(ships) = 'array')
);

CREATE INDEX boards_game_id_idx   ON boards (game_id);
CREATE INDEX boards_player_id_idx ON boards (player_id);

COMMENT ON TABLE  boards       IS 'Plansze graczy — układ floty (JSONB), tajne do zakończenia gry';
COMMENT ON COLUMN boards.ships IS 'JSON array: [{ship_def_id, orientation, cells:[[r,c],...], sunk}]';

-- ------------------------------------------------------------
-- Tabela: shots
-- ------------------------------------------------------------
CREATE TABLE shots (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  shooter_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_row  SMALLINT    NOT NULL CHECK (target_row BETWEEN 0 AND 9),
  target_col  SMALLINT    NOT NULL CHECK (target_col BETWEEN 0 AND 9),
  result      shot_result NOT NULL,
  ship_def_id TEXT        CHECK (ship_def_id IS NULL OR ship_def_id IN ('carrier','battleship','cruiser','destroyer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT shots_unique_per_game_target
    UNIQUE (game_id, shooter_id, target_row, target_col),
  CONSTRAINT shots_ship_def_required_on_hit
    CHECK (result = 'miss' OR ship_def_id IS NOT NULL)
);

CREATE INDEX shots_game_id_idx      ON shots (game_id);
CREATE INDEX shots_game_created_idx ON shots (game_id, created_at DESC);

COMMENT ON TABLE  shots             IS 'Historia strzałów — jeden wiersz = jeden strzał';
COMMENT ON COLUMN shots.ship_def_id IS 'Który typ statku został trafiony/zatopiony; NULL dla miss';

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE games  ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE shots  ENABLE ROW LEVEL SECURITY;

-- games
CREATE POLICY "games: select own or waiting" ON games
  FOR SELECT USING (
    player1_id = auth.uid() OR player2_id = auth.uid() OR status = 'waiting'
  );

CREATE POLICY "games: insert as player1" ON games
  FOR INSERT WITH CHECK (player1_id = auth.uid());

CREATE POLICY "games: update as participant" ON games
  FOR UPDATE
  USING  (player1_id = auth.uid() OR player2_id = auth.uid() OR (status = 'waiting' AND player2_id IS NULL))
  WITH CHECK (player1_id = auth.uid() OR player2_id = auth.uid());

-- boards
CREATE POLICY "boards: select own always" ON boards
  FOR SELECT USING (player_id = auth.uid());

CREATE POLICY "boards: select opponent after finished" ON boards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = boards.game_id
        AND g.status = 'finished'
        AND (g.player1_id = auth.uid() OR g.player2_id = auth.uid())
    )
  );

CREATE POLICY "boards: insert own" ON boards
  FOR INSERT WITH CHECK (
    player_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_id
        AND (g.player1_id = auth.uid() OR g.player2_id = auth.uid())
    )
  );

CREATE POLICY "boards: update own during placing" ON boards
  FOR UPDATE
  USING (
    player_id = auth.uid()
    AND EXISTS (SELECT 1 FROM games g WHERE g.id = game_id AND g.status = 'placing')
  )
  WITH CHECK (player_id = auth.uid());

-- shots
CREATE POLICY "shots: select in own games" ON shots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = shots.game_id
        AND (g.player1_id = auth.uid() OR g.player2_id = auth.uid())
    )
  );

CREATE POLICY "shots: insert as current turn" ON shots
  FOR INSERT WITH CHECK (
    shooter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = game_id
        AND g.status = 'playing'
        AND g.current_turn = auth.uid()
    )
  );

-- ============================================================
-- REALTIME (games + shots; boards celowo pominięte)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE games;
ALTER PUBLICATION supabase_realtime ADD TABLE shots;
