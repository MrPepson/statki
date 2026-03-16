import { useState } from 'react';
import Cell from './Cell';
import type { CellState } from '../store/boardTypes';

const ROWS = ['A','B','C','D','E','F','G','H','I','J'];
const COLS = [1,2,3,4,5,6,7,8,9,10];

// Testowe statki: kilka pól z góry oznaczonych jako 'ship'
const TEST_SHIPS = new Set([
  '1-3','1-4','1-5',
  '4-7','5-7','6-7',
  '8-1',
]);

function initGrid(): CellState[][] {
  return ROWS.map((_, r) =>
    COLS.map((_, c) => (TEST_SHIPS.has(`${r}-${c}`) ? 'ship' : 'empty'))
  );
}

// Pole ma pionowego sąsiada → orientacja pionowa, w przeciwnym razie pozioma
function computeOrientations(ships: Set<string>): Record<string, 'h' | 'v'> {
  const result: Record<string, 'h' | 'v'> = {};
  for (const key of ships) {
    const [r, c] = key.split('-').map(Number);
    const vertical = ships.has(`${r - 1}-${c}`) || ships.has(`${r + 1}-${c}`);
    result[key] = vertical ? 'v' : 'h';
  }
  return result;
}

const SHIP_ORIENTATIONS = computeOrientations(TEST_SHIPS);

// Styl ramki oznaczeń osi
const LABEL_CELL = 'flex items-center justify-center text-sm font-bold text-slate-200 bg-slate-700 border border-slate-500';

export default function Board() {
  const [grid, setGrid] = useState<CellState[][]>(initGrid);
  // Zbiór kluczy "wiersz-kolumna" pól aktualnie odtwarzających animację wybuchu
  const [explodingCells, setExplodingCells] = useState<Set<string>>(new Set());

  function handleClick(row: number, col: number) {
    const current = grid[row][col];

    if (current === 'ship') {
      // Trafienie – zmień stan i odpal animację
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
      setGrid(prev => {
        const next = prev.map(r => [...r]);
        next[row][col] = 'miss';
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col items-center">
      {/* Nagłówek kolumn */}
      <div className="flex">
        {/* Narożnik */}
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
          {/* Etykieta wiersza */}
          <div className={`w-[42px] h-[54px] sm:w-[48px] sm:h-[60px] ${LABEL_CELL}`}>
            {letter}
          </div>

          {/* Pola wiersza */}
          {COLS.map((_, c) => (
            <Cell
              key={c}
              state={grid[r][c]}
              onClick={() => handleClick(r, c)}
              isExploding={explodingCells.has(`${r}-${c}`)}
              shipOrientation={SHIP_ORIENTATIONS[`${r}-${c}`]}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
