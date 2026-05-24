import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import request, { Response } from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma';
import { MinioService } from './../src/media';
import { createInMemoryPrisma } from './in-memory-prisma';

jest.setTimeout(30000);

describe('App (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const useRealDb = process.env['E2E_USE_REAL_DB'] === 'true';
  const inMemoryPrisma = useRealDb ? null : createInMemoryPrisma();

  const userA = {
    email: `test-a-${Date.now()}@example.com`,
    password: 'password123',
  };
  const userB = {
    email: `test-b-${Date.now()}@example.com`,
    password: 'password123',
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MinioService)
      .useValue({
        onModuleInit: async () => {},
        presignedPutUrl: async () => 'http://localhost:9000/fake-put-url',
        presignedGetUrl: async () => 'http://localhost:9000/fake-get-url',
        deleteObject: async () => {},
        statObject: async () => ({ size: 12345 }),
        getStatus: async () => 'up',
      })
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true });

    if (inMemoryPrisma) {
      moduleBuilder.overrideProvider(PrismaService).useValue(inMemoryPrisma as unknown as PrismaService);
    }

    const moduleFixture: TestingModule = await moduleBuilder.compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma && useRealDb) {
      await prisma.assessmentEvent.deleteMany({ where: { assessment: { user: { email: { in: [userA.email, userB.email] } } } } });
      await prisma.assessment.deleteMany({ where: { user: { email: { in: [userA.email, userB.email] } } } });
      await prisma.creditLedger.deleteMany({ where: { user: { email: { in: [userA.email, userB.email] } } } });
      await prisma.order.deleteMany({ where: { user: { email: { in: [userA.email, userB.email] } } } });
      await prisma.userBalance.deleteMany({ where: { user: { email: { in: [userA.email, userB.email] } } } });
      await prisma.recording.deleteMany({ where: { user: { email: { in: [userA.email, userB.email] } } } });
      await prisma.user.deleteMany({ where: { email: { in: [userA.email, userB.email] } } });
    }
    inMemoryPrisma?.reset();
    if (app) {
      await app.close();
    }
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res: Response) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.db).toBe('up');
        expect(typeof res.body.uptime).toBe('number');
      });
  });

  describe('Auth flow: register -> login -> refresh -> me -> logout', () => {
    let accessToken: string;
    let refreshCookie: string;

    const getRefreshSetCookie = (res: Response): string | null => {
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      return cookies.find((raw) => raw.startsWith('fo_refresh=')) ?? null;
    };

    const extractRefreshCookie = (res: Response): string | null => {
      const raw = getRefreshSetCookie(res);
      const match = raw ? /fo_refresh=([^;]+)/.exec(raw) : null;
      return match ? match[0] : null;
    };

    it('POST /api/v1/auth/register', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(userA)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe(userA.email);
    });

    it('POST /api/v1/auth/login sets refresh cookie + returns accessToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userA)
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');
      const cookie = extractRefreshCookie(res);
      expect(cookie).not.toBeNull();
      accessToken = res.body.accessToken;
      refreshCookie = cookie!;
    });

    it('GET /api/v1/me with accessToken', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(userA.email);
    });

    it('POST /api/v1/auth/refresh (rotation via cookie)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');
      const newCookie = extractRefreshCookie(res);
      expect(newCookie).not.toBeNull();
      expect(newCookie).not.toBe(refreshCookie);
      accessToken = res.body.accessToken;
      refreshCookie = newCookie!;
    });

    it('GET /api/v1/me with new accessToken', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(userA.email);
    });

    it('POST /api/v1/auth/logout clears cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', refreshCookie)
        .expect(204);

      const clearedCookie = getRefreshSetCookie(res);
      expect(clearedCookie).not.toBeNull();
      expect(clearedCookie).toMatch(/^fo_refresh=;/);
      expect(clearedCookie).not.toMatch(/Max-Age=604800/i);
    });

    it('POST /api/v1/auth/refresh with revoked cookie fails', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(401);
    });
  });

  describe('Media flow: presign -> complete -> list -> detail + isolation', () => {
    let tokenA: string;
    let tokenB: string;
    let objectKey: string;
    let recordingId: string;

    beforeAll(async () => {
      // login userA
      const resA = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userA)
        .expect(200);
      tokenA = resA.body.accessToken;

      // register + login userB
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(userB)
        .expect(201);
      const resB = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userB)
        .expect(200);
      tokenB = resB.body.accessToken;
    });

    it('POST /api/v1/media/presign returns uploadUrl, objectKey, fileUrl', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/media/presign')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ filename: 'test.webm', contentType: 'audio/webm' })
        .expect(200);

      expect(res.body).toHaveProperty('uploadUrl');
      expect(res.body).toHaveProperty('objectKey');
      expect(res.body).toHaveProperty('fileUrl');
      expect(res.body.objectKey).toContain('recordings/');
      objectKey = res.body.objectKey;
    });

    it('POST /api/v1/media/presign rejects invalid contentType', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/media/presign')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ filename: 'test.mp4', contentType: 'video/mp4' })
        .expect(400);
    });

    it('POST /api/v1/media/complete writes to DB', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/media/complete')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ objectKey, sizeBytes: 12345, mimeType: 'audio/webm', durationMs: 5000 })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('url');
      expect(res.body).toHaveProperty('createdAt');
      recordingId = res.body.id;
    });

    it('GET /api/v1/media lists recordings for current user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/media')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty('url');
    });

    it('GET /api/v1/media/:id returns detail with playUrl', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/media/${recordingId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.id).toBe(recordingId);
      expect(res.body).toHaveProperty('playUrl');
    });

    it('userB cannot see userA recordings via GET /media', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/media')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.length).toBe(0);
    });

    it('userB cannot access userA recording detail', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/media/${recordingId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('GET /api/v1/media without auth returns 401', () => {
      return request(app.getHttpServer())
        .get('/api/v1/media')
        .expect(401);
    });
  });

  describe('AI Coach flow: assess -> poll result -> list', () => {
    let tokenA: string;
    let assessmentId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userA)
        .expect(200);
      tokenA = res.body.accessToken;

      // seed credits so AI assess doesn't return 402
      const user = await prisma.user.findFirstOrThrow({ where: { email: userA.email } });
      await prisma.userBalance.upsert({
        where: { userId: user.id },
        create: { userId: user.id, credits: 10 },
        update: { credits: 10 },
      });
    });

    it('POST /api/v1/ai/assess (text) returns assessmentId + traceId + sseUrl', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ai/assess')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ inputType: 'text', text: 'I go to school yesterday and buyed a book' })
        .expect(201);

      expect(res.body).toHaveProperty('assessmentId');
      expect(res.body).toHaveProperty('traceId');
      expect(res.body).toHaveProperty('sseUrl');
      assessmentId = res.body.assessmentId;
    });

    it('GET /api/v1/ai/assess/:id returns succeeded with rubric structure', async () => {
      // poll until SUCCEEDED or timeout 5s
      let status = '';
      let body: Record<string, unknown> = {};
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/ai/assess/${assessmentId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);
        body = res.body;
        status = res.body.status;
        if (status === 'SUCCEEDED' || status === 'FAILED') break;
        await new Promise((r) => setTimeout(r, 200));
      }

      expect(status).toBe('SUCCEEDED');
      const rubric = body.rubricJson as Record<string, number>;
      expect(rubric).toBeDefined();
      expect(typeof rubric.grammar).toBe('number');
      expect(typeof rubric.vocab).toBe('number');
      expect(typeof rubric.fluency).toBe('number');
      expect(typeof rubric.clarity).toBe('number');
      expect(typeof rubric.naturalness).toBe('number');
      expect(body.feedbackMarkdown).toBeDefined();
      expect(typeof body.feedbackMarkdown).toBe('string');
    });

    it('GET /api/v1/ai/assessments lists recent assessments', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/ai/assessments')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('status');
      expect(res.body[0]).toHaveProperty('rubricJson');
    });

    it('POST /api/v1/ai/assess without auth returns 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/ai/assess')
        .send({ inputType: 'text', text: 'hello' })
        .expect(401);
    });
  });

  describe('Billing flow: plans -> buy -> credits -> AI gate', () => {
    let tokenA: string;
    let planId: string;
    let orderId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(userA)
        .expect(200);
      tokenA = res.body.accessToken;

      // reset balance so billing tests start from 0
      const user = await prisma.user.findFirstOrThrow({ where: { email: userA.email } });
      await prisma.userBalance.deleteMany({ where: { userId: user.id } });
    });

    it('GET /api/v1/billing/plans returns at least 1 plan', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/plans')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      planId = res.body[0].id;
    });

    it('GET /api/v1/billing/balance returns 0 credits', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/balance')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.credits).toBe(0);
    });

    it('POST /api/v1/billing/order creates a pending order', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/billing/order')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ planId })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.status).toBe('PENDING');
      orderId = res.body.id;
    });

    it('POST /api/v1/billing/mock/pay fulfills the order', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/billing/mock/pay')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ orderId })
        .expect(201);
    });

    it('GET /api/v1/billing/balance returns 10 credits after purchase', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/balance')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.credits).toBe(10);
    });

    it('POST /api/v1/ai/assess succeeds with credits', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ai/assess')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ inputType: 'text', text: 'I go to school yesterday and buyed a book' })
        .expect(201);

      expect(res.body).toHaveProperty('assessmentId');

      // poll until done
      const deadline = Date.now() + 5000;
      let status = '';
      while (Date.now() < deadline) {
        const poll = await request(app.getHttpServer())
          .get(`/api/v1/ai/assess/${res.body.assessmentId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);
        status = poll.body.status;
        if (status === 'SUCCEEDED' || status === 'FAILED') break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(status).toBe('SUCCEEDED');
    });

    it('GET /api/v1/billing/balance returns 9 credits after assessment', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/balance')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.credits).toBe(9);
    });

    it('POST /api/v1/ai/assess returns 402 when credits exhausted', async () => {
      // set credits to 0 directly
      const user = await prisma.user.findFirstOrThrow({ where: { email: userA.email } });
      await prisma.userBalance.update({ where: { userId: user.id }, data: { credits: 0 } });

      await request(app.getHttpServer())
        .post('/api/v1/ai/assess')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ inputType: 'text', text: 'hello world' })
        .expect(402);
    });
  });
});
