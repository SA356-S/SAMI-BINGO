import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initTelegramWebApp } from './utils/telegramWebApp';
import { unlockGameAudio } from './audio/gameSounds';
import './index.css';

initTelegramWebApp();
unlockGameAudio().catch(() => {});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
