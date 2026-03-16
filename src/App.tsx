import Board from './components/Board';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-8 p-4">
      <h1 className="text-white text-4xl font-bold tracking-wide">
        Statki – Multiplayer
      </h1>
      <Board />
    </div>
  )
}
