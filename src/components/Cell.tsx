import type { CellState } from '../store/boardTypes';

interface CellProps {
  state: CellState;
  onClick: () => void;
  isExploding?: boolean;
  shipOrientation?: 'h' | 'v';
}

function getBg(state: CellState, shipOrientation?: 'h' | 'v'): string {
  switch (state) {
    case 'empty': return 'cell-ocean';
    case 'ship':  return shipOrientation === 'v' ? 'cell-camo-v' : 'cell-camo';
    case 'hit':   return 'bg-red-600 hover:bg-red-500';
    case 'miss':  return 'bg-white hover:bg-gray-100';
  }
}

// Symbol wyświetlany na polu
const SYMBOL: Record<CellState, string> = {
  empty: '🐟',
  ship:  '',
  hit:   '💥',
  miss:  '✕',
};

// Rozmiar symbolu
const SYMBOL_CLASS: Record<CellState, string> = {
  empty: 'text-base opacity-40 fish-yellow',
  ship:  '',
  hit:   'text-4xl',
  miss:  'text-base font-bold',
};

export default function Cell({ state, onClick, isExploding, shipOrientation }: CellProps) {
  return (
    <button
      onClick={onClick}
      className={`
        w-[54px] h-[54px] sm:w-[60px] sm:h-[60px]
        border border-blue-950
        flex items-center justify-center
        select-none overflow-hidden
        transition-[filter] duration-100
        ${getBg(state, shipOrientation)}
        ${state === 'miss' ? 'text-gray-500' : 'text-white'}
      `}
    >
      <span className={`${SYMBOL_CLASS[state]} ${state === 'hit' && isExploding ? 'cell-exploding' : ''}`}>
        {SYMBOL[state]}
      </span>
    </button>
  );
}
