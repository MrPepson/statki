import type { CellState } from '../store/boardTypes';

interface CellProps {
  state: CellState;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isExploding?: boolean;
  shipOrientation?: 'h' | 'v';
  previewState?: 'valid' | 'invalid';
  shootable?: boolean; // puste pole planszy wroga, można kliknąć
}

function getBg(state: CellState, shipOrientation?: 'h' | 'v'): string {
  switch (state) {
    case 'empty': return 'cell-ocean';
    case 'ship':  return shipOrientation === 'v' ? 'cell-camo-v' : 'cell-camo';
    case 'hit':   return 'bg-red-600 hover:bg-red-500';
    case 'miss':  return 'bg-white hover:bg-gray-100';
    case 'sunk':  return 'bg-red-950';
  }
}

const SYMBOL: Record<CellState, string> = {
  empty: '🐟',
  ship:  '',
  hit:   '💥',
  miss:  '✕',
  sunk:  '💀',
};

const SYMBOL_CLASS: Record<CellState, string> = {
  empty: 'text-base opacity-40 fish-yellow',
  ship:  '',
  hit:   'text-4xl',
  miss:  'text-base font-bold',
  sunk:  'text-2xl',
};

export default function Cell({ state, onClick, onMouseEnter, onMouseLeave, isExploding, shipOrientation, previewState, shootable }: CellProps) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`
        relative
        w-[54px] h-[54px] sm:w-[60px] sm:h-[60px]
        border border-blue-950
        flex items-center justify-center
        select-none overflow-hidden
        transition-[filter,background-color] duration-100
        ${getBg(state, shipOrientation)}
        ${state === 'miss' ? 'text-gray-500' : 'text-white'}
        ${shootable ? 'hover:brightness-150 cursor-crosshair' : ''}
      `}
    >
      <span className={`${SYMBOL_CLASS[state]} ${state === 'hit' && isExploding ? 'cell-exploding' : ''}`}>
        {SYMBOL[state]}
      </span>
      {previewState && (
        <div className={`absolute inset-0 pointer-events-none ${
          previewState === 'valid' ? 'bg-green-400/50' : 'bg-red-500/50'
        }`} />
      )}
    </button>
  );
}
