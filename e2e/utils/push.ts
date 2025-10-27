import { Page } from '@playwright/test';

export async function mockServiceWorkerAndPush(page: Page) {
  await page.addInitScript(() => {
    if (!('serviceWorker' in navigator)) {
      (navigator as any).serviceWorker = {} as any;
    }

    navigator.serviceWorker.register = async () => {
      const mockRegistration: ServiceWorkerRegistration = {
        active: {
          state: 'activated',
          postMessage: () => {},
        } as any,
        installing: null,
        waiting: null,
        scope: '/',
        updateViaCache: 'imports',
        pushManager: {
          subscribe: async () => ({
            endpoint: 'https://mock.push.service/subscription',
            toJSON: () => ({
              endpoint: 'https://mock.push.service/subscription',
              keys: {
                p256dh: 'mock-p256dh-key',
                auth: 'mock-auth-key',
              },
            }),
          }) as PushSubscription,
          getSubscription: async () => null,
        } as any,
        showNotification: async () => {},
        getNotifications: async () => [],
      } as any;

      (navigator.serviceWorker as any).ready = Promise.resolve(mockRegistration);
      (navigator.serviceWorker as any).controller = {
        state: 'activated',
        postMessage: () => {},
      };

      return mockRegistration;
    };

    if ('Notification' in window) {
      const originalRequestPermission = Notification.requestPermission?.bind(Notification);
      let currentPermission: NotificationPermission = 'granted';

      Notification.requestPermission = async () => {
        console.log('[Mock] Notification permission granted');
        currentPermission = 'granted';
        return 'granted';
      };

      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => currentPermission,
        set: (value: NotificationPermission) => {
          currentPermission = value;
        },
      });

      if (originalRequestPermission) {
        (Notification.requestPermission as any).original = originalRequestPermission;
      }
    }
  });
}
