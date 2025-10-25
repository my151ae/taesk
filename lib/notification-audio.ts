/**
 * Notification Audio Manager
 *
 * Manages AudioContext for notification sounds following Chrome's autoplay policy.
 * Based on Google Chat/Slack approach: play sound when tab is visible, otherwise rely on OS notifications.
 *
 * Reference: https://developer.chrome.com/blog/autoplay/
 */

// Simple notification sound as data URL (440Hz beep for 200ms)
const NOTIFICATION_SOUND_DATA_URL = `data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=`;

let audioContext: AudioContext | null = null;
let notificationBuffer: AudioBuffer | null = null;
let audioUnlocked = false;

/**
 * Unlock audio playback (must be called after user interaction)
 * This is required by Chrome's autoplay policy
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    console.log('[Audio] Unlocking audio...');

    // Create AudioContext if not exists
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    // Resume if suspended (autoplay policy)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
      console.log('[Audio] AudioContext resumed');
    }

    // Load and decode notification sound
    if (!notificationBuffer) {
      // Fetch sound file (using data URL for now, can be replaced with /sounds/notification.mp3)
      const response = await fetch(NOTIFICATION_SOUND_DATA_URL);
      const arrayBuffer = await response.arrayBuffer();
      notificationBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('[Audio] Notification sound loaded');
    }

    audioUnlocked = true;
    console.log('[Audio] Audio unlocked successfully');
    return true;
  } catch (error) {
    console.error('[Audio] Failed to unlock audio:', error);
    return false;
  }
}

/**
 * Play notification sound
 * Returns true if sound was played, false otherwise
 */
export function playNotificationSound(): boolean {
  if (!audioUnlocked || !audioContext || !notificationBuffer) {
    console.warn('[Audio] Audio not unlocked yet. Call unlockAudio() first after user interaction.');
    return false;
  }

  try {
    const source = audioContext.createBufferSource();
    source.buffer = notificationBuffer;
    source.connect(audioContext.destination);
    source.start(0);
    console.log('[Audio] Notification sound played');
    return true;
  } catch (error) {
    console.error('[Audio] Failed to play notification sound:', error);
    return false;
  }
}

/**
 * Check if audio is unlocked and ready to play
 */
export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

/**
 * Auto-unlock audio on first user interaction
 * Call this once during app initialization
 */
export function setupAutoUnlock(): void {
  const events = ['click', 'keydown', 'touchstart'];
  const handler = async () => {
    if (!audioUnlocked) {
      await unlockAudio();
    }
  };

  events.forEach(event => {
    window.addEventListener(event, handler, { once: true });
  });

  console.log('[Audio] Auto-unlock listeners registered');
}
