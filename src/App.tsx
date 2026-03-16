import { useState } from 'react';
import Lobby from './components/Lobby';
import Board from './components/Board';

type Screen = 'lobby' | 'game';

export default function App() {
  const [screen, setScreen] = useState<Screen>('lobby');
  // gameId będzie przekazywany do Board gdy zostanie podłączony do Supabase
  const [_gameId, setGameId] = useState<string | null>(null);

  function handleEnterGame(id: string) {
    setGameId(id);
    setScreen('game');
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-8 p-4">
      <h1 className="text-white text-4xl font-bold tracking-wide">
        Statki – Multiplayer
      </h1>

      {screen === 'lobby' && (
        <Lobby onEnterGame={handleEnterGame} />
      )}

      {screen === 'game' && (
        <Board gameId={_gameId ?? undefined} onBackToLobby={() => setScreen('lobby')} />
      )}
    </div>
  );
}
