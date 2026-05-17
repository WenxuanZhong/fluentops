import { http } from '../lib/http';

type RealtimeCallbacks = {
  assessmentId: string;
  onProgress: (payload: { pct?: number; stage?: string }, eventId: number) => void;
  onFinal: (payload: unknown, eventId: number) => void;
  onError: (payload: { message?: string }, eventId: number) => void;
  onFallbackPoll: () => Promise<void>;
};

function parseSseField(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) return null;
  const value = line.slice(prefix.length);
  return value.startsWith(' ') ? value.slice(1) : value;
}

export function useAssessmentRealtime() {
  let socket: WebSocket | null = null;
  let abortController: AbortController | null = null;

  function stop() {
    abortController?.abort();
    abortController = null;
    socket?.close();
    socket = null;
  }

  async function streamViaSse(
    callbacks: RealtimeCallbacks,
    token: string,
    since: number,
    onAdvance: (id: number) => void = () => {},
  ) {
    abortController = new AbortController();
    const sinceQuery = since >= 0 ? `?since=${since}` : '';

    try {
      const response = await fetch(
        `${http.defaults.baseURL}/ai/assess/${callbacks.assessmentId}/stream${sinceQuery}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        },
      );

      if (!response.ok || !response.body) {
        await callbacks.onFallbackPoll();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const lines = chunk.split('\n');
          let type = '';
          let data = '';
          let id = since;
          for (const line of lines) {
            const eventValue = parseSseField(line, 'event:');
            if (eventValue !== null) type = eventValue;
            const dataValue = parseSseField(line, 'data:');
            if (dataValue !== null) data = dataValue;
            const idValue = parseSseField(line, 'id:');
            if (idValue !== null) {
              const parsed = Number(idValue);
              if (Number.isFinite(parsed)) id = parsed;
            }
          }
          if (!data) continue;
          if (id >= 0) onAdvance(id);
          let payload: unknown;
          try {
            payload = JSON.parse(data);
          } catch {
            payload = { message: data };
          }
          if (type === 'progress') callbacks.onProgress(payload as { pct?: number; stage?: string }, id);
          if (type === 'final') callbacks.onFinal(payload, id);
          if (type === 'error') {
            const errorPayload =
              typeof payload === 'object' && payload !== null
                ? (payload as { message?: string })
                : { message: String(payload) };
            callbacks.onError(errorPayload, id);
          }
        }
      }
    } catch {
      await callbacks.onFallbackPoll();
    }
  }

  async function stream(callbacks: RealtimeCallbacks) {
    stop();

    const token = localStorage.getItem('accessToken');
    if (!token) {
      await callbacks.onFallbackPoll();
      return;
    }

    let lastEventId = -1;
    let completed = false;
    let fallbackTriggered = false;

    const fallback = async () => {
      if (fallbackTriggered || completed) return;
      fallbackTriggered = true;
      if (socket) {
        // Detach handlers first so the impending close doesn't re-enter fallback
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      await streamViaSse(callbacks, token, lastEventId, (id) => {
        lastEventId = id;
      });
    };

    const handleEvent = (event: {
      id?: number;
      type: string;
      data: unknown;
    }) => {
      const nextEventId = Number.isFinite(event.id) ? Number(event.id) : lastEventId;
      if (nextEventId >= 0) {
        lastEventId = nextEventId;
      }

      if (event.type === 'progress') {
        callbacks.onProgress(event.data as { pct?: number; stage?: string }, nextEventId);
        return;
      }

      if (event.type === 'final') {
        completed = true;
        callbacks.onFinal(event.data, nextEventId);
        stop();
        return;
      }

      if (event.type === 'error') {
        completed = true;
        callbacks.onError(event.data as { message?: string }, nextEventId);
        stop();
      }
    };

    try {
      const ticket = await fetchWsTicket();
      const wsOrigin = resolveWsOrigin();
      // The browser-native WebSocket has no header API; the only customizable
      // channel is `Sec-WebSocket-Protocol`. We send a two-element subprotocol
      // list "fo-ws.v1, <ticket>" and the gateway extracts the second value.
      socket = new WebSocket(`${wsOrigin}/ws/assessments`, ['fo-ws.v1', ticket]);
    } catch {
      await fallback();
      return;
    }

    const connectionTimer = window.setTimeout(() => {
      void fallback();
    }, 2500);

    await new Promise<void>((resolve) => {
      if (!socket) {
        resolve();
        return;
      }

      socket.onopen = () => {
        window.clearTimeout(connectionTimer);
        socket?.send(JSON.stringify({ action: 'subscribe', assessmentId: callbacks.assessmentId }));
      };

      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data as string) as {
            type?: string;
            seq?: number;
            id?: number;
            data?: unknown;
            assessmentId?: string;
          };

          if (payload.type === 'connected') {
            return;
          }

          if (payload.assessmentId !== callbacks.assessmentId || !payload.type) {
            return;
          }

          handleEvent({
            id: payload.seq ?? payload.id,
            type: payload.type,
            data: payload.data,
          });

          if (completed) {
            resolve();
          }
        } catch {
          void fallback().then(resolve);
        }
      };

      socket.onerror = () => {
        window.clearTimeout(connectionTimer);
        void fallback().then(resolve);
      };

      socket.onclose = () => {
        window.clearTimeout(connectionTimer);
        if (!completed) {
          void fallback().then(resolve);
          return;
        }
        resolve();
      };
    });
  }

  return {
    stream,
    stop,
  };
}

function resolveWsOrigin() {
  const baseUrl = http.defaults.baseURL || 'http://localhost:3000/api/v1';
  const origin = baseUrl.replace(/\/api\/v1$/, '');
  return origin.replace(/^http/, 'ws');
}

async function fetchWsTicket(): Promise<string> {
  const { data } = await http.post<{ ticket: string }>('/auth/ws-ticket', {});
  if (!data?.ticket) throw new Error('No ws ticket');
  return data.ticket;
}
