import { useState, useMemo, useEffect, useRef } from 'react';
import Cell from './Cell';
import ShipPanel from './ShipPanel';
import type { CellState } from '../store/boardTypes';
import { FLEET } from '../store/shipDefs';
import { playSplash } from '../lib/sounds';
import { supabase, getPlayerId } from '../lib/supabase';
import type { ShipPlacement } from '../lib/supabase';

type BoardPhase = 'placing' | 'waiting' | 'playing';

const ROWS = ['A','B','C','D','E','F','G','H','I','J'];
const COLS = [1,2,3,4,5,6,7,8,9,10];

const LABEL_CELL = 'flex items-center justify-center text-sm font-bold text-slate-200 bg-slate-700 border border-slate-500';

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

function findShipDefId(ships: ShipPlacement[], row: number, col: number): ShipPlacement['ship_def_id'] | null {
  const ship = ships.find(s => s.cells.some(([r, c]) => r === row && c === col));
  return ship?.ship_def_id ?? null;
}

interface Props { gameId?: string; }

export default function Board({ gameId }: Props) {
  const myId = getPlayerId();

  // ── Faza rozmieszczania ──
  const [myGrid, setMyGrid]                     = useState<CellState[][]>(initGrid);
  const [cellOrientations, setCellOrientations] = useState<Record<string, 'h' | 'v'>>({});
  const [placedShips, setPlacedShips]           = useState<ShipPlacement[]>([]);
  const [phase, setPhase]                       = useState<BoardPhase>('placing');
  const [readyError, setReadyError]             = useState<string | null>(null);
  const [remaining, setRemaining]               = useState<Record<string, number>>(
    () => Object.fromEntries(FLEET.map(s => [s.id, s.count]))
  );
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [orientation, setOrientation]       = useState<'h' | 'v'>('h');
  const [hoveredCell, setHoveredCell]       = useState<{ row: number; col: number } | null>(null);

  // ── Faza gry ──
  const [enemyGrid, setEnemyGrid]           = useState<CellState[][]>(initGrid);
  const [currentTurn, setCurrentTurn]       = useState<string | null>(null);
  const [explodingCells, setExplodingCells] = useState<Set<string>>(new Set()); // siatka wroga
  const [myExplodingCells, setMyExplodingCells] = useState<Set<string>>(new Set()); // własna siatka

  // Refy dla callbacków Realtime (unikamy stale closure)
  const phaseRef        = useRef<BoardPhase>('placing');
  const opponentIdRef   = useRef<string | null>(null);
  const enemyShipsRef   = useRef<ShipPlacement[]>([]);
  const channelRef      = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const shotsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const isMyTurn = currentTurn === myId;

  // ── Realtime: nasłuchuj zmian gry i strzałów ──
  useEffect(() => {
    if (!gameId) return;

    channelRef.current = supabase
      .channel(`board:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        async (payload) => {
          const g = payload.new as {
            status: string;
            player1_id: string;
            player2_id: string | null;
            current_turn: string | null;
          };

          if (g.status === 'playing') {
            setCurrentTurn(g.current_turn);

            // Tylko przy pierwszym przejściu do 'playing'
            if (phaseRef.current !== 'playing') {
              const oppId = g.player1_id === myId ? g.player2_id : g.player1_id;
              if (oppId) {
                opponentIdRef.current = oppId;
                const { data } = await supabase
                  .from('boards')
                  .select('ships')
                  .eq('game_id', gameId)
                  .eq('player_id', oppId)
                  .single();
                if (data) enemyShipsRef.current = data.ships as ShipPlacement[];
              }

              // Subskrybuj strzały
              if (shotsChannelRef.current) supabase.removeChannel(shotsChannelRef.current);
              shotsChannelRef.current = supabase
                .channel(`shots:${gameId}`)
                .on(
                  'postgres_changes',
                  { event: 'INSERT', schema: 'public', table: 'shots', filter: `game_id=eq.${gameId}` },
                  (sp) => {
                    const shot = sp.new as {
                      shooter_id: string;
                      target_row: number;
                      target_col: number;
                      result: string;
                    };
                    // Strzał przeciwnika w moją planszę
                    if (shot.shooter_id !== myId) {
                      const st: CellState = shot.result === 'hit' ? 'hit' : 'miss';
                      setMyGrid(prev => {
                        const next = prev.map(r => [...r]);
                        next[shot.target_row][shot.target_col] = st;
                        return next;
                      });
                      const key = `${shot.target_row}-${shot.target_col}`;
                      if (st === 'hit') {
                        setMyExplodingCells(prev => new Set(prev).add(key));
                        setTimeout(() => setMyExplodingCells(prev => { const n = new Set(prev); n.delete(key); return n; }), 700);
                      } else {
                        playSplash();
                      }
                    }
                  }
                )
                .subscribe();

              setPhase('playing');
            }
          }
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (shotsChannelRef.current) supabase.removeChannel(shotsChannelRef.current);
    };
  }, [gameId]);

  // ── Skrót R = obrót ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phase === 'placing' && (e.key === 'r' || e.key === 'R')) {
        setOrientation(o => o === 'h' ? 'v' : 'h');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // ── Podgląd ustawianego statku ──
  const previewCells = useMemo<Map<string, 'valid' | 'invalid'>>(() => {
    const map = new Map<string, 'valid' | 'invalid'>();
    if (phase !== 'placing' || !selectedShipId || !hoveredCell) return map;
    const ship = FLEET.find(s => s.id === selectedShipId)!;
    const cells: Array<[number, number]> = Array.from({ length: ship.size }, (_, i) => [
      orientation === 'v' ? hoveredCell.row + i : hoveredCell.row,
      orientation === 'h' ? hoveredCell.col + i : hoveredCell.col,
    ]);
    const valid = isPlacementValid(myGrid, cells);
    const st: 'valid' | 'invalid' = valid ? 'valid' : 'invalid';
    cells.forEach(([r, c]) => { if (r >= 0 && r < 10 && c >= 0 && c < 10) map.set(`${r}-${c}`, st); });
    return map;
  }, [phase, selectedShipId, hoveredCell, orientation, myGrid]);

  // ── Handlery rozmieszczania ──
  function handleSelectShip(id: string) {
    setSelectedShipId(prev => prev === id ? null : id);
  }

  function handleReset() {
    setMyGrid(initGrid());
    setCellOrientations({});
    setRemaining(Object.fromEntries(FLEET.map(s => [s.id, s.count])));
    setSelectedShipId(null);
    setPlacedShips([]);
  }

  function handleRandom() {
    let result = randomPlacement();
    while (!result) result = randomPlacement();
    setMyGrid(result.grid);
    setCellOrientations(result.orientations);
    setRemaining(Object.fromEntries(FLEET.map(s => [s.id, 0])));
    setSelectedShipId(null);
    setPlacedShips(result.ships);
  }

  async function handleReady() {
    setReadyError(null);
    if (!gameId) { setPhase('playing'); return; }
    try {
      const { error } = await supabase
        .from('boards')
        .upsert(
          { game_id: gameId, player_id: myId, ships: placedShips, ready: true },
          { onConflict: 'game_id,player_id' }
        );
      if (error) throw error;
      setPhase('waiting');
    } catch (e: unknown) {
      setReadyError(e instanceof Error ? e.message : 'Błąd zapisu planszy');
    }
  }

  function handlePlaceShip(row: number, col: number) {
    if (!selectedShipId) return;
    const ship = FLEET.find(s => s.id === selectedShipId)!;
    const cells: Array<[number, number]> = Array.from({ length: ship.size }, (_, i) => [
      orientation === 'v' ? row + i : row,
      orientation === 'h' ? col + i : col,
    ]);
    if (!isPlacementValid(myGrid, cells)) return;

    setMyGrid(prev => {
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
  }

  // ── Handler strzału w planszę przeciwnika ──
  async function handleShoot(row: number, col: number) {
    if (!gameId || !isMyTurn) return;
    if (enemyGrid[row][col] !== 'empty') return;

    const isHit = enemyShipsRef.current.some(ship =>
      ship.cells.some(([r, c]) => r === row && c === col)
    );
    const result: 'hit' | 'miss' = isHit ? 'hit' : 'miss';

    // Aktualizacja lokalna
    setEnemyGrid(prev => {
      const next = prev.map(r => [...r]);
      next[row][col] = result;
      return next;
    });
    const key = `${row}-${col}`;
    if (result === 'hit') {
      setExplodingCells(prev => new Set(prev).add(key));
      setTimeout(() => setExplodingCells(prev => { const n = new Set(prev); n.delete(key); return n; }), 700);
    } else {
      playSplash();
    }

    // Zapis do bazy
    await supabase.from('shots').insert({
      game_id: gameId,
      shooter_id: myId,
      target_row: row,
      target_col: col,
      result,
      ship_def_id: isHit ? findShipDefId(enemyShipsRef.current, row, col) : null,
    });

    // Zmień turę
    if (opponentIdRef.current) {
      await supabase.from('games')
        .update({ current_turn: opponentIdRef.current })
        .eq('id', gameId);
    }
  }

  // ── Renderer siatki ──
  function renderGrid(
    grid: CellState[][],
    exploding: Set<string>,
    orientations: Record<string, 'h' | 'v'>,
    onCellClick?: (r: number, c: number) => void,
    onCellHover?: (r: number, c: number) => void,
    preview?: Map<string, 'valid' | 'invalid'>,
    crosshair = false,
  ) {
    return (
      <div
        className={`flex flex-col ${crosshair ? 'cursor-crosshair' : ''}`}
        onContextMenu={e => {
          e.preventDefault();
          if (phase === 'placing') setOrientation(o => o === 'h' ? 'v' : 'h');
        }}
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
                onClick={() => onCellClick?.(r, c)}
                onMouseEnter={() => onCellHover?.(r, c)}
                onMouseLeave={() => setHoveredCell(null)}
                isExploding={exploding.has(`${r}-${c}`)}
                shipOrientation={orientations[`${r}-${c}`]}
                previewState={preview?.get(`${r}-${c}`)}
              />
            ))}
          </div>
        ))}
      </div>
    );
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

        {/* Status */}
        {phase === 'waiting' && (
          <p className="text-teal-400 text-sm text-center font-semibold animate-pulse">
            ⏳ Czekam aż przeciwnik rozstawi flotę…
          </p>
        )}
        {phase === 'playing' && (
          <p className={`text-sm text-center font-semibold ${isMyTurn ? 'text-green-400' : 'text-slate-400 animate-pulse'}`}>
            {isMyTurn ? '⚔️ Twoja tura – strzelaj!' : '⏳ Tura przeciwnika…'}
          </p>
        )}

        <div className="flex gap-6 items-start">

          {/* Własna plansza */}
          <div className="flex flex-col gap-1">
            {phase === 'playing' && (
              <p className="text-slate-400 text-xs text-center font-semibold">Twoja plansza</p>
            )}
            {renderGrid(
              myGrid,
              myExplodingCells,
              cellOrientations,
              phase === 'placing' ? handlePlaceShip : undefined,
              phase === 'placing' ? (r, c) => setHoveredCell({ row: r, col: c }) : undefined,
              phase === 'placing' ? previewCells : undefined,
              phase === 'placing' && !!selectedShipId,
            )}
          </div>

          {/* Plansza przeciwnika – tylko w fazie playing */}
          {phase === 'playing' && (
            <div className="flex flex-col gap-1">
              <p className="text-slate-400 text-xs text-center font-semibold">Plansza przeciwnika</p>
              {renderGrid(
                enemyGrid,
                explodingCells,
                {},
                handleShoot,
                undefined,
                undefined,
                isMyTurn,
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
