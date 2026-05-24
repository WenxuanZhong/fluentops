import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma';
import { HealthResponse } from '@fluentops/shared';
import { RedisService } from './redis/redis.service';
import { MinioService } from './media';

@ApiTags('system')
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly minio: MinioService,
    private readonly config: ConfigService,
  ) {}

  @Get('health')
  async health(@Res() res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const redisStatus = this.redis.getStatus();
      const storageStatus = await this.minio.getStatus();
      const isProduction = this.config.get<string>('NODE_ENV') === 'production';
      const isReady = !isProduction || (redisStatus === 'up' && storageStatus === 'up');
      const body: HealthResponse = {
        status: isReady ? 'ok' : 'error',
        db: 'up',
        redis: redisStatus,
        storage: storageStatus,
        uptime: process.uptime(),
      };
      res.status(isReady ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(body);
    } catch (err) {
      this.logger.error('Health check DB probe failed', err instanceof Error ? err.stack : err);
      const body: HealthResponse = {
        status: 'error',
        db: 'down',
        redis: this.redis.getStatus(),
        storage: await this.minio.getStatus(),
        uptime: process.uptime(),
      };
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json(body);
    }
  }
}
