import { useState, useMemo, useEffect } from 'react';
import Cell from './Cell';
import ShipPanel from './ShipPanel';
import type { CellState } from '../store/boardTypes';
import { FLEET } from '../store/shipDefs';
import { playSplash } from '../lib/sounds';

const ROWS = ['A','B','C','D','E','F','G','H','I','J'];
const COLS = [1,2,3,4,5,6,7,8,9,10];

function initGrid(): CellState[][] {
  return Array.from({ length: 10 }, () => Array(10).fill('empty') as CellState[]);
}

// Sprawdza czy statek można postawić: mieści się w siatce, nie nachodzi i nie styka z innymi
function isPlacementValid(grid: CellState[][], cells: Array<[number, number]>): boolean {
  const proposed = new Set(cells.map(([r, c]) => `${r}-${c}`));

  for (const [r, c] of cells) {
    // Wychodzi poza planszę
    if (r < 0 || r >= 10 || c < 0 || c >= 10) return false;
    // Nachodzi na istniejący statek
    if (grid[r][c] !== 'empty') return false;
    // Styka się z istniejącym statkiem (8 kierunków)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (proposed.has(`${nr}-${nc}`)) continue; // własne pole
        if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && grid[nr][nc] === 'ship') return false;
      }
    }
  }
  return true;
}

// Losowo rozmieszcza całą flotę na pustej planszy; zwraca null przy niepowodzeniu (rzadkie)
function randomPlacement(): { grid: CellState[][], orientations: Record<string, 'h' | 'v'> } | null {
  const grid: CellState[][] = Array.from({ length: 10 }, () => Array(10).fill('empty'));
  const orientations: Record<string, 'h' | 'v'> = {};

  const ships = FLEET.flatMap(def => Array.from({ length: def.count }, () => def));

  for (const ship of ships) {
    let placed = false;
    for (let attempt = 0; attempt < 300; attempt++) {
      const o: 'h' | 'v' = Math.random() < 0.5 ? 'h' : 'v';
      const r = Math.floor(Math.random() * (o === 'v' ? 10 - ship.size + 1 : 10));
      const c = Math.floor(Math.random() * (o === 'h' ? 10 - ship.size + 1 : 10));
      const cells: Array<[number, number]> = Array.from({ length: ship.size }, (_, i) => [
        o === 'v' ? r + i : r,
        o === 'h' ? c + i : c,
      ]);
      if (isPlacementValid(grid, cells)) {
        cells.forEach(([r, c]) => { grid[r][c] = 'ship'; orientations[`${r}-${c}`] = o; });
        placed = true;
        break;
      }
    }
    if (!placed) return null;
  }
  return { grid, orientations };
}

// Styl ramki oznaczeń osi
const LABEL_CELL = 'flex items-center justify-center text-sm font-bold text-slate-200 bg-slate-700 border border-slate-500';

