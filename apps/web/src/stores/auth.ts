import { defineStore } from 'pinia';
import { REFRESH_TIMEOUT_MS, http } from '../lib/http';
import { authSession } from '../lib/authSession';
import type { AuthTokens, UserProfile } from '@fluentops/shared';

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
}

let sessionSyncBound = false;

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: authSession.getUser(),
    accessToken: authSession.getAccessToken(),
  }),

  getters: {
    isAuthenticated: (state) => !!state.accessToken,
  },

  actions: {
    setAccessToken(accessToken: string) {
      this.accessToken = accessToken;
      authSession.setAccessToken(accessToken);
    },

    syncFromSession() {
      this.accessToken = authSession.getAccessToken();
      this.user = this.accessToken ? authSession.getUser() : null;

      if (!this.accessToken) {
        authSession.clearUser();
      }
    },

    bindSessionSync(onSessionCleared?: () => void) {
      if (sessionSyncBound || typeof window === 'undefined') return;

      window.addEventListener('storage', (event) => {
        if (event.key === 'accessToken') {
          this.syncFromSession();
          if (!this.accessToken) {
            onSessionCleared?.();
          }
        }
      });
      sessionSyncBound = true;
    },

    clearAuth() {
      this.user = null;
      this.accessToken = null;
      authSession.clear();
    },

    async register(email: string, password: string) {
      await http.post('/auth/register', { email, password });
    },

    async login(email: string, password: string) {
      const { data } = await http.post<AuthTokens>(
        '/auth/login',
        { email, password },
      );
      this.setAccessToken(data.accessToken);
      await this.fetchUser();
    },

    async refresh() {
      const { data } = await http.post<AuthTokens>('/auth/refresh', {}, {
        timeout: REFRESH_TIMEOUT_MS,
      });
      this.setAccessToken(data.accessToken);
    },

    async ensureSession() {
      this.syncFromSession();

      if (!this.accessToken) {
        try {
          await this.refresh();
        } catch {
          this.clearAuth();
          return false;
        }
      }

      if (!this.user) {
        try {
          await this.fetchUser();
        } catch {
          this.clearAuth();
          return false;
        }
      }

      return true;
    },

    async logout() {
      try {
        await http.post('/auth/logout', {});
      } catch {
        // ignore logout errors
      }
      this.clearAuth();
    },

    async fetchUser() {
      const { data } = await http.get<UserProfile>('/me');
      this.user = data;
      authSession.setUser(data);
    },
  },
});
