import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly send = vi.fn();
  readonly close = vi.fn();
  readonly OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

describe('useAssessmentRealtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    FakeWebSocket.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back immediately when there is no access token', async () => {
    const fallbackPoll = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../src/lib/http', () => ({
      http: {
        defaults: {
          baseURL: 'http://localhost:3000/api/v1',
        },
      },
    }));

    vi.stubGlobal('WebSocket', vi.fn(() => {
      throw new Error('WebSocket should not be constructed without a token');
    }));

    const { useAssessmentRealtime } = await import('../src/composables/useAssessmentRealtime');
    const realtime = useAssessmentRealtime();

    await realtime.stream({
      assessmentId: 'assessment-1',
      onProgress: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onFallbackPoll: fallbackPoll,
    });

    expect(fallbackPoll).toHaveBeenCalledTimes(1);
  });

  it('uses the websocket path when realtime messages arrive successfully', async () => {
    localStorage.setItem('accessToken', 'access-1');

    vi.doMock('../src/lib/http', () => ({
      http: {
        defaults: {
          baseURL: 'http://localhost:3000/api/v1',
        },
      },
    }));

    vi.stubGlobal('WebSocket', FakeWebSocket);

    const { useAssessmentRealtime } = await import('../src/composables/useAssessmentRealtime');
    const realtime = useAssessmentRealtime();
    const onProgress = vi.fn();
    const onFinal = vi.fn();
    const onError = vi.fn();
    const onFallbackPoll = vi.fn().mockResolvedValue(undefined);

    const streamPromise = realtime.stream({
      assessmentId: 'assessment-1',
      onProgress,
      onFinal,
      onError,
      onFallbackPoll,
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket?.url).toBe('ws://localhost:3000/ws/assessments?token=access-1');

    socket.onopen?.();
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ action: 'subscribe', assessmentId: 'assessment-1' }),
    );

    socket.onmessage?.({ data: JSON.stringify({ type: 'connected' }) });
    socket.onmessage?.({
      data: JSON.stringify({
        assessmentId: 'assessment-1',
        type: 'progress',
        seq: 2,
        data: { pct: 40, stage: 'rewrite' },
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        assessmentId: 'assessment-1',
        type: 'final',
        seq: 3,
        data: { rubric: { grammar: 90 } },
      }),
    });

    await streamPromise;

    expect(onProgress).toHaveBeenCalledWith({ pct: 40, stage: 'rewrite' }, 2);
    expect(onFinal).toHaveBeenCalledWith({ rubric: { grammar: 90 } }, 3);
    expect(onError).not.toHaveBeenCalled();
    expect(onFallbackPoll).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to SSE when the websocket path errors', async () => {
    localStorage.setItem('accessToken', 'access-1');

    vi.doMock('../src/lib/http', () => ({
      http: {
        defaults: {
          baseURL: 'http://localhost:3000/api/v1',
        },
      },
    }));

    vi.stubGlobal('WebSocket', FakeWebSocket);

    const ssePayload = [
      'event: progress',
      'data: {"pct":55,"stage":"drills"}',
      'id: 5',
      '',
      'event: final',
      'data: {"feedbackMarkdown":"done"}',
      'id: 6',
      '',
      '',
    ].join('\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ssePayload));
        controller.close();
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { useAssessmentRealtime } = await import('../src/composables/useAssessmentRealtime');
    const realtime = useAssessmentRealtime();
    const onProgress = vi.fn();
    const onFinal = vi.fn();
    const onError = vi.fn();
    const onFallbackPoll = vi.fn().mockResolvedValue(undefined);

    const streamPromise = realtime.stream({
      assessmentId: 'assessment-1',
      onProgress,
      onFinal,
      onError,
      onFallbackPoll,
    });

    const socket = FakeWebSocket.instances[0];
    socket.onerror?.();

    await streamPromise;

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/ai/assess/assessment-1/stream',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-1' },
      }),
    );
    expect(onProgress).toHaveBeenCalledWith({ pct: 55, stage: 'drills' }, 5);
    expect(onFinal).toHaveBeenCalledWith({ feedbackMarkdown: 'done' }, 6);
    expect(onError).not.toHaveBeenCalled();
    expect(onFallbackPoll).not.toHaveBeenCalled();
  });
});
