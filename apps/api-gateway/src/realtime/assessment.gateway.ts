import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import type { IncomingMessage } from 'http';
import type { Server, WebSocket } from 'ws';
import { AssessmentRealtimeService, type AssessmentRealtimeEvent } from './assessment-realtime.service';

type ClientState = {
  userId: string;
  subscriptions: Set<string>;
};

@WebSocketGateway({
  path: '/ws/assessments',
})
export class AssessmentGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AssessmentGateway.name);
  private readonly clients = new Map<WebSocket, ClientState>();
  private streamSub: Subscription | null = null;

  constructor(
    private readonly realtime: AssessmentRealtimeService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.streamSub = this.realtime.events$.subscribe((event) => this.broadcast(event));
  }

  onModuleDestroy() {
    this.streamSub?.unsubscribe();
  }

  handleConnection(client: WebSocket, request: IncomingMessage) {
    try {
      const ticket = this.extractTicket(request);
      if (!ticket) {
        client.close(1008, 'Missing ticket');
        return;
      }

      const payload = this.jwtService.verify<{ sub: string; kind?: string }>(ticket, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      if (payload.kind !== 'ws') {
        this.logger.warn('Rejected websocket connection: ticket has wrong kind');
        client.close(1008, 'Unauthorized');
        return;
      }
      const state: ClientState = { userId: payload.sub, subscriptions: new Set() };
      this.clients.set(client, state);
      client.send(JSON.stringify({ type: 'connected' }));
      client.on('message', (raw: Buffer) => this.handleMessage(client, raw.toString()));
      client.on('close', () => this.clients.delete(client));
    } catch (error) {
      this.logger.warn(`Rejected websocket connection: ${error instanceof Error ? error.message : error}`);
      client.close(1008, 'Unauthorized');
    }
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
  }

  private extractTicket(request: IncomingMessage): string | null {
    // Preferred: Sec-WebSocket-Protocol header (browser-friendly, doesn't leak to URLs)
    const subprotocol = request.headers['sec-websocket-protocol'];
    if (typeof subprotocol === 'string' && subprotocol.length > 0) {
      const [, ticket] = subprotocol.split(',').map((s) => s.trim());
      // Convention: ["fo-ws.v1", "<ticket>"]
      if (ticket) return ticket;
    }
    // Legacy fallback (deprecated): query string. Only allowed in non-production.
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      try {
        const url = new URL(request.url || '/', 'http://localhost');
        const queryTicket = url.searchParams.get('ticket') || url.searchParams.get('token');
        if (queryTicket) return queryTicket;
      } catch {
        // ignore
      }
    }
    return null;
  }

  private handleMessage(client: WebSocket, raw: string) {
    const state = this.clients.get(client);
    if (!state) return;

    try {
      const message = JSON.parse(raw) as {
        action?: 'subscribe' | 'unsubscribe';
        assessmentId?: string;
      };

      if (!message.assessmentId) return;
      if (message.action === 'unsubscribe') {
        state.subscriptions.delete(message.assessmentId);
        return;
      }
      if (message.action === 'subscribe') {
        state.subscriptions.add(message.assessmentId);
      }
    } catch (error) {
      this.logger.warn(`Invalid websocket payload: ${error instanceof Error ? error.message : error}`);
    }
  }

  private broadcast(event: AssessmentRealtimeEvent) {
    for (const [client, state] of this.clients.entries()) {
      if (
        client.readyState === client.OPEN &&
        state.userId === event.userId &&
        state.subscriptions.has(event.assessmentId)
      ) {
        client.send(JSON.stringify(event));
      }
    }
  }
}
