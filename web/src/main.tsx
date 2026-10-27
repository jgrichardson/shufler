import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import './skins/registry';
import { App } from './App';
import { dispatch, useWorld } from './store';
import { startFeed } from './api/ws';

startFeed();
if (import.meta.env.DEV) {
  const w = window as unknown as { __shufler?: Record<string, unknown> };
  w.__shufler = { ...w.__shufler, useWorld, dispatch };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
