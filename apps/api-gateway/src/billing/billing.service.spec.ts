import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma';
import { AlipayService } from './alipay.service';
import { RedisService } from '../redis/redis.service';
import { InsufficientCreditsException } from './billing.errors';

describe('BillingService', () => {
  let service: BillingService;
  let config: { get: jest.Mock };
  let alipay: { isEnabled: jest.Mock; createPagePayUrl: jest.Mock; checkNotifySign: jest.Mock };
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
    config = { get: jest.fn().mockReturnValue('mock') };
    alipay = {
      isEnabled: jest.fn().mockReturnValue(false),
      createPagePayUrl: jest.fn(),
      checkNotifySign: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: AlipayService, useValue: alipay },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(BillingService);
  });

  describe('createOrder', () => {
    it('returns a mock order in mock billing mode', async () => {
      const plan = { id: 'plan-1', name: '10 AI Credits', priceCents: 999 };
      const order = { id: 'order-1', status: 'PENDING' };
      prisma.plan.findUniqueOrThrow.mockResolvedValue(plan);
      prisma.order.create.mockResolvedValue(order);

      await expect(service.createOrder('u1', 'plan-1')).resolves.toBe(order);
      expect(prisma.order.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          planId: 'plan-1',
          amountCents: 999,
          provider: 'MOCK',
        },
      });
    });

    it('rejects alipay orders before creating an order when the SDK is unavailable', async () => {
      config.get.mockImplementation((key: string) => (key === 'BILLING_PROVIDER' ? 'alipay' : undefined));
      alipay.isEnabled.mockReturnValue(false);
      prisma.plan.findUniqueOrThrow.mockResolvedValue({ id: 'plan-1', name: '10 AI Credits', priceCents: 999 });

      await expect(service.createOrder('u1', 'plan-1')).rejects.toThrow(
        'Payment provider is not available',
      );
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('returns an alipay payUrl when the provider is ready', async () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'BILLING_PROVIDER') return 'alipay';
        if (key === 'ALIPAY_NOTIFY_URL') return 'https://app.example.com/api/v1/billing/alipay/notify';
        return undefined;
      });
      alipay.isEnabled.mockReturnValue(true);
      alipay.createPagePayUrl.mockResolvedValue('https://openapi.alipay.com/pay');
      prisma.plan.findUniqueOrThrow.mockResolvedValue({ id: 'plan-1', name: '10 AI Credits', priceCents: 999 });
      prisma.order.create.mockResolvedValue({ id: 'order-1', status: 'PENDING' });

      await expect(service.createOrder('u1', 'plan-1')).resolves.toEqual({
        id: 'order-1',
        status: 'PENDING',
        payUrl: 'https://openapi.alipay.com/pay',
      });
      expect(alipay.createPagePayUrl).toHaveBeenCalledWith(
        'order-1',
        '10 AI Credits',
        '9.99',
        'https://app.example.com/api/v1/billing/alipay/notify',
      );
    });

    it('cancels an alipay order when payUrl creation fails', async () => {
      config.get.mockImplementation((key: string) => (key === 'BILLING_PROVIDER' ? 'alipay' : undefined));
      alipay.isEnabled.mockReturnValue(true);
      alipay.createPagePayUrl.mockRejectedValue(new Error('provider rejected request'));
      prisma.plan.findUniqueOrThrow.mockResolvedValue({ id: 'plan-1', name: '10 AI Credits', priceCents: 999 });
      prisma.order.create.mockResolvedValue({ id: 'order-1', status: 'PENDING' });

      await expect(service.createOrder('u1', 'plan-1')).rejects.toThrow(
        'Payment provider is not available',
      );
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'CANCELLED' },
      });
    });
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