export default function Board() {
  const [grid, setGrid] = useState<CellState[][]>(initGrid);
  const [cellOrientations, setCellOrientations] = useState<Record<string, 'h' | 'v'>>({});
  const [explodingCells, setExplodingCells] = useState<Set<string>>(new Set());

  // Stan rozmieszczania floty
  const [remaining, setRemaining] = useState<Record<string, number>>(
    () => Object.fromEntries(FLEET.map(s => [s.id, s.count]))
  );
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<'h' | 'v'>('h');
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  // Skrót klawiszowy R = obrót
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'r' || e.key === 'R') {
        setOrientation(o => o === 'h' ? 'v' : 'h');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Oblicz komórki podglądu ustawienia statku
  const previewCells = useMemo<Map<string, 'valid' | 'invalid'>>(() => {
    const map = new Map<string, 'valid' | 'invalid'>();
    if (!selectedShipId || !hoveredCell) return map;

    const ship = FLEET.find(s => s.id === selectedShipId)!;
    const cells: Array<[number, number]> = [];

    for (let i = 0; i < ship.size; i++) {
      const r = orientation === 'v' ? hoveredCell.row + i : hoveredCell.row;
      const c = orientation === 'h' ? hoveredCell.col + i : hoveredCell.col;
      cells.push([r, c]);
    }

    const valid = isPlacementValid(grid, cells);

    const st: 'valid' | 'invalid' = valid ? 'valid' : 'invalid';
    cells.forEach(([r, c]) => {
      if (r >= 0 && r < 10 && c >= 0 && c < 10) map.set(`${r}-${c}`, st);
    });

    return map;
  }, [selectedShipId, hoveredCell, orientation, grid]);

  function handleSelectShip(id: string) {
    setSelectedShipId(prev => prev === id ? null : id);
  }

  function handleReset() {
    setGrid(initGrid());
    setCellOrientations({});
    setRemaining(Object.fromEntries(FLEET.map(s => [s.id, s.count])));
    setSelectedShipId(null);
  }

  function handleRandom() {
    let result = randomPlacement();
    // Próbuj ponownie jeśli algorytm nie znalazł układu za pierwszym razem
    while (!result) result = randomPlacement();
    setGrid(result.grid);
    setCellOrientations(result.orientations);
    setRemaining(Object.fromEntries(FLEET.map(s => [s.id, 0])));
    setSelectedShipId(null);
  }

  function handleReady() {
    // TODO: przejście do fazy gry / powiadomienie serwera
    alert('Flota gotowa! Tu zacznie się gra.');
  }

  function handleClick(row: number, col: number) {
    // ── Tryb rozmieszczania statku ──
    if (selectedShipId) {
      const ship = FLEET.find(s => s.id === selectedShipId)!;
      const cells: Array<[number, number]> = [];
      for (let i = 0; i < ship.size; i++) {
        const r = orientation === 'v' ? row + i : row;
        const c = orientation === 'h' ? col + i : col;
        cells.push([r, c]);
      }
      if (!isPlacementValid(grid, cells)) return;

      // Postaw statek na planszy
      setGrid(prev => {
        const next = prev.map(r => [...r]);
        cells.forEach(([r, c]) => { next[r][c] = 'ship'; });
        return next;
      });
      setCellOrientations(prev => {
        const next = { ...prev };
        cells.forEach(([r, c]) => { next[`${r}-${c}`] = orientation; });
        return next;
      });

      const newRem = remaining[selectedShipId] - 1;
      setRemaining(prev => ({ ...prev, [selectedShipId]: newRem }));

      // Automatycznie wybierz następny dostępny statek
      if (newRem <= 0) {
        const next = FLEET.find(s => s.id !== selectedShipId && remaining[s.id] > 0);
        setSelectedShipId(next?.id ?? null);
      }
      return;
    }

    // ── Tryb ataku (brak wybranego statku) ──
    const current = grid[row][col];
    if (current === 'ship') {
      setGrid(prev => {
        const next = prev.map(r => [...r]);
        next[row][col] = 'hit';
        return next;
      });
      const key = `${row}-${col}`;
      setExplodingCells(prev => new Set(prev).add(key));
      setTimeout(() => {
        setExplodingCells(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 700);
    } else if (current === 'empty') {
      playSplash();
      setGrid(prev => {
        const next = prev.map(r => [...r]);
        next[row][col] = 'miss';
        return next;
      });
    }
  }

  return (
    <div className="flex gap-8 items-start">
      <ShipPanel
        fleet={FLEET}
        remaining={remaining}
        selectedId={selectedShipId}
        orientation={orientation}
        onSelect={handleSelectShip}
        onRotate={() => setOrientation(o => o === 'h' ? 'v' : 'h')}
        onReset={handleReset}
        onRandom={handleRandom}
        onReady={handleReady}
      />

      {/* Siatka planszy */}
      <div
        className={`flex flex-col ${selectedShipId ? 'cursor-crosshair' : ''}`}
        onContextMenu={e => { e.preventDefault(); setOrientation(o => o === 'h' ? 'v' : 'h'); }}
      >
        {/* Nagłówek kolumn */}
        <div className="flex">
          <div className={`w-[42px] h-[42px] sm:w-[48px] sm:h-[48px] ${LABEL_CELL}`} />
          {COLS.map(c => (
            <div key={c} className={`w-[54px] h-[42px] sm:w-[60px] sm:h-[48px] ${LABEL_CELL}`}>
              {c}
            </div>
          ))}
        </div>

        {/* Wiersze planszy */}
        {ROWS.map((letter, r) => (
          <div key={letter} className="flex">
            <div className={`w-[42px] h-[54px] sm:w-[48px] sm:h-[60px] ${LABEL_CELL}`}>
              {letter}
            </div>
            {COLS.map((_, c) => (
              <Cell
                key={c}
                state={grid[r][c]}
                onClick={() => handleClick(r, c)}
                onMouseEnter={() => setHoveredCell({ row: r, col: c })}
                onMouseLeave={() => setHoveredCell(null)}
                isExploding={explodingCells.has(`${r}-${c}`)}
                shipOrientation={cellOrientations[`${r}-${c}`]}
                previewState={previewCells.get(`${r}-${c}`)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
