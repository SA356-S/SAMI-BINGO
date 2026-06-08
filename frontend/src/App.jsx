import { useEffect, useState } from 'react';

import { Route, Routes, useNavigate } from 'react-router-dom';

import Instruction from './pages/Instruction';

import MainApp from './MainApp';

import CardSelection from './pages/CardSelection';

import MainGame from './pages/MainGame';

import {

  bindAudioUnlockOnInteraction,

  preloadBallCallSounds,

} from './audio/gameSounds';

import { initGameAudioSync } from './audio/gameAudioSync';

import { initLobbySession } from './services/lobbySession';

import { bootstrapPlayerSession } from './services/playerSession';

import { initTelegramWebApp, isTelegramWebApp } from './api/playerIdentity';



function LobbySessionBridge() {

  const navigate = useNavigate();



  useEffect(() => {

    initLobbySession(navigate);

  }, [navigate]);



  return null;

}



export default function App() {

  const [sessionReady, setSessionReady] = useState(false);

  const [authError, setAuthError] = useState(false);
  const [banMessage, setBanMessage] = useState('');



  useEffect(() => {
    const isInstructionRoute = window.location.pathname.startsWith('/instruction');

    initTelegramWebApp();

    if (isInstructionRoute) {
      setAuthError(false);
      setSessionReady(true);
      return undefined;
    }

    bootstrapPlayerSession()

      .then(() => {

        setAuthError(false);

        setSessionReady(true);
        import('./audio/gameAudioSync').then(({ rebindGameAudioSync }) => {
          rebindGameAudioSync();
        });

      })

      .catch((err) => {

        console.error('[telegram] session failed:', err?.message ?? err);

        if (err?.code === 'user_banned') {
          setBanMessage(err.banReason || err.message || 'Your account has been suspended.');
          setAuthError(true);
          return;
        }

        setAuthError(true);

        if (!isTelegramWebApp()) {

          setSessionReady(true);

        }

      });



    const preloadTimer = setTimeout(() => {

      preloadBallCallSounds().catch(() => {});

    }, 0);

    const unbindUnlock = bindAudioUnlockOnInteraction();
    const unbindAudioSync = initGameAudioSync();

    return () => {

      clearTimeout(preloadTimer);

      unbindUnlock();
      unbindAudioSync();

    };

  }, []);



  if (
    banMessage &&
    isTelegramWebApp() &&
    !window.location.pathname.startsWith('/instruction')
  ) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a14] px-6 text-center text-white">
        <div>
          <p className="text-lg font-semibold">Account suspended</p>
          <p className="mt-2 text-sm text-white/50">{banMessage}</p>
        </div>
      </div>
    );
  }

  if (
    authError &&
    isTelegramWebApp() &&
    !window.location.pathname.startsWith('/instruction')
  ) {

    return (

      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a14] px-6 text-center text-white">

        <div>

          <p className="text-lg font-semibold">Telegram login required</p>

          <p className="mt-2 text-sm text-white/50">

            Open this game from the EDIL BINGO Telegram bot (Play button).

          </p>

        </div>

      </div>

    );

  }



  if (!sessionReady) {

    return (

      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a14] text-white/60">

        Loading…

      </div>

    );

  }



  return (

    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden">

      <LobbySessionBridge />

      <Routes>

        <Route path="/instruction" element={<Instruction />} />

        <Route path="/" element={<MainApp />} />

        <Route path="/card-selection" element={<CardSelection />} />

        <Route path="/main-game" element={<MainGame />} />

        <Route path="/game-75-ball" element={<MainGame />} />

      </Routes>

    </div>

  );

}

