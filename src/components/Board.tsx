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

// Sprawdza czy statek trafiony w (hitRow, hitCol) jest zatopiony.
// Mutuje grid (podaj kopię!): pola statku → 'sunk', pola otaczające → 'miss'.
// Zwraca nazwę zatopionego statku lub null.
function applySinking(
  grid: CellState[][],
  ships: ShipPlacement[],
  hitRow: number,
  hitCol: number,
): string | null {
  const ship = ships.find(s => s.cells.some(([r, c]) => r === hitRow && c === hitCol));
  if (!ship) return null;

  const allHit = ship.cells.every(([r, c]) =>
    grid[r][c] === 'hit' || grid[r][c] === 'sunk'
  );
  if (!allHit) return null;

  const shipSet = new Set(ship.cells.map(([r, c]) => `${r}-${c}`));
  ship.cells.forEach(([r, c]) => { grid[r][c] = 'sunk'; });

  for (const [sr, sc] of ship.cells) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = sr + dr, nc = sc + dc;
        if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && !shipSet.has(`${nr}-${nc}`) && grid[nr][nc] === 'empty') {
          grid[nr][nc] = 'miss';
        }
      }
    }
  }

  return FLEET.find(f => f.id === ship.ship_def_id)?.name ?? 'Statek';
}

function allShipsSunk(grid: CellState[][], ships: ShipPlacement[]): boolean {
  return ships.every(ship => ship.cells.every(([r, c]) => grid[r][c] === 'sunk'));
}

interface Props { gameId?: string; onBackToLobby?: () => void; }

