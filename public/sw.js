/**
 * Service Worker for Taesk PWA
 * Handles push notifications and offline caching
 */

// Service Worker version - increment to force update
const SW_VERSION = '1.3.4';
const CACHE_NAME = `taesk-cache-${SW_VERSION}`;

// Install event - cache critical resources
self.addEventListener('install', (event) => {
  console.log('[SW] Install event', SW_VERSION);

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Only cache resources that exist
      return cache.addAll([
        '/',
        '/manifest.json',
      ]).catch((error) => {
        console.error('[SW] Cache addAll failed:', error);
        // Continue anyway - caching is optional
      });
    })
  );

  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event', SW_VERSION);

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

  // Take control of all pages immediately
  return self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip external requests (Supabase, CDNs, etc.)
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip special URLs that should not be intercepted
  if (event.request.url.startsWith('chrome-extension://') ||
      event.request.url.startsWith('moz-extension://') ||
      event.request.url.startsWith('data:') ||
      event.request.url.startsWith('blob:')) {
    return;
  }

  // Skip Next.js internal resources
  if (url.pathname.startsWith('/_next/webpack-hmr') ||
      url.pathname.startsWith('/__nextjs') ||
      url.pathname.includes('hot-update')) {
    return;
  }

  // Never cache authenticated API responses.
  // Stale notification payloads are especially confusing in mobile PWA mode.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For font files and other static assets, use network-first strategy
  // but don't fail loudly if network fails
  if (url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.woff') ||
      url.pathname.endsWith('.ttf') ||
      url.pathname.endsWith('.otf')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache).catch(() => {
                // Ignore cache errors
              });
            }).catch(() => {
              // Ignore cache open errors
            });
          }
          return response;
        })
        .catch(() => {
          // For fonts, try cache first, then fail silently
          return caches.match(event.request);
        })
    );
    return;
  }

  // For other requests, use network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache successful responses
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache).catch(() => {
              // Ignore cache errors
            });
          }).catch(() => {
            // Ignore cache open errors
          });
        }
        return response;
      })
      .catch((error) => {
        console.log('[SW] Fetch failed for:', event.request.url, error);
        // Network failed, try cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Return a proper 404 response for missing resources
          return new Response('Not found', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received');

  let notificationData = {
    title: 'Taesk Notification',
    body: 'You have a new notification',
    icon: '/icon?size=192',
    badge: '/icon?size=192',
    tag: 'taesk-notification',
    requireInteraction: false,
    data: {},
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        ...notificationData,
        ...data,
        data: data, // Store full payload in data
      };
    } catch (error) {
      console.error('[SW] Error parsing push data:', error);
      notificationData.body = event.data.text();
    }
  }

  event.waitUntil(
    Promise.all([
      // Show notification (OS notification, sound depends on OS settings)
      self.registration.showNotification(notificationData.title, {
        body: notificationData.body,
        icon: notificationData.icon,
        badge: notificationData.badge,
        tag: notificationData.tag,
        requireInteraction: notificationData.requireInteraction,
        data: notificationData.data,
        silent: false, // Request system sound (depends on browser/OS settings)
      }).then(() => {
        console.log('[SW] Notification shown successfully:', notificationData.title);
      }).catch(err => {
        console.error('[SW] Failed to show notification:', err);
      }),
      // Notify all clients to play sound if visible
      (async () => {
        try {
          const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          console.log(`[SW] Notifying ${clients.length} client(s) about notification`);

          for (const client of clients) {
            client.postMessage({
              type: 'NOTIFICATION_RECEIVED',
              payload: notificationData.data,
            });
          }
        } catch (err) {
          console.error('[SW] Failed to notify clients:', err);
        }
      })(),
      // Update badge
      (async () => {
        if (self.navigator && 'setAppBadge' in self.navigator) {
          try {
            // Get current badge count and increment
            const currentCount = await self.clients.matchAll({ type: 'window' })
              .then(clients => {
                if (clients.length > 0) {
                  // If app is open, client will update badge
                  return null;
                }
                // App is closed, increment badge
                return 1;
              });

            if (currentCount !== null) {
              await self.navigator.setAppBadge(currentCount);
              console.log('[SW] Badge updated');
            }
          } catch (err) {
            console.error('[SW] Failed to update badge:', err);
          }
        }
      })(),
    ])
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click:', event.notification.data);

  event.notification.close();

  // Extract card/board info from notification data
  const data = event.notification.data || {};
  let url = '/';

  if (data.card_id && data.card_short_id) {
    // Navigate to card
    url = `/c/${data.card_short_id}/${data.card_slug || ''}`;
  } else if (data.board_id && data.board_short_id) {
    // Navigate to board
    url = data.board_slug
      ? `/b/${data.board_short_id}/${data.board_slug}?lp=overdue&rp=timeline`
      : `/b/${data.board_short_id}?lp=overdue&rp=timeline`;
  }

  // Focus or open window
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url === self.location.origin + url && 'focus' in client) {
            return client.focus();
          }
        }

        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// Message event - handle messages from clients
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
