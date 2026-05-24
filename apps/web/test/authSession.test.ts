import { beforeEach, describe, expect, it } from 'vitest';
import type { UserProfile } from '@fluentops/shared';
import { authSession } from '../src/lib/authSession';

describe('authSession', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('stores and clears the access token', () => {
    expect(authSession.getAccessToken()).toBeNull();

    authSession.setAccessToken('access-1');

    expect(authSession.getAccessToken()).toBe('access-1');
    expect(localStorage.getItem('accessToken')).toBe('access-1');

    authSession.clearAccessToken();

    expect(authSession.getAccessToken()).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('stores and clears the cached user profile', () => {
    const user: UserProfile = {
      id: 'user-1',
      email: 'learner@example.com',
      createdAt: new Date().toISOString(),
    };

    authSession.setUser(user);

    expect(authSession.getUser()).toEqual(user);
    expect(sessionStorage.getItem('user')).toBe(JSON.stringify(user));

    authSession.clearUser();

    expect(authSession.getUser()).toBeNull();
    expect(sessionStorage.getItem('user')).toBeNull();
  });

  it('drops corrupted cached user data', () => {
    sessionStorage.setItem('user', '{bad-json');

    expect(authSession.getUser()).toBeNull();
    expect(sessionStorage.getItem('user')).toBeNull();
  });

  it('clears the complete browser session cache', () => {
    localStorage.setItem('accessToken', 'access-1');
    sessionStorage.setItem('user', JSON.stringify({ id: 'user-1' }));

    authSession.clear();

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(sessionStorage.getItem('user')).toBeNull();
  });
});
