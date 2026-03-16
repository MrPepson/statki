import { useState, useEffect, useRef } from 'react';
import { supabase, getPlayerId } from '../lib/supabase';

const NICKNAME_KEY = 'statki_nickname';
const CODE_CHARS    = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join('');
}

interface Props {
  onEnterGame: (gameId: string) => void;
}

export default function Lobby({ onEnterGame }: Props) {
  const [nickname, setNickname] = useState(
    () => sessionStorage.getItem(NICKNAME_KEY) ?? ''
  );
  const [joinCode, setJoinCode]       = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [waiting, setWaiting]         = useState(false); // player1 czeka na gracza 2
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Referencja do kanału Realtime – potrzebna do cleanup
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Posprzątaj kanał przy odmontowaniu komponentu
  useEffect(() => {
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  function handleNicknameChange(value: string) {
    setNickname(value);
    sessionStorage.setItem(NICKNAME_KEY, value);
  }

  // Subskrybuj zmiany statusu gry – player1 czeka na player2
  function subscribeToGame(gameId: string) {
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    channelRef.current = supabase
      .channel(`lobby:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          const status = (payload.new as { status: string }).status;
          // Gdy player2 dołączył (placing) lub obaj gotowi (playing) – przejdź do planszy
          if (status === 'placing' || status === 'playing') {
            onEnterGame(gameId);
          }
        }
      )
      .subscribe();
  }

  async function handleCreate() {
    if (!nickname.trim()) { setError('Podaj pseudonim przed stworzeniem gry.'); return; }
    setLoading(true); setError(null); setCreatedCode(null); setWaiting(false);
    try {
      const userId = getPlayerId();
      let gameId = '', roomCode = '';
      for (let i = 0; i < 5; i++) {
        roomCode = generateRoomCode();
        const { data, error: insertError } = await supabase
          .from('games')
          .insert({ player1_id: userId, status: 'waiting', room_code: roomCode })
          .select('id')
          .single();
        if (!insertError) { gameId = data.id; break; }
        if (!insertError.message.includes('unique')) throw insertError;
      }
      if (!gameId) throw new Error('Nie udało się wygenerować unikalnego kodu.');
      setCreatedCode(roomCode);
      setWaiting(true);
      subscribeToGame(gameId); // auto-przekierowanie gdy player2 dołączy
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nieznany błąd');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!nickname.trim()) { setError('Podaj pseudonim przed dołączeniem.'); return; }
    if (!joinCode.trim()) { setError('Podaj kod pokoju.'); return; }
    setLoading(true); setError(null);
    try {
      const userId = getPlayerId();
      const code = joinCode.trim().toUpperCase();

      const { data: game, error: findError } = await supabase
        .from('games')
        .select('id, player1_id')
        .eq('room_code', code)
        .eq('status', 'waiting')
        .is('player2_id', null)
        .single();

      if (findError || !game) throw new Error('Nie znaleziono gry. Sprawdź kod pokoju.');
      if (game.player1_id === userId) throw new Error('To twoja własna gra – poczekaj na drugiego gracza.');

      const { error: joinError } = await supabase
        .from('games')
        .update({ player2_id: userId, status: 'placing' })
        .eq('id', game.id);

      if (joinError) throw joinError;
      onEnterGame(game.id); // player2 przechodzi od razu
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nieznany błąd');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-lg flex flex-col gap-6">

      {/* Pseudonim */}
      <div className="flex flex-col gap-2">
        <label className="text-slate-300 text-sm font-semibold tracking-wide uppercase">
          Pseudonim
        </label>
        <input
          type="text"
          value={nickname}
          onChange={e => handleNicknameChange(e.target.value)}
          placeholder="Wpisz pseudonim…"
          maxLength={20}
          className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-600
                     text-white placeholder-slate-500 text-lg
                     focus:outline-none focus:border-teal-500 transition-colors"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* ── Stwórz grę ── */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col gap-4">
          <h2 className="text-white font-bold text-base">Stwórz grę</h2>
          <button
            onClick={handleCreate}
            disabled={loading || waiting}
            className="w-full py-3 rounded-lg bg-teal-700 hover:bg-teal-600 disabled:opacity-50
                       disabled:cursor-not-allowed text-white font-bold tracking-wide transition-colors"
          >
            {loading ? '…' : '+ STWÓRZ GRĘ'}
          </button>

          {/* Kod pokoju + oczekiwanie */}
          {createdCode && (
            <div className="flex flex-col gap-3">
              <p className="text-slate-400 text-xs">Podaj ten kod graczowi 2:</p>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-center text-3xl font-mono font-bold tracking-widest
                                 text-yellow-300 bg-slate-900 rounded-lg py-2 border border-slate-600">
                  {createdCode}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(createdCode)}
                  title="Skopiuj kod"
                  className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600
                             text-slate-300 transition-colors"
                >
                  📋
                </button>
              </div>
              {waiting && (
                <p className="text-teal-400 text-sm text-center animate-pulse">
                  ⏳ Czekam na gracza 2…
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Dołącz do gry ── */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col gap-4">
          <h2 className="text-white font-bold text-base">Dołącz do gry</h2>
          <input
            type="text"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            placeholder="Kod pokoju"
            maxLength={6}
            className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-slate-600
                       text-yellow-300 placeholder-slate-600 text-xl font-mono font-bold
                       tracking-widest text-center uppercase
                       focus:outline-none focus:border-teal-500 transition-colors"
          />
          <button
            onClick={handleJoin}
            disabled={loading}
            className="w-full py-3 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50
                       disabled:cursor-not-allowed text-white font-bold tracking-wide transition-colors"
          >
            {loading ? '…' : 'DOŁĄCZ DO GRY'}
          </button>
        </div>

      </div>

      {error && (
        <p className="text-red-400 text-sm text-center bg-red-950/40 border border-red-800
                      rounded-lg px-4 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
