-- Stary trigger działał tylko na UPDATE; upsert przy pierwszym zapisie robi INSERT → trigger nie strzelał
DROP TRIGGER IF EXISTS boards_ready_check ON boards;

CREATE TRIGGER boards_ready_check
  AFTER INSERT OR UPDATE OF ready ON boards
  FOR EACH ROW
  WHEN (NEW.ready = TRUE)
  EXECUTE FUNCTION check_both_boards_ready();
