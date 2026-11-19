/*
 * Service worker de Cockpit — permet d'ouvrir l'application sans réseau.
 *
 *  - Pages et fichiers de l'appli (même origine) : RÉSEAU D'ABORD, cache en secours. En ligne, on a donc
 *    toujours la dernière version publiée (revalidée à chaque ouverture) ; hors ligne, la dernière version vue.
 *  - SDK Firebase (versions figées dans l'URL, donc immuables) : cache d'abord.
 *  - Tout le reste (Firestore, Auth…) passe sans intervention : les données hors ligne sont gérées par
 *    le cache Firestore de l'appli (enablePersistence), pas par ce fichier.
 *
 * Pour forcer tous les appareils à repartir d'un cache vide : changer CACHE ci-dessous.
 */
const CACHE = 'cockpit-v1';

const COQUILLE = [
  './',
  'manifest.json',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/apple-touch-icon.png',
  'assets/favicon-32.png',
  'assets/mark.svg',
];
const SDK_FIREBASE = [
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/12.16.0/firebase-app-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/12.16.0/firebase-auth-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/12.16.0/firebase-firestore-compat.js',
];
const DELAI_NAVIGATION_MS = 4000;   // réseau trop lent : on ouvre la version en cache pendant que la mise à jour continue

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Un fichier introuvable n'empêche pas l'installation : on met en cache ce qu'on peut.
    await Promise.all([...COQUILLE, ...SDK_FIREBASE].map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const nom of await caches.keys()) if (nom !== CACHE) await caches.delete(nom);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const requete = event.request;
  if (requete.method !== 'GET') return;
  const url = new URL(requete.url);

  if (url.origin === self.location.origin) {
    event.respondWith(reseauPuisCache(requete));
  } else if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.includes('/firebase/')) {
    event.respondWith(cachePuisReseau(requete));
  }
});

async function reseauPuisCache(requete) {
  const cache = await caches.open(CACHE);
  const racine = new URL('./', self.registration.scope).href;
  const enCache = () => cache.match(requete, { ignoreSearch: true }).then(r => r || (requete.mode === 'navigate' ? cache.match(racine) : undefined));

  const reseau = fetch(requete, { cache: 'no-cache' }).then(reponse => {
    if (reponse.ok) cache.put(requete, reponse.clone());
    return reponse;
  });

  if (requete.mode === 'navigate') {
    // Ouverture de la page : réseau trop lent ou coupé → version en cache.
    const delai = new Promise(resolve => setTimeout(() => resolve(null), DELAI_NAVIGATION_MS));
    try {
      const reponse = await Promise.race([reseau, delai]);
      if (reponse) return reponse;
    } catch (e) { /* hors ligne : on passe au cache */ }
    return (await enCache()) || reseau;
  }

  try {
    return await reseau;
  } catch (e) {
    const trouve = await enCache();
    if (trouve) return trouve;
    throw e;
  }
}

async function cachePuisReseau(requete) {
  const cache = await caches.open(CACHE);
  const trouve = await cache.match(requete);
  if (trouve) return trouve;
  const reponse = await fetch(requete);
  if (reponse.ok || reponse.type === 'opaque') cache.put(requete, reponse.clone());
  return reponse;
}
