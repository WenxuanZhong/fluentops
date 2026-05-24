import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { UserProfile } from '@fluentops/shared';

vi.mock('../src/lib/http', () => ({
  REFRESH_TIMEOUT_MS: 5000,
  http: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import { http } from '../src/lib/http';
import { useAuthStore } from '../src/stores/auth';

const mockedPost = vi.mocked(http.post);
const mockedGet = vi.mocked(http.get);

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedPost.mockReset();
    mockedGet.mockReset();
  });

  it('logs in, stores tokens, and persists the current user', async () => {
    const user: UserProfile = {
      id: 'user-1',
      email: 'learner@example.com',
      createdAt: new Date().toISOString(),
    };

    mockedPost.mockResolvedValueOnce({
      data: {
        accessToken: 'access-1',
      },
    } as never);
    mockedGet.mockResolvedValueOnce({ data: user } as never);

    const store = useAuthStore();
    await store.login('learner@example.com', 'password123');

    expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
      email: 'learner@example.com',
      password: 'password123',
    });
    expect(mockedGet).toHaveBeenCalledWith('/me');
    expect(store.isAuthenticated).toBe(true);
    expect(store.user).toEqual(user);
    expect(localStorage.getItem('accessToken')).toBe('access-1');
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(sessionStorage.getItem('user')).toBe(JSON.stringify(user));
  });

  it('refreshes the access token via cookie (no body refresh token)', async () => {
    mockedPost.mockResolvedValueOnce({
      data: {
        accessToken: 'access-new',
      },
    } as never);

    const store = useAuthStore();
    await store.refresh();

    expect(mockedPost).toHaveBeenCalledWith('/auth/refresh', {}, {
      timeout: 5000,
    });
    expect(store.accessToken).toBe('access-new');
    expect(localStorage.getItem('accessToken')).toBe('access-new');
  });

  it('restores a session from the refresh cookie when the access token is missing', async () => {
    const user: UserProfile = {
      id: 'user-1',
      email: 'learner@example.com',
      createdAt: new Date().toISOString(),
    };

    mockedPost.mockResolvedValueOnce({
      data: {
        accessToken: 'access-new',
      },
    } as never);
    mockedGet.mockResolvedValueOnce({ data: user } as never);

    const store = useAuthStore();
    const restored = await store.ensureSession();

    expect(restored).toBe(true);
    expect(mockedPost).toHaveBeenCalledWith('/auth/refresh', {}, {
      timeout: 5000,
    });
    expect(mockedGet).toHaveBeenCalledWith('/me');
    expect(store.isAuthenticated).toBe(true);
    expect(store.user).toEqual(user);
    expect(localStorage.getItem('accessToken')).toBe('access-new');
    expect(sessionStorage.getItem('user')).toBe(JSON.stringify(user));
  });

  it('clears stale session state when refresh recovery fails', async () => {
    sessionStorage.setItem(
      'user',
      JSON.stringify({
        id: 'user-1',
        email: 'learner@example.com',
        createdAt: new Date().toISOString(),
      } satisfies UserProfile),
    );
    mockedPost.mockRejectedValueOnce(new Error('refresh failed'));

    const store = useAuthStore();
    const restored = await store.ensureSession();

    expect(restored).toBe(false);
    expect(mockedPost).toHaveBeenCalledWith('/auth/refresh', {}, {
      timeout: 5000,
    });
    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(sessionStorage.getItem('user')).toBeNull();
  });

  it('syncs auth state from another tab and reports session clearing', () => {
    localStorage.setItem('accessToken', 'access-1');
    sessionStorage.setItem(
      'user',
      JSON.stringify({
        id: 'user-1',
        email: 'learner@example.com',
        createdAt: new Date().toISOString(),
      } satisfies UserProfile),
    );

    const store = useAuthStore();
    const onSessionCleared = vi.fn();
    store.bindSessionSync(onSessionCleared);

    localStorage.removeItem('accessToken');
    window.dispatchEvent(new StorageEvent('storage', { key: 'accessToken' }));

    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(onSessionCleared).toHaveBeenCalledTimes(1);
  });

  it('clears auth state on logout even when the API call fails', async () => {
    localStorage.setItem('accessToken', 'access-1');
    sessionStorage.setItem(
      'user',
      JSON.stringify({
        id: 'user-1',
        email: 'learner@example.com',
        createdAt: new Date().toISOString(),
      } satisfies UserProfile),
    );

    mockedPost.mockRejectedValueOnce(new Error('network'));

    const store = useAuthStore();
    await store.logout();

    expect(mockedPost).toHaveBeenCalledWith('/auth/logout', {});
    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(sessionStorage.getItem('user')).toBeNull();
  });
});
