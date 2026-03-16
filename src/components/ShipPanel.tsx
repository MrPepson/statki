import type { ShipDef } from '../store/boardTypes';

interface Props {
  fleet: ShipDef[];
  remaining: Record<string, number>;
  selectedId: string | null;
  orientation: 'h' | 'v';
  onSelect: (id: string) => void;
  onRotate: () => void;
  onReset: () => void;
  onRandom: () => void;
  onReady: () => void;
}

export default function ShipPanel({ fleet, remaining, selectedId, orientation, onSelect, onRotate, onReset, onRandom, onReady }: Props) {
  const allPlaced = fleet.every(s => remaining[s.id] === 0);

  return (
    <div className="w-52 flex flex-col gap-3">
      <h2 className="text-white font-bold text-lg text-center">Twoja flota</h2>

      {/* Przycisk obrotu statku */}
      <button
        onClick={onRotate}
        className="w-full py-2 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500
                   text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
      >
        <span className="text-base leading-none">↻</span>
        <span>OBRÓĆ</span>
        <span className="text-slate-400 text-xs">
          {orientation === 'h' ? '↔' : '↕'} [R]
        </span>
      </button>

      {/* Lista statków */}
      <div className="flex flex-col gap-2">
        {fleet.map(ship => {
          const rem = remaining[ship.id];
          const placed = rem === 0;
          const selected = selectedId === ship.id;

          return (
            <button
              key={ship.id}
              onClick={() => !placed && onSelect(ship.id)}
              disabled={placed}
              className={`
                w-full p-3 rounded-lg border text-left
                transition-colors duration-150
                ${selected
                  ? 'border-yellow-400 bg-slate-600 ring-1 ring-yellow-400/50'
                  : placed
                    ? 'border-slate-700 bg-slate-800/40 opacity-40 cursor-not-allowed'
                    : 'border-slate-600 bg-slate-800 hover:border-slate-400 hover:bg-slate-700 cursor-pointer'
                }
              `}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-white">{ship.name}</span>
                <span className={`text-xs font-mono ${placed ? 'text-slate-500' : 'text-slate-300'}`}>
                  {rem}/{ship.count}
                </span>
              </div>
              {/* Wizualizacja długości statku */}
              <div className="flex gap-0.5">
                {Array.from({ length: ship.size }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-4 w-6 border ${
                      placed
                        ? 'bg-slate-600 border-slate-500'
                        : selected
                          ? 'cell-camo border-slate-400'
                          : 'bg-slate-500 border-slate-400'
                    }`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Reset planszy */}
      <button
        onClick={onReset}
        className="w-full py-2 rounded-lg bg-slate-700 hover:bg-red-900 border border-slate-500
                   text-slate-300 hover:text-white text-sm font-semibold transition-colors"
      >
        ✕ RESET
      </button>

      {/* Losowe rozmieszczenie */}
      <button
        onClick={onRandom}
        className="w-full py-2 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500
                   text-white text-sm font-semibold transition-colors"
      >
        🎲 LOSOWE ROZMIESZCZENIE
      </button>

      {/* Przycisk GOTOWY */}
      <button
        onClick={onReady}
        disabled={!allPlaced}
        className={`
          w-full py-3 rounded-lg border text-base font-bold tracking-wide transition-colors duration-150
          ${allPlaced
            ? 'bg-green-600 hover:bg-green-500 border-green-400 text-white cursor-pointer'
            : 'bg-slate-800 border-slate-700 text-slate-600 cursor-not-allowed'
          }
        `}
      >
        {allPlaced ? '✓ GOTOWY' : 'GOTOWY'}
      </button>

      <p className="text-slate-500 text-xs text-center">
        PPM na planszy = obrót
      </p>
    </div>
  );
}
