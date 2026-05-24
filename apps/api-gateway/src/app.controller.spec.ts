import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaService } from './prisma';
import { RedisService } from './redis/redis.service';
import { MinioService } from './media';

describe('AppController', () => {
  let appController: AppController;
  let prisma: { $queryRaw: jest.Mock };
  let redis: { getStatus: jest.Mock };
  let minio: { getStatus: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    redis = { getStatus: jest.fn().mockReturnValue('disabled') };
    minio = { getStatus: jest.fn().mockResolvedValue('up') };
    config = { get: jest.fn().mockReturnValue('test') };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: MinioService, useValue: minio },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('GET /health returns ok when DB is up', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
    await appController.health(res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok', db: 'up', redis: 'disabled', storage: 'up' }));
  });

  it('GET /health returns 503 in production when Redis is down', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.getStatus.mockReturnValue('down');
    config.get.mockImplementation((key: string) => (key === 'NODE_ENV' ? 'production' : undefined));
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
    await appController.health(res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', db: 'up', redis: 'down', storage: 'up' }));
  });

  it('GET /health returns 503 in production when object storage is down', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.getStatus.mockReturnValue('up');
    minio.getStatus.mockResolvedValue('down');
    config.get.mockImplementation((key: string) => (key === 'NODE_ENV' ? 'production' : undefined));
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
    await appController.health(res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', db: 'up', redis: 'up', storage: 'down' }));
  });

  it('GET /health returns 503 when DB is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
    await appController.health(res);
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', db: 'down', redis: 'disabled', storage: 'up' }));
  });
});
