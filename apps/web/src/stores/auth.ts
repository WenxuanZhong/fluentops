import { defineStore } from 'pinia';
import { http } from '../lib/http';
import type { AuthTokens, UserProfile } from '@fluentops/shared';

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
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
  }),

  getters: {
    isAuthenticated: (state) => !!state.accessToken,
  },

  actions: {
    setAccessToken(accessToken: string) {
      this.accessToken = accessToken;
      localStorage.setItem('accessToken', accessToken);
    },

    clearAuth() {
      this.user = null;
      this.accessToken = null;
      localStorage.removeItem('accessToken');
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
      this.setAccessToken(data.accessToken);
      await this.fetchUser();
    },

    async refresh() {
      const { data } = await http.post<AuthTokens>('/auth/refresh', {});
      this.setAccessToken(data.accessToken);
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
      sessionStorage.setItem('user', JSON.stringify(data));
    },
  },
});
