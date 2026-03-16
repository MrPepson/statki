// Możliwe stany pojedynczego pola planszy
export type CellState = 'empty' | 'ship' | 'hit' | 'miss';

// Współrzędne pola (wiersz 0–9, kolumna 0–9)
export interface CellCoord {
  row: number;
  col: number;
}
