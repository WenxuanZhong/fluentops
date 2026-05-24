import type { UserProfile } from '@fluentops/shared';

const ACCESS_TOKEN_KEY = 'accessToken';
const USER_KEY = 'user';

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private browsing or locked-down webviews.
  }
}

function removeStorage(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing or locked-down webviews.
  }
}

export const authSession = {
  getAccessToken(): string | null {
    return readStorage(localStorage, ACCESS_TOKEN_KEY);
  },

  setAccessToken(accessToken: string) {
    writeStorage(localStorage, ACCESS_TOKEN_KEY, accessToken);
  },

  clearAccessToken() {
    removeStorage(localStorage, ACCESS_TOKEN_KEY);
  },

  getUser(): UserProfile | null {
    const raw = readStorage(sessionStorage, USER_KEY);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as UserProfile;
    } catch {
      removeStorage(sessionStorage, USER_KEY);
      return null;
    }
  },

  setUser(user: UserProfile) {
    writeStorage(sessionStorage, USER_KEY, JSON.stringify(user));
  },

  clearUser() {
    removeStorage(sessionStorage, USER_KEY);
  },

  clear() {
    removeStorage(localStorage, ACCESS_TOKEN_KEY);
    removeStorage(sessionStorage, USER_KEY);
  },
};
