import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma';
import { AlipayService } from './alipay.service';
import { RedisService } from '../redis/redis.service';
import { InsufficientCreditsException } from './billing.errors';

describe('BillingService', () => {
  let service: BillingService;
  let redis: { getJson: jest.Mock; setJson: jest.Mock; del: jest.Mock };
  let prisma: {
    plan: { upsert: jest.Mock; findMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    order: { create: jest.Mock; findFirstOrThrow: jest.Mock; findUniqueOrThrow: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    userBalance: { findUnique: jest.Mock; upsert: jest.Mock; updateMany: jest.Mock };
    creditLedger: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      plan: { upsert: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      order: { create: jest.fn(), findFirstOrThrow: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      userBalance: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
      creditLedger: { create: jest.fn() },
      $transaction: jest.fn((fn) => fn(prisma)),
    };
    redis = { getJson: jest.fn(), setJson: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'mock' } },
        { provide: AlipayService, useValue: { isEnabled: () => false } },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(BillingService);
  });

  describe('fulfillOrder', () => {
    it('returns early if already PAID', async () => {
      const order = { id: 'o1', status: 'PAID', plan: { credits: 10 } };
      prisma.order.findUniqueOrThrow.mockResolvedValue(order);
      const result = await service.fulfillOrder('o1');
      expect(result).toBe(order);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('deductCredit', () => {
    it('succeeds when credits > 0', async () => {
      prisma.userBalance.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.deductCredit('u1', 'test')).resolves.toBeUndefined();
    });

    it('throws when credits = 0', async () => {
      prisma.userBalance.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.deductCredit('u1', 'test')).rejects.toThrow(InsufficientCreditsException);
    });
  });

  describe('hasCredits', () => {
    it('returns true when balance > 0', async () => {
      prisma.userBalance.findUnique.mockResolvedValue({ credits: 5 });
      expect(await service.hasCredits('u1')).toBe(true);
    });

    it('returns false when no balance row', async () => {
      prisma.userBalance.findUnique.mockResolvedValue(null);
      expect(await service.hasCredits('u1')).toBe(false);
    });
  });

  describe('getBalance', () => {
    it('returns credits from row', async () => {
      prisma.userBalance.findUnique.mockResolvedValue({ credits: 7 });
      expect(await service.getBalance('u1')).toEqual({ credits: 7 });
    });

    it('returns 0 when no row', async () => {
      prisma.userBalance.findUnique.mockResolvedValue(null);
      expect(await service.getBalance('u1')).toEqual({ credits: 0 });
    });
  });
});
