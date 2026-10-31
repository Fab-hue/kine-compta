import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Hors ligne : service worker enregistré uniquement en production
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // nouvelle version installée alors qu'une ancienne tournait : recharger UNE fois pour l'utiliser
  const avaitUnSw = !!navigator.serviceWorker.controller;
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitUnSw || recharge) return;
    recharge = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
