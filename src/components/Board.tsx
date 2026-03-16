import { useState, useMemo, useEffect, useRef } from 'react';
import Cell from './Cell';
import ShipPanel from './ShipPanel';
import type { CellState } from '../store/boardTypes';
import { FLEET } from '../store/shipDefs';
import { playSplash } from '../lib/sounds';
import { supabase } from '../lib/supabase';
import type { ShipPlacement } from '../lib/supabase';

// Fazy planszy z perspektywy gracza
type BoardPhase = 'placing' | 'waiting' | 'playing';

const ROWS = ['A','B','C','D','E','F','G','H','I','J'];
const COLS = [1,2,3,4,5,6,7,8,9,10];

function initGrid(): CellState[][] {
  return Array.from({ length: 10 }, () => Array(10).fill('empty') as CellState[]);
}

function isPlacementValid(grid: CellState[][], cells: Array<[number, number]>): boolean {
  const proposed = new Set(cells.map(([r, c]) => `${r}-${c}`));
  for (const [r, c] of cells) {
    if (r < 0 || r >= 10 || c < 0 || c >= 10) return false;
    if (grid[r][c] !== 'empty') return false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (proposed.has(`${nr}-${nc}`)) continue;
        if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && grid[nr][nc] === 'ship') return false;
      }
    }
  }
  return true;
}

function randomPlacement(): {
  grid: CellState[][];
  orientations: Record<string, 'h' | 'v'>;
  ships: ShipPlacement[];
} | null {
  const grid: CellState[][] = Array.from({ length: 10 }, () => Array(10).fill('empty'));
  const orientations: Record<string, 'h' | 'v'> = {};
  const ships: ShipPlacement[] = [];
  const defs = FLEET.flatMap(def => Array.from({ length: def.count }, () => def));

  for (const def of defs) {
    let placed = false;
    for (let attempt = 0; attempt < 300; attempt++) {
      const o: 'h' | 'v' = Math.random() < 0.5 ? 'h' : 'v';
      const r = Math.floor(Math.random() * (o === 'v' ? 10 - def.size + 1 : 10));
      const c = Math.floor(Math.random() * (o === 'h' ? 10 - def.size + 1 : 10));
      const cells: Array<[number, number]> = Array.from({ length: def.size }, (_, i) => [
        o === 'v' ? r + i : r,
        o === 'h' ? c + i : c,
      ]);
      if (isPlacementValid(grid, cells)) {
        cells.forEach(([r, c]) => { grid[r][c] = 'ship'; orientations[`${r}-${c}`] = o; });
        ships.push({ ship_def_id: def.id as ShipPlacement['ship_def_id'], orientation: o, cells, sunk: false });
        placed = true;
        break;
      }
    }
    if (!placed) return null;
  }
  return { grid, orientations, ships };
}

const LABEL_CELL = 'flex items-center justify-center text-sm font-bold text-slate-200 bg-slate-700 border border-slate-500';

interface Props {
  gameId?: string;
}

