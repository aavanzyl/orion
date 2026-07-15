import { useCallback } from 'react';
import { toast } from 'sonner';
import type { NotificationEventKey } from '@orion/models';
import { usePreferences } from './use-preferences';

interface NotificationOptions {
  title: string;
  description?: string;
  url?: string;
}

export function useNotifications() {
  const { preferences } = usePreferences();

  const notify = useCallback(
    (eventKey: NotificationEventKey, options: NotificationOptions) => {
      const eventPrefs = preferences.notifications.events[eventKey];
      if (!eventPrefs) return;

      if (eventPrefs.toasts) {
        if (options.url) {
          toast(options.title, {
            description: options.description,
            action: { label: 'View', onClick: () => window.open(options.url, '_blank') },
          });
        } else {
          toast(options.title, { description: options.description });
        }
      }

      if (eventPrefs.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification(options.title, { body: options.description ?? '' });
          if (options.url) {
            n.onclick = () => window.open(options.url, '_blank');
          }
        } catch {
          // ignore — browser may throttle or block
        }
      }
    },
    [preferences.notifications.events],
  );

  return { notify };
}