export default function Board({ gameId, onBackToLobby }: Props) {
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

  // Powiadomienie o zatopieniu
  const [sunkNote, setSunkNote] = useState<{ who: 'enemy' | 'mine'; name: string } | null>(null);

  // Wynik gry + statystyki
  const [gameResult, setGameResult] = useState<'win' | 'lose' | null>(null);
  const [myShotCount, setMyShotCount] = useState(0);
  const [gameDurationSec, setGameDurationSec] = useState(0);
  const gameStartTimeRef = useRef<number | null>(null);

  // Refy dla callbacków Realtime (unikamy stale closure)
  const phaseRef        = useRef<BoardPhase>('placing');
  const opponentIdRef   = useRef<string | null>(null);
  const enemyShipsRef   = useRef<ShipPlacement[]>([]);
  const myGridRef       = useRef<CellState[][]>(initGrid());
  const placedShipsRef  = useRef<ShipPlacement[]>([]);
  const channelRef      = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const shotsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { myGridRef.current = myGrid; }, [myGrid]);
  useEffect(() => { placedShipsRef.current = placedShips; }, [placedShips]);

  const isMyTurn = currentTurn === myId;

  function finishGame(result: 'win' | 'lose') {
    const elapsed = gameStartTimeRef.current ? Math.round((Date.now() - gameStartTimeRef.current) / 1000) : 0;
    setGameDurationSec(elapsed);
    setGameResult(result);
  }

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
            winner_id: string | null;
          };

          if (g.status === 'finished') {
            finishGame(g.winner_id === myId ? 'win' : 'lose');
            return;
          }

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
                      const newGrid = myGridRef.current.map(r => [...r]);
                      newGrid[shot.target_row][shot.target_col] = st;

                      let sunkName: string | null = null;
                      if (st === 'hit') {
                        sunkName = applySinking(newGrid, placedShipsRef.current, shot.target_row, shot.target_col);
                      }

                      setMyGrid(newGrid);
                      myGridRef.current = newGrid;

                      // Sprawdź czy wszystkie moje statki są zatopione → przegrałem
                      if (allShipsSunk(newGrid, placedShipsRef.current)) {
                        finishGame('lose');
                        return;
                      }

                      const key = `${shot.target_row}-${shot.target_col}`;
                      if (sunkName) {
                        setSunkNote({ who: 'mine', name: sunkName });
                        setTimeout(() => setSunkNote(null), 3000);
                      } else if (st === 'hit') {
                        setMyExplodingCells(prev => new Set(prev).add(key));
                        setTimeout(() => setMyExplodingCells(prev => { const n = new Set(prev); n.delete(key); return n; }), 700);
                      } else {
                        playSplash();
                      }
                    }
                  }
                )
                .subscribe();

              gameStartTimeRef.current = Date.now();
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

    // Aktualizacja lokalna + wykrycie zatopienia
    const newEnemyGrid = enemyGrid.map(r => [...r]);
    newEnemyGrid[row][col] = result;

    let sunkName: string | null = null;
    if (result === 'hit') {
      sunkName = applySinking(newEnemyGrid, enemyShipsRef.current, row, col);
    }

    setEnemyGrid(newEnemyGrid);

    const key = `${row}-${col}`;
    if (sunkName) {
      setSunkNote({ who: 'enemy', name: sunkName });
      setTimeout(() => setSunkNote(null), 3000);
    } else if (result === 'hit') {
      setExplodingCells(prev => new Set(prev).add(key));
      setTimeout(() => setExplodingCells(prev => { const n = new Set(prev); n.delete(key); return n; }), 700);
    } else {
      playSplash();
    }

    // Zapis strzału do bazy
    await supabase.from('shots').insert({
      game_id: gameId,
      shooter_id: myId,
      target_row: row,
      target_col: col,
      result,
      ship_def_id: isHit ? findShipDefId(enemyShipsRef.current, row, col) : null,
    });

    setMyShotCount(c => c + 1);

    // Sprawdź koniec gry
    if (allShipsSunk(newEnemyGrid, enemyShipsRef.current)) {
      await supabase.from('games')
        .update({ status: 'finished', winner_id: myId })
        .eq('id', gameId);
      finishGame('win');
      return;
    }

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
    isShootable = false,
  ) {
    return (
      <div
        className="flex flex-col"
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
                shootable={isShootable && grid[r][c] === 'empty'}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  // ── Widok rozmieszczania ──
  if (phase === 'placing' || phase === 'waiting') {
    return (
      <div className="flex gap-8 items-start">
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
          {phase === 'waiting' && (
            <p className="text-teal-400 text-sm text-center font-semibold animate-pulse">
              ⏳ Czekam aż przeciwnik rozstawi flotę…
            </p>
          )}
          {renderGrid(
            myGrid,
            myExplodingCells,
            cellOrientations,
            phase === 'placing' ? handlePlaceShip : undefined,
            phase === 'placing' ? (r, c) => setHoveredCell({ row: r, col: c }) : undefined,
            phase === 'placing' ? previewCells : undefined,
          )}
        </div>
      </div>
    );
  }

  // ── Ekran końca gry ──
  if (gameResult) {
    const win = gameResult === 'win';
    const mins = Math.floor(gameDurationSec / 60);
    const secs = gameDurationSec % 60;
    const durationStr = mins > 0
      ? `${mins} min ${secs} sek`
      : `${secs} sek`;

    return (
      <div className="flex flex-col items-center gap-8 text-center">

        {/* Nagłówek wyniku */}
        <div className={`
          flex flex-col items-center gap-3 px-16 py-8 rounded-2xl border-2
          ${win
            ? 'bg-yellow-950/40 border-yellow-500'
            : 'bg-red-950/40 border-red-700'}
        `}>
          <span className="text-8xl">{win ? '🏆' : '💀'}</span>
          <h2 className={`text-5xl font-extrabold tracking-widest uppercase ${win ? 'text-yellow-300' : 'text-red-400'}`}>
            {win ? 'Wygrałeś!' : 'Przegrałeś!'}
          </h2>
          <p className="text-slate-400 text-base">
            {win
              ? 'Cała flota przeciwnika została zatopiona.'
              : 'Twoja flota została całkowicie zatopiona.'}
          </p>
        </div>

        {/* Statystyki */}
        <div className="flex gap-6">
          <div className="flex flex-col items-center gap-1 px-8 py-4 rounded-xl bg-slate-800 border border-slate-600">
            <span className="text-3xl">⏱️</span>
            <span className="text-2xl font-bold text-white">{durationStr}</span>
            <span className="text-slate-400 text-xs uppercase tracking-wide">Czas gry</span>
          </div>
          <div className="flex flex-col items-center gap-1 px-8 py-4 rounded-xl bg-slate-800 border border-slate-600">
            <span className="text-3xl">🎯</span>
            <span className="text-2xl font-bold text-white">{myShotCount}</span>
            <span className="text-slate-400 text-xs uppercase tracking-wide">Twoje strzały</span>
          </div>
        </div>

        {/* Obie plansze poglądowo */}
        <div className="flex gap-8 items-start">
          <div className="flex flex-col gap-2">
            <p className="text-slate-400 text-xs text-center font-semibold tracking-wide">TWOJA PLANSZA</p>
            {renderGrid(myGrid, new Set(), cellOrientations)}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-slate-400 text-xs text-center font-semibold tracking-wide">PLANSZA PRZECIWNIKA</p>
            {renderGrid(enemyGrid, new Set(), {})}
          </div>
        </div>

        {/* Przycisk */}
        {onBackToLobby && (
          <button
            onClick={onBackToLobby}
            className="px-10 py-4 rounded-xl bg-teal-700 hover:bg-teal-600 border border-teal-500
                       text-white font-bold text-xl tracking-wide transition-colors"
          >
            NOWA GRA
          </button>
        )}

      </div>
    );
  }

  // ── Widok gry (playing) ──
  return (
    <div className="flex flex-col items-center gap-4 w-full">

      {/* Baner tury */}
      <div className={`
        w-full max-w-fit px-8 py-3 rounded-xl border text-center font-bold text-lg tracking-wide
        transition-colors duration-300
        ${isMyTurn
          ? 'bg-green-900/60 border-green-500 text-green-300'
          : 'bg-slate-800/60 border-slate-600 text-slate-400 animate-pulse'}
      `}>
        {isMyTurn ? '⚔️ Twoja tura — kliknij na planszę przeciwnika' : '⏳ Tura przeciwnika — poczekaj…'}
      </div>

      {/* Powiadomienie o zatopieniu */}
      {sunkNote && (
        <div className={`
          px-6 py-2 rounded-xl border font-bold text-base tracking-wide
          animate-pulse
          ${sunkNote.who === 'enemy'
            ? 'bg-green-900/80 border-green-400 text-green-200'
            : 'bg-red-950/80 border-red-500 text-red-300'}
        `}>
          {sunkNote.who === 'enemy'
            ? `💀 Zatopiony! ${sunkNote.name}`
            : `💥 Twój ${sunkNote.name} zatopiony!`}
        </div>
      )}

      {/* Dwie plansze */}
      <div className="flex gap-8 items-start">

        {/* Własna plansza */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-slate-800 border border-slate-600">
            <span className="text-blue-400 text-base">🛡️</span>
            <span className="text-slate-200 text-sm font-bold tracking-wide">TWOJA PLANSZA</span>
          </div>
          {renderGrid(myGrid, myExplodingCells, cellOrientations)}
        </div>

        {/* Separator */}
        <div className="self-stretch flex items-center">
          <div className="h-full w-px bg-slate-700" />
        </div>

        {/* Plansza przeciwnika */}
        <div className="flex flex-col gap-2">
          <div className={`
            flex items-center justify-center gap-2 py-2 px-4 rounded-lg border
            transition-colors duration-300
            ${isMyTurn
              ? 'bg-green-900/40 border-green-600'
              : 'bg-slate-800 border-slate-600'}
          `}>
            <span className="text-base">🎯</span>
            <span className={`text-sm font-bold tracking-wide ${isMyTurn ? 'text-green-300' : 'text-slate-400'}`}>
              PLANSZA PRZECIWNIKA
            </span>
          </div>
          {renderGrid(enemyGrid, explodingCells, {}, handleShoot, undefined, undefined, isMyTurn)}
        </div>

      </div>
    </div>
  );
}