export default function Board({ gameId }: Props) {
  const [grid, setGrid]                   = useState<CellState[][]>(initGrid);
  const [cellOrientations, setCellOrientations] = useState<Record<string, 'h' | 'v'>>({});
  const [explodingCells, setExplodingCells] = useState<Set<string>>(new Set());
  const [placedShips, setPlacedShips]     = useState<ShipPlacement[]>([]);
  const [phase, setPhase]                 = useState<BoardPhase>('placing');
  const [readyError, setReadyError]       = useState<string | null>(null);

  // Stan rozmieszczania floty
  const [remaining, setRemaining] = useState<Record<string, number>>(
    () => Object.fromEntries(FLEET.map(s => [s.id, s.count]))
  );
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [orientation, setOrientation]       = useState<'h' | 'v'>('h');
  const [hoveredCell, setHoveredCell]       = useState<{ row: number; col: number } | null>(null);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Realtime: nasłuchuj zmiany statusu gry → przejdź do fazy 'playing'
  useEffect(() => {
    if (!gameId) return;
    channelRef.current = supabase
      .channel(`board:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          if ((payload.new as { status: string }).status === 'playing') {
            setPhase('playing');
          }
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [gameId]);

  // Skrót R = obrót (tylko w fazie placing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phase === 'placing' && (e.key === 'r' || e.key === 'R')) {
        setOrientation(o => o === 'h' ? 'v' : 'h');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const previewCells = useMemo<Map<string, 'valid' | 'invalid'>>(() => {
    const map = new Map<string, 'valid' | 'invalid'>();
    if (phase !== 'placing' || !selectedShipId || !hoveredCell) return map;
    const ship = FLEET.find(s => s.id === selectedShipId)!;
    const cells: Array<[number, number]> = Array.from({ length: ship.size }, (_, i) => [
      orientation === 'v' ? hoveredCell.row + i : hoveredCell.row,
      orientation === 'h' ? hoveredCell.col + i : hoveredCell.col,
    ]);
    const valid = isPlacementValid(grid, cells);
    const st: 'valid' | 'invalid' = valid ? 'valid' : 'invalid';
    cells.forEach(([r, c]) => { if (r >= 0 && r < 10 && c >= 0 && c < 10) map.set(`${r}-${c}`, st); });
    return map;
  }, [phase, selectedShipId, hoveredCell, orientation, grid]);

  function handleSelectShip(id: string) {
    setSelectedShipId(prev => prev === id ? null : id);
  }

  function handleReset() {
    setGrid(initGrid());
    setCellOrientations({});
    setRemaining(Object.fromEntries(FLEET.map(s => [s.id, s.count])));
    setSelectedShipId(null);
    setPlacedShips([]);
  }

  function handleRandom() {
    let result = randomPlacement();
    while (!result) result = randomPlacement();
    setGrid(result.grid);
    setCellOrientations(result.orientations);
    setRemaining(Object.fromEntries(FLEET.map(s => [s.id, 0])));
    setSelectedShipId(null);
    setPlacedShips(result.ships);
  }

  async function handleReady() {
    setReadyError(null);
    if (!gameId) {
      // Tryb lokalny bez Supabase – od razu playing
      setPhase('playing');
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Nie jesteś zalogowany.');

      const { error } = await supabase
        .from('boards')
        .upsert(
          { game_id: gameId, player_id: user.id, ships: placedShips, ready: true },
          { onConflict: 'game_id,player_id' }
        );

      if (error) throw error;
      setPhase('waiting'); // trigger w DB przestawi grę gdy obaj będą gotowi
    } catch (e: unknown) {
      setReadyError(e instanceof Error ? e.message : 'Błąd zapisu planszy');
    }
  }

  function handleClick(row: number, col: number) {
    // ── Tryb rozmieszczania ──
    if (phase === 'placing' && selectedShipId) {
      const ship = FLEET.find(s => s.id === selectedShipId)!;
      const cells: Array<[number, number]> = Array.from({ length: ship.size }, (_, i) => [
        orientation === 'v' ? row + i : row,
        orientation === 'h' ? col + i : col,
      ]);
      if (!isPlacementValid(grid, cells)) return;

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
      setPlacedShips(prev => [...prev, {
        ship_def_id: selectedShipId as ShipPlacement['ship_def_id'],
        orientation, cells, sunk: false,
      }]);

      const newRem = remaining[selectedShipId] - 1;
      setRemaining(prev => ({ ...prev, [selectedShipId]: newRem }));
      if (newRem <= 0) {
        const next = FLEET.find(s => s.id !== selectedShipId && remaining[s.id] > 0);
        setSelectedShipId(next?.id ?? null);
      }
      return;
    }

    // ── Tryb ataku ──
    if (phase !== 'playing') return;
    const current = grid[row][col];
    if (current === 'ship') {
      setGrid(prev => { const next = prev.map(r => [...r]); next[row][col] = 'hit'; return next; });
      const key = `${row}-${col}`;
      setExplodingCells(prev => new Set(prev).add(key));
      setTimeout(() => {
        setExplodingCells(prev => { const next = new Set(prev); next.delete(key); return next; });
      }, 700);
    } else if (current === 'empty') {
      playSplash();
      setGrid(prev => { const next = prev.map(r => [...r]); next[row][col] = 'miss'; return next; });
    }
  }

  return (
    <div className="flex gap-8 items-start">

      {/* Panel boczny – tylko w fazie placing */}
      {phase === 'placing' && (
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
          readyError={readyError ?? undefined}
        />
      )}

      <div className="flex flex-col gap-2">

        {/* Status fazy */}
        {phase === 'waiting' && (
          <p className="text-teal-400 text-sm text-center font-semibold animate-pulse">
            ⏳ Czekam aż przeciwnik rozstawi flotę…
          </p>
        )}
        {phase === 'playing' && (
          <p className="text-green-400 text-sm text-center font-semibold">
            ⚔️ Gra w toku – strzelaj!
          </p>
        )}

        {/* Siatka planszy */}
        <div
          className={`flex flex-col ${phase === 'placing' && selectedShipId ? 'cursor-crosshair' : ''}`}
          onContextMenu={e => { e.preventDefault(); if (phase === 'placing') setOrientation(o => o === 'h' ? 'v' : 'h'); }}
        >
          <div className="flex">
            <div className={`w-[42px] h-[42px] sm:w-[48px] sm:h-[48px] ${LABEL_CELL}`} />
            {COLS.map(c => (
              <div key={c} className={`w-[54px] h-[42px] sm:w-[60px] sm:h-[48px] ${LABEL_CELL}`}>{c}</div>
            ))}
          </div>

          {ROWS.map((letter, r) => (
            <div key={letter} className="flex">
              <div className={`w-[42px] h-[54px] sm:w-[48px] sm:h-[60px] ${LABEL_CELL}`}>{letter}</div>
              {COLS.map((_, c) => (
                <Cell
                  key={c}
                  state={grid[r][c]}
                  onClick={() => handleClick(r, c)}
                  onMouseEnter={() => phase === 'placing' && setHoveredCell({ row: r, col: c })}
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
    </div>
  );
}
