import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private enabled = false;
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.log('REDIS_URL not configured, Redis features disabled');
      return;
    }

    this.enabled = true;
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.client.on('ready', () => {
      this.ready = true;
      this.logger.log('Redis connected');
    });
    this.client.on('end', () => {
      this.ready = false;
    });
    this.client.on('error', (error) => {
      this.ready = false;
      this.logger.warn(`Redis connection error: ${error.message}`);
    });

    try {
      await this.client.connect();
    } catch (error) {
      this.ready = false;
      this.logger.warn(
        `Redis unavailable at startup: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
  }

  getStatus(): 'up' | 'down' | 'disabled' {
    if (!this.enabled) return 'disabled';
    return this.ready ? 'up' : 'down';
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.client || !this.ready) return null;
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(
        `Discarded corrupt JSON at ${key}: ${error instanceof Error ? error.message : error}`,
      );
      await this.client.del(key).catch(() => {});
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number) {
    if (!this.client || !this.ready) return;
    const payload = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, payload);
  }

  async del(key: string) {
    if (!this.client || !this.ready) return;
    await this.client.del(key);
  }
}
