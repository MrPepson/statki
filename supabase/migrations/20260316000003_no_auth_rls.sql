-- Usuwamy polityki RLS oparte na auth.uid() i zastępujemy otwartymi.
-- Gra używa UUID gracza z localStorage – nie ma Supabase Auth.

-- games
DROP POLICY IF EXISTS "games: select own or waiting"   ON games;
DROP POLICY IF EXISTS "games: insert as player1"        ON games;
DROP POLICY IF EXISTS "games: update as participant"    ON games;

CREATE POLICY "games: select all"  ON games FOR SELECT USING (true);
CREATE POLICY "games: insert all"  ON games FOR INSERT WITH CHECK (true);
CREATE POLICY "games: update all"  ON games FOR UPDATE USING (true) WITH CHECK (true);

-- boards
DROP POLICY IF EXISTS "boards: select own always"            ON boards;
DROP POLICY IF EXISTS "boards: select opponent after finished" ON boards;
DROP POLICY IF EXISTS "boards: insert own"                   ON boards;
DROP POLICY IF EXISTS "boards: update own during placing"    ON boards;

CREATE POLICY "boards: select all" ON boards FOR SELECT USING (true);
CREATE POLICY "boards: insert all" ON boards FOR INSERT WITH CHECK (true);
CREATE POLICY "boards: update all" ON boards FOR UPDATE USING (true) WITH CHECK (true);

-- shots
DROP POLICY IF EXISTS "shots: select in own games"   ON shots;
DROP POLICY IF EXISTS "shots: insert as current turn" ON shots;

CREATE POLICY "shots: select all" ON shots FOR SELECT USING (true);
CREATE POLICY "shots: insert all" ON shots FOR INSERT WITH CHECK (true);
