// Możliwe stany pojedynczego pola planszy
export type CellState = 'empty' | 'ship' | 'hit' | 'miss' | 'sunk';

// Współrzędne pola (wiersz 0–9, kolumna 0–9)
export interface CellCoord {
  row: number;
  col: number;
}

// Definicja typu statku
export interface ShipDef {
  id: string;
  name: string;
  size: number;
  count: number;
}
