'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  timeline_start_hour: number;
};

const OPTIONAL_USERNAME_MESSAGE = 'ユーザー名は任意です。設定すると @username で表示・メンションできます。';

type ProfileSettingsProps = {
  onProfileUpdated?: () => void;
};

export default function ProfileSettings({ onProfileUpdated }: ProfileSettingsProps = {}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved' | 'error'>('idle');
  const [usernameMessage, setUsernameMessage] = useState<string | null>(OPTIONAL_USERNAME_MESSAGE);
  const [timelineStartHour, setTimelineStartHour] = useState(5);
  const usernameCheckTimeoutRef = useRef<number | null>(null);
  const usernameRequestAbortRef = useRef<AbortController | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/profiles');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to load profile');
      }

      const data: Profile = await response.json();
      setProfile(data);
      setDisplayName(data.display_name || data.full_name || '');
      setUsername(data.username ?? '');
      setTimelineStartHour(data.timeline_start_hour ?? 5);

      if (data.username) {
        setUsernameStatus('available');
        setUsernameMessage('現在のユーザー名が設定されています。');
      } else {
        setUsernameStatus('idle');
        setUsernameMessage(OPTIONAL_USERNAME_MESSAGE);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    if (usernameCheckTimeoutRef.current) {
      window.clearTimeout(usernameCheckTimeoutRef.current);
      usernameCheckTimeoutRef.current = null;
    }

    const trimmed = username.trim();

    if (trimmed.length === 0) {
      usernameRequestAbortRef.current?.abort();
      usernameRequestAbortRef.current = null;
      setUsernameStatus('idle');
      setUsernameMessage(OPTIONAL_USERNAME_MESSAGE);
      return;
    }

    const currentUsername = profile.username ?? '';
    const candidate = trimmed.toLowerCase();

    if (candidate === currentUsername) {
      usernameRequestAbortRef.current?.abort();
      usernameRequestAbortRef.current = null;
      setUsernameStatus('available');
      setUsernameMessage('現在のユーザー名が設定されています。');
      return;
    }

    usernameCheckTimeoutRef.current = window.setTimeout(async () => {
      setUsernameStatus('checking');
      setUsernameMessage('ユーザー名を確認しています…');

      usernameRequestAbortRef.current?.abort();
      const controller = new AbortController();
      usernameRequestAbortRef.current = controller;

      try {
        const params = new URLSearchParams({ username: candidate });
        const response = await fetch(`/api/profiles/check-username?${params.toString()}`, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        if (response.status === 429) {
          setUsernameStatus('error');
          setUsernameMessage('確認の試行が多すぎます。しばらく待ってから再試行してください。');
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to check username');
        }

        const data = await response.json() as {
          available: boolean;
          reason: 'invalid_format' | 'reserved' | 'taken' | 'rate_limited' | null;
          username?: string;
        };

        if (controller.signal.aborted) {
          return;
        }

        if (data.available) {
          if (typeof data.username === 'string' && data.username.length > 0 && data.username !== candidate) {
            setUsername(data.username);
          }
          setUsernameStatus('available');
          setUsernameMessage('このユーザー名は利用できます。');
          return;
        }

        switch (data.reason) {
          case 'invalid_format':
            setUsernameStatus('invalid');
            setUsernameMessage('ユーザー名は3〜20文字の英数字またはアンダースコアのみ利用できます。');
            break;
          case 'reserved':
            setUsernameStatus('reserved');
            setUsernameMessage('このユーザー名は予約済みです。別の名前を選んでください。');
            break;
          case 'rate_limited':
            setUsernameStatus('error');
            setUsernameMessage('確認の試行が多すぎます。しばらく待ってから再試行してください。');
            break;
          case 'taken':
          default:
            setUsernameStatus('taken');
            setUsernameMessage('このユーザー名は既に使用されています。');
            break;
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          return;
        }
        console.error('Failed to check username availability:', error);
        setUsernameStatus('error');
        setUsernameMessage('ユーザー名の確認に失敗しました。時間をおいて再試行してください。');
      } finally {
        usernameRequestAbortRef.current = null;
      }
    }, 32);

    return () => {
      if (usernameCheckTimeoutRef.current) {
        window.clearTimeout(usernameCheckTimeoutRef.current);
        usernameCheckTimeoutRef.current = null;
      }
    };
  }, [profile, username]);

  useEffect(() => {
    return () => {
      usernameRequestAbortRef.current?.abort();
    };
  }, []);

  const usernameHelperClass = (() => {
    switch (usernameStatus) {
      case 'available':
        return 'text-green-600 dark:text-green-400';
      case 'invalid':
      case 'reserved':
      case 'taken':
        return 'text-red-600 dark:text-red-400';
      case 'checking':
        return 'text-blue-600 dark:text-blue-400';
      case 'error':
        return 'text-amber-600 dark:text-amber-400';
      default:
        return 'text-gray-500 dark:text-gray-400';
    }
  })();

  const usernameHasError = usernameStatus === 'invalid' || usernameStatus === 'reserved' || usernameStatus === 'taken';
  const isSaveDisabled = saving || !displayName.trim() || usernameStatus === 'checking';

  const handleSave = async () => {
    const trimmedDisplayName = displayName.trim();
    const normalizedUsername = username.trim().toLowerCase();

    if (!user || !trimmedDisplayName) {
      setError('Display name cannot be empty');
      return;
    }

    if (
      normalizedUsername &&
      (usernameStatus === 'checking' || usernameStatus === 'invalid' || usernameStatus === 'reserved' || usernameStatus === 'taken')
    ) {
      setError('ユーザー名の確認が完了していません。状態を確認してから再試行してください。');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setStatusMessage(null);

      const response = await fetch('/api/profiles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: trimmedDisplayName,
          username: normalizedUsername ? normalizedUsername : null,
          timeline_start_hour: timelineStartHour,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to save profile');
      }

      const data: Profile = await response.json();
      setProfile(data);
      setStatusMessage('Profile updated successfully!');
      setDisplayName(data.display_name || data.full_name || '');
      setUsername(data.username ?? '');
      setTimelineStartHour(data.timeline_start_hour ?? 5);

      if (data.username) {
        setUsernameStatus('available');
        setUsernameMessage('現在のユーザー名が設定されています。');
      } else {
        setUsernameStatus('idle');
        setUsernameMessage(OPTIONAL_USERNAME_MESSAGE);
      }

      // Call callback to update parent component
      if (onProfileUpdated) {
        onProfileUpdated();
      }

      // Clear success message after 3 seconds
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      console.error('Failed to save profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          Profile Settings
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          Profile Settings
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Please sign in to edit your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
        Profile Settings
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
          {error}
        </div>
      )}

      {statusMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
          {statusMessage}
        </div>
      )}

      <div className="space-y-4">
        {/* Display Name */}
        <div>
          <label
            htmlFor="display-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Display Name <span className="text-red-500">*</span>
          </label>
          <input
            id="display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter your display name"
            maxLength={100}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            data-testid="profile-display-name-input"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            This name will be shown instead of your email address.
          </p>
        </div>

        {/* Username */}
        <div>
          <label
            htmlFor="username"
            className="flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            <span>Username</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">任意</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-gray-500 dark:text-gray-400 pointer-events-none">@</span>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => {
                const rawValue = e.target.value.toLowerCase();
                const sanitized = rawValue.replace(/[^a-z0-9_]/g, '');
                setUsername(sanitized);
              }}
              placeholder="例: yossy"
              maxLength={20}
              autoComplete="off"
              className={`w-full pl-7 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 ${usernameHasError
                  ? 'border-red-500 focus:ring-red-500 dark:border-red-500'
                  : 'border-gray-300 focus:ring-blue-500 dark:border-gray-600 focus:ring-blue-500'
                }`}
              data-testid="profile-username-input"
            />
          </div>
          <p className={`mt-1 text-xs ${usernameHelperClass}`}>
            {usernameMessage ?? OPTIONAL_USERNAME_MESSAGE}
          </p>
        </div>

        {/* Email (read-only) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Email (read-only)
          </label>
          <input
            type="email"
            value={profile.email || ''}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Your authentication email cannot be changed here.
          </p>
        </div>

        {/* Timeline Start Hour */}
        <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
          <label
            htmlFor="timeline-start-hour"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Timeline Start Hour
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Set the beginning hour of the 24-hour timeline.
          </p>
          <select
            id="timeline-start-hour"
            value={timelineStartHour}
            onChange={(e) => setTimelineStartHour(parseInt(e.target.value))}
            className="block w-full max-w-[120px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                {i.toString().padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>

        {/* Save Button */}
        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={isSaveDisabled}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="profile-save-button"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
