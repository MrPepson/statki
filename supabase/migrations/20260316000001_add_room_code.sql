-- Migracja 0002: kod pokoju do udostępniania innym graczom
ALTER TABLE games ADD COLUMN room_code TEXT UNIQUE;
CREATE INDEX games_room_code_idx ON games (room_code);
COMMENT ON COLUMN games.room_code IS '6-znakowy kod pokoju (A-Z2-9), generowany przez klienta przy tworzeniu gry';
