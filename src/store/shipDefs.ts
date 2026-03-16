import type { ShipDef } from './boardTypes';

// Flota gracza według zasad gry w statki
export const FLEET: ShipDef[] = [
  { id: 'carrier',    name: 'Lotniskowiec', size: 5, count: 1 },
  { id: 'battleship', name: 'Pancernik',    size: 4, count: 1 },
  { id: 'cruiser',    name: 'Krążownik',    size: 3, count: 2 },
  { id: 'destroyer',  name: 'Niszczyciel',  size: 2, count: 1 },
];
