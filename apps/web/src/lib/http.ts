import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { AuthTokens } from '@fluentops/shared';
import { router } from '../router';
import { authSession } from './authSession';

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1',
  timeout: 30000,
  withCredentials: true,
});

export const REFRESH_TIMEOUT_MS = 5000;

let refreshPromise: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const baseURL = http.defaults.baseURL || 'http://localhost:3000/api/v1';
  try {
    const { data } = await axios.post<AuthTokens>(
      `${baseURL}/auth/refresh`,
      {},
      { withCredentials: true, timeout: REFRESH_TIMEOUT_MS },
    );
    authSession.setAccessToken(data.accessToken);
    return data.accessToken;
  } catch (error) {
    authSession.clearAccessToken();
    router.push('/login');
    throw error;
  }
}

// Request interceptor: attach access token
http.interceptors.request.use((config) => {
  const token = authSession.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 and refresh
http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Skip refresh for auth endpoints
    if (originalRequest.url?.includes('/auth/')) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    const activeRefresh = refreshPromise ?? (refreshPromise = doRefresh());

    try {
      const token = await activeRefresh;
      originalRequest.headers = originalRequest.headers ?? {};
      originalRequest.headers.Authorization = `Bearer ${token}`;
      return http(originalRequest);
    } catch (refreshError) {
      authSession.clearAccessToken();
      router.push('/login');
      return Promise.reject(refreshError);
    } finally {
      if (refreshPromise === activeRefresh) {
        refreshPromise = null;
      }
    }
  },
);
