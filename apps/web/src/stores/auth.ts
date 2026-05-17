import { defineStore } from 'pinia';
import { http } from '../lib/http';
import type { AuthTokens, UserProfile } from '@fluentops/shared';

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  refreshToken: string | null;
}

function readStoredUser(): UserProfile | null {
  try {
    const raw = sessionStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    sessionStorage.removeItem('user');
    return null;
  }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: readStoredUser(),
    accessToken: localStorage.getItem('accessToken'),
    refreshToken: localStorage.getItem('refreshToken'),
  }),

  getters: {
    isAuthenticated: (state) => !!state.accessToken,
  },

  actions: {
    setTokens(accessToken: string, refreshToken: string) {
      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
    },

    clearAuth() {
      this.user = null;
      this.accessToken = null;
      this.refreshToken = null;
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      sessionStorage.removeItem('user');
    },

    async register(email: string, password: string) {
      await http.post('/auth/register', { email, password });
    },

    async login(email: string, password: string) {
      const { data } = await http.post<AuthTokens>(
        '/auth/login',
        { email, password },
      );
      this.setTokens(data.accessToken, data.refreshToken);
      await this.fetchUser();
    },

    async refresh() {
      if (!this.refreshToken) throw new Error('No refresh token');
      const { data } = await http.post<AuthTokens>(
        '/auth/refresh',
        { refreshToken: this.refreshToken },
      );
      this.setTokens(data.accessToken, data.refreshToken);
    },

    async logout() {
      if (this.refreshToken) {
        try {
          await http.post('/auth/logout', { refreshToken: this.refreshToken });
        } catch {
          // ignore logout errors
        }
      }
      this.clearAuth();
    },

    async fetchUser() {
      const { data } = await http.get<UserProfile>('/me');
      this.user = data;
      sessionStorage.setItem('user', JSON.stringify(data));
    },
  },
});
