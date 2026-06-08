import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sirv from 'sirv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Prefer `public/sounds`, fall back to `frontend/sounds` (letter-number mp3 clips). */
function resolveSoundsDir() {
  const publicSounds = path.join(__dirname, 'public', 'sounds');
  const rootSounds = path.join(__dirname, 'sounds');
  const hasMp3 = (dir) =>
    fs.existsSync(dir) &&
    fs.readdirSync(dir).some((name) => name.toLowerCase().endsWith('.mp3'));

  if (hasMp3(publicSounds)) return publicSounds;
  if (hasMp3(rootSounds)) return rootSounds;
  return publicSounds;
}

function bingoSoundsPlugin() {
  const soundsDir = resolveSoundsDir();

  const serveSounds = sirv(soundsDir, { dev: true, etag: true });

  const copyToDist = (outDir) => {
    const dest = path.join(outDir, 'sounds');
    if (!fs.existsSync(soundsDir)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(soundsDir)) {
      if (!name.toLowerCase().endsWith('.mp3')) continue;
      fs.copyFileSync(path.join(soundsDir, name), path.join(dest, name));
    }
  };

  return {
    name: 'bingo-sounds',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/sounds/')) return next();
        serveSounds(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/sounds/')) return next();
        serveSounds(req, res, next);
      });
    },
    closeBundle() {
      copyToDist(path.resolve(__dirname, 'dist'));
    },
  };
}

export default defineConfig({
  plugins: [react(), bingoSoundsPlugin()],
  server: {
    port: 5174,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
