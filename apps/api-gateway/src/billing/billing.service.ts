import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Plan } from '@prisma/client';
import { PrismaService } from '../prisma';
import { AlipayService } from './alipay.service';
import { RedisService } from '../redis/redis.service';
import { InsufficientCreditsException } from './billing.errors';

@Injectable()
export class BillingService implements OnModuleInit {
  private static readonly PLAN_CACHE_KEY = 'billing:plans';
  private readonly logger = new Logger(BillingService.name);
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private alipayService: AlipayService,
    private redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.prisma.plan.upsert({
      where: { code: 'credits-10' },
      update: {},
      create: { code: 'credits-10', name: '10 AI Credits', type: 'CREDITS', credits: 10, priceCents: 999 },
    });
    await this.redis.del(BillingService.PLAN_CACHE_KEY);
  }

  async listPlans() {
    const cached = await this.redis.getJson<Plan[]>(
      BillingService.PLAN_CACHE_KEY,
    );
    if (cached) {
      return cached;
    }

    const plans = await this.prisma.plan.findMany();
    await this.redis.setJson(BillingService.PLAN_CACHE_KEY, plans, 60);
    return plans;
  }

  async getBalance(userId: string) {
    const row = await this.prisma.userBalance.findUnique({ where: { userId } });
    return { credits: row?.credits ?? 0 };
  }

  async createOrder(userId: string, planId: string, notifyUrl?: string) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    const provider = this.config.get<string>('BILLING_PROVIDER') || 'mock';
    if (provider === 'alipay' && !this.alipayService.isEnabled()) {
      throw new ServiceUnavailableException('Payment provider is not available');
    }

    const order = await this.prisma.order.create({
      data: {
        userId,
        planId,
        amountCents: plan.priceCents,
        provider: provider.toUpperCase() as 'MOCK' | 'ALIPAY',
      },
    });

    if (provider === 'alipay') {
      const totalAmount = (plan.priceCents / 100).toFixed(2);
      try {
        const payUrl = await this.alipayService.createPagePayUrl(
          order.id,
          plan.name,
          totalAmount,
          notifyUrl || this.config.get<string>('ALIPAY_NOTIFY_URL') || '',
        );
        return { ...order, payUrl };
      } catch (error) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });
        this.logger.error(
          `Failed to create Alipay page pay URL for order ${order.id}`,
          error instanceof Error ? error.stack : error,
        );
        throw new ServiceUnavailableException('Payment provider is not available');
      }
    }
    return order;
  }

  async mockPay(orderId: string, userId: string) {
    const provider = this.config.get<string>('BILLING_PROVIDER') || 'mock';
    if (provider !== 'mock') throw new BadRequestException('Mock pay not available');
    const order = await this.prisma.order.findFirstOrThrow({ where: { id: orderId, userId } });
    if (order.status === 'PAID') return order;
    return this.fulfillOrder(orderId);
  }

  async fulfillOrder(orderId: string, providerTradeNo?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { plan: true } });
      if (order.status === 'PAID') return order;

      const credits = order.plan.credits ?? 0;
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: 'PAID', paidAt: new Date(), providerTradeNo: providerTradeNo ?? null },
      });
      await tx.userBalance.upsert({
        where: { userId: order.userId },
        create: { userId: order.userId, credits },
        update: { credits: { increment: credits } },
      });
      await tx.creditLedger.create({
        data: { userId: order.userId, delta: credits, reason: 'purchase', refId: orderId },
      });
      return updated;
    });
  }

  async handleAlipayNotify(params: Record<string, string>): Promise<string> {
    this.logger.log(`Alipay notify received: out_trade_no=${params.out_trade_no} trade_status=${params.trade_status} trade_no=${params.trade_no}`);

    if (!this.alipayService.checkNotifySign(params)) {
      this.logger.warn('Alipay notify signature verification failed');
      return 'fail';
    }

    if (params.app_id !== this.config.get('ALIPAY_APP_ID')) {
      this.logger.warn(`Alipay notify: app_id mismatch ${params.app_id}`);
      return 'fail';
    }

    const orderId = params.out_trade_no;
    if (!orderId || !/^c[a-z0-9]{20,30}$/.test(orderId)) {
      this.logger.warn(`Alipay notify: invalid out_trade_no format: ${orderId}`);
      return 'fail';
    }
    const tradeStatus = params.trade_status;
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') return 'success';

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) { this.logger.warn(`Alipay notify: order ${orderId} not found`); return 'fail'; }
    if (order.status === 'PAID') { this.logger.log(`Alipay notify: order ${orderId} already paid, skipping`); return 'success'; }

    const expectedAmount = (order.amountCents / 100).toFixed(2);
    if (params.total_amount !== expectedAmount) {
      this.logger.warn(`Alipay notify: amount mismatch ${params.total_amount} vs ${expectedAmount}`);
      return 'fail';
    }

    await this.fulfillOrder(orderId, params.trade_no);
    this.logger.log(`Alipay notify: order ${orderId} fulfilled, trade_no=${params.trade_no}`);
    return 'success';
  }

  async hasCredits(userId: string) {
    const row = await this.prisma.userBalance.findUnique({ where: { userId } });
    return (row?.credits ?? 0) > 0;
  }

  async deductCredit(userId: string, reason: string, refId?: string) {
    await this.prisma.$transaction(async (tx) => {
      // Idempotency check: skip if already deducted for this ref
      if (refId) {
        const existing = await tx.creditLedger.findFirst({
          where: { userId, reason, refId },
        });
        if (existing) return;
      }

      // Atomic conditional decrement — fails if credits already 0
      const { count } = await tx.userBalance.updateMany({
        where: { userId, credits: { gt: 0 } },
        data: { credits: { decrement: 1 } },
      });
      if (count === 0) throw new InsufficientCreditsException();
      await tx.creditLedger.create({ data: { userId, delta: -1, reason, refId } });
    });
  }

  async refundCredit(userId: string, reason: string, refId?: string) {
    await this.prisma.$transaction(async (tx) => {
      if (refId) {
        const existing = await tx.creditLedger.findFirst({
          where: { userId, reason, refId },
        });
        if (existing) return;
      }

      await tx.userBalance.upsert({
        where: { userId },
        create: { userId, credits: 1 },
        update: { credits: { increment: 1 } },
      });
      await tx.creditLedger.create({ data: { userId, delta: 1, reason, refId } });
    });
  }
}
