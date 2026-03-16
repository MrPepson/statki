-- Usuwamy foreign key constraints do auth.users – gracz używa UUID z localStorage
ALTER TABLE games  DROP CONSTRAINT games_player1_id_fkey;
ALTER TABLE games  DROP CONSTRAINT games_player2_id_fkey;
ALTER TABLE games  DROP CONSTRAINT games_current_turn_fkey;
ALTER TABLE games  DROP CONSTRAINT games_winner_id_fkey;
ALTER TABLE boards DROP CONSTRAINT boards_player_id_fkey;
ALTER TABLE shots  DROP CONSTRAINT shots_shooter_id_fkey;
