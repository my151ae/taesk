/**
 * Notification Audio Manager
 *
 * Manages AudioContext for notification sounds following Chrome's autoplay policy.
 * Based on Google Chat/Slack approach: play sound when tab is visible, otherwise rely on OS notifications.
 *
 * Reference: https://developer.chrome.com/blog/autoplay/
 */

let audioContext: AudioContext | null = null;
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
      const AudioContextCtor = window.AudioContext
        || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return false;
      audioContext = new AudioContextCtor();
    }

    // Resume if suspended (autoplay policy)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
      console.log('[Audio] AudioContext resumed');
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
 * Generates a simple beep using Web Audio API oscillator
 * Returns true if sound was played, false otherwise
 */
export function playNotificationSound(): boolean {
  if (!audioUnlocked || !audioContext) {
    console.warn('[Audio] Audio not unlocked yet. Call unlockAudio() first after user interaction.');
    return false;
  }

  try {
    const now = audioContext.currentTime;

    // Create oscillator (sine wave at 800Hz for pleasant notification sound)
    const oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, now);

    // Create gain node for volume control and fade
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0.3, now); // Start at 30% volume
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2); // Fade out over 200ms

    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Play
    oscillator.start(now);
    oscillator.stop(now + 0.2); // Stop after 200ms

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
