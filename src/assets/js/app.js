/**
 * Shell behaviour every page shares. Just the offline service worker.
 */

import { BASE, toast } from './ui.js';

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  try {
    const registration = await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE });
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version is ready. Reload to use it.');
        }
      });
    });
  } catch (err) {
    // Offline support is a bonus, never a reason to block the app.
    console.warn('Service worker registration failed:', err);
  }
}

initServiceWorker();
