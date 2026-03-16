-- Trigger: gdy obaj gracze ustawią ready=true na swoich planszach,
-- automatycznie przestaw grę do fazy 'playing' i przyznaj ruch player1

CREATE OR REPLACE FUNCTION check_both_boards_ready()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  ready_count INT;
  first_player UUID;
BEGIN
  SELECT COUNT(*) INTO ready_count
  FROM boards
  WHERE game_id = NEW.game_id AND ready = TRUE;

  IF ready_count = 2 THEN
    SELECT player1_id INTO first_player
    FROM games WHERE id = NEW.game_id;

    UPDATE games
    SET status       = 'playing',
        current_turn = first_player
    WHERE id     = NEW.game_id
      AND status = 'placing';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER boards_ready_check
  AFTER UPDATE OF ready ON boards
  FOR EACH ROW
  WHEN (NEW.ready = TRUE AND OLD.ready = FALSE)
  EXECUTE FUNCTION check_both_boards_ready();
