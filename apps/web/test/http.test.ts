import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

function unauthorizedError(config: InternalAxiosRequestConfig) {
  return new AxiosError(
    'Unauthorized',
    'ERR_BAD_REQUEST',
    config,
    null,
    {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
      data: { message: 'Unauthorized' },
    },
  );
}

describe('http client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('attaches the current access token to outgoing requests', async () => {
    localStorage.setItem('accessToken', 'access-1');

    const routerPush = vi.fn();
    vi.doMock('../src/router', () => ({
      router: { push: routerPush },
    }));

    const { http } = await import('../src/lib/http');

    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
      data: { ok: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }));

    await http.get('/protected', { adapter });

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0]?.[0].headers.Authorization).toBe('Bearer access-1');
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('refreshes once and retries concurrent 401 responses with the new token', async () => {
    localStorage.setItem('accessToken', 'access-old');

    const routerPush = vi.fn();
    vi.doMock('../src/router', () => ({
      router: { push: routerPush },
    }));

    const { http } = await import('../src/lib/http');

    let resolveRefresh: ((value: { data: { accessToken: string } }) => void) | null = null;
    const refreshPromise = new Promise<{ data: { accessToken: string } }>((resolve) => {
      resolveRefresh = resolve;
    });
    const postSpy = vi.spyOn(axios, 'post').mockReturnValue(refreshPromise as never);

    const adapter = vi.fn(async (config: InternalAxiosRequestConfig & { _retry?: boolean }) => {
      if (config.headers.Authorization === 'Bearer access-new' && config._retry) {
        return {
          data: { ok: true, url: config.url },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }

      throw unauthorizedError(config);
    });

    const requestA = http.get('/resource-a', { adapter });
    const requestB = http.get('/resource-b', { adapter });

    expect(postSpy).toHaveBeenCalledTimes(0);

    await vi.waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    expect(postSpy).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/refresh',
      {},
      { withCredentials: true, timeout: 5000 },
    );

    resolveRefresh?.({
      data: {
        accessToken: 'access-new',
      },
    });

    const [responseA, responseB] = await Promise.all([requestA, requestB]);

    expect(responseA.data).toEqual({ ok: true, url: '/resource-a' });
    expect(responseB.data).toEqual({ ok: true, url: '/resource-b' });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('accessToken')).toBe('access-new');
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('clears tokens and redirects to login when refresh fails', async () => {
    localStorage.setItem('accessToken', 'access-old');

    const routerPush = vi.fn();
    vi.doMock('../src/router', () => ({
      router: { push: routerPush },
    }));

    const { http } = await import('../src/lib/http');

    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('refresh failed'));

    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw unauthorizedError(config);
    });

    await expect(http.get('/protected', { adapter })).rejects.toThrow('refresh failed');

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(routerPush).toHaveBeenCalledWith('/login');
  });
});
