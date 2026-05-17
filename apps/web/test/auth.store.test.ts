import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { UserProfile } from '@fluentops/shared';

vi.mock('../src/lib/http', () => ({
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
        refreshToken: 'refresh-1',
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
    expect(localStorage.getItem('refreshToken')).toBe('refresh-1');
    expect(sessionStorage.getItem('user')).toBe(JSON.stringify(user));
  });

  it('refreshes tokens from the stored refresh token', async () => {
    localStorage.setItem('refreshToken', 'refresh-old');

    mockedPost.mockResolvedValueOnce({
      data: {
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
      },
    } as never);

    const store = useAuthStore();
    await store.refresh();

    expect(mockedPost).toHaveBeenCalledWith('/auth/refresh', {
      refreshToken: 'refresh-old',
    });
    expect(store.accessToken).toBe('access-new');
    expect(store.refreshToken).toBe('refresh-new');
    expect(localStorage.getItem('accessToken')).toBe('access-new');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-new');
  });

  it('clears auth state on logout even when the API call fails', async () => {
    localStorage.setItem('accessToken', 'access-1');
    localStorage.setItem('refreshToken', 'refresh-1');
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

    expect(mockedPost).toHaveBeenCalledWith('/auth/logout', {
      refreshToken: 'refresh-1',
    });
    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(sessionStorage.getItem('user')).toBeNull();
  });
});
