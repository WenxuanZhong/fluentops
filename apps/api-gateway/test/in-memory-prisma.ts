/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'crypto';

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
};

type RefreshTokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedFromId: string | null;
  createdAt: Date;
};

type RecordingRow = {
  id: string;
  userId: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  status: 'PENDING' | 'UPLOADED';
  createdAt: Date;
};

type AssessmentRow = {
  id: string;
  userId: string;
  traceId: string;
  inputType: 'TEXT' | 'RECORDING';
  inputText: string | null;
  recordingId: string | null;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  rubricJson: Record<string, unknown> | null;
  feedbackMarkdown: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AssessmentEventRow = {
  id: string;
  assessmentId: string;
  seq: number;
  type: 'PROGRESS' | 'TOKEN' | 'FINAL' | 'ERROR';
  payloadJson: Record<string, unknown>;
  createdAt: Date;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
  type: 'CREDITS' | 'SUBSCRIPTION';
  credits: number | null;
  priceCents: number;
  createdAt: Date;
};

type UserBalanceRow = {
  id: string;
  userId: string;
  credits: number;
  expiresAt: Date | null;
};

type OrderRow = {
  id: string;
  userId: string;
  planId: string;
  amountCents: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  provider: 'MOCK' | 'ALIPAY';
  providerTradeNo: string | null;
  createdAt: Date;
  paidAt: Date | null;
};

type CreditLedgerRow = {
  id: string;
  userId: string;
  delta: number;
  reason: string;
  refId: string | null;
  createdAt: Date;
};

type State = {
  users: UserRow[];
  refreshTokens: RefreshTokenRow[];
  recordings: RecordingRow[];
  assessments: AssessmentRow[];
  assessmentEvents: AssessmentEventRow[];
  plans: PlanRow[];
  userBalances: UserBalanceRow[];
  orders: OrderRow[];
  creditLedger: CreditLedgerRow[];
};

const createId = () => `c${randomBytes(15).toString('hex')}`;

const orderRows = <T extends Record<string, unknown>>(rows: T[], orderBy?: Record<string, 'asc' | 'desc'>) => {
  if (!orderBy) {
    return [...rows];
  }

  const [field, direction] = Object.entries(orderBy)[0] ?? [];
  if (!field || !direction) {
    return [...rows];
  }

  const sorted = [...rows].sort((left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue instanceof Date && rightValue instanceof Date) {
      return leftValue.getTime() - rightValue.getTime();
    }
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return leftValue - rightValue;
    }
    return String(leftValue).localeCompare(String(rightValue));
  });

  return direction === 'desc' ? sorted.reverse() : sorted;
};

const paginateRows = <T>(rows: T[], skip = 0, take?: number) =>
  rows.slice(skip, take === undefined ? rows.length : skip + take);

const matchesCondition = (value: unknown, expected: unknown): boolean => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
    const condition = expected as Record<string, unknown>;
    if ('gt' in condition) {
      return (value as Date | number | string) > (condition.gt as Date | number | string);
    }
    if ('lt' in condition) {
      return (value as Date | number | string) < (condition.lt as Date | number | string);
    }
    if ('in' in condition) {
      return Array.isArray(condition.in) && condition.in.includes(value);
    }
  }

  if (expected === null) {
    return value === null;
  }

  return value === expected;
};

const matchesWhere = <T extends Record<string, unknown>>(row: T, where?: Record<string, unknown>) => {
  if (!where) {
    return true;
  }

  return Object.entries(where).every(([field, expected]) => matchesCondition(row[field], expected));
};

const pickSelected = <T extends Record<string, unknown>>(row: T, select?: Record<string, unknown>) => {
  if (!select) {
    return { ...row };
  }

  const result: Record<string, unknown> = {};
  for (const [field, enabled] of Object.entries(select)) {
    if (enabled === true) {
      result[field] = row[field];
    }
  }
  return result;
};

class InMemoryPrismaService {
  private state: State = {
    users: [],
    refreshTokens: [],
    recordings: [],
    assessments: [],
    assessmentEvents: [],
    plans: [],
    userBalances: [],
    orders: [],
    creditLedger: [],
  };

  readonly user = {
    findUnique: async (args: any) => {
      const user = this.state.users.find((row) => matchesWhere(row, args?.where));
      return user ? pickSelected(user, args?.select) : null;
    },
    findUniqueOrThrow: async (args: any) => {
      const user = this.state.users.find((row) => matchesWhere(row, args?.where));
      if (!user) {
        throw new Error('User not found');
      }
      return pickSelected(user, args?.select);
    },
    findFirstOrThrow: async (args: any) => {
      const user = this.state.users.find((row) => matchesWhere(row, args?.where));
      if (!user) {
        throw new Error('User not found');
      }
      return { ...user };
    },
    create: async (args: any) => {
      const user: UserRow = {
        id: createId(),
        email: args.data.email,
        passwordHash: args.data.passwordHash,
        createdAt: new Date(),
      };
      this.state.users.push(user);
      return { ...user };
    },
  };

  readonly refreshToken = {
    deleteMany: async (args: any) => {
      const before = this.state.refreshTokens.length;
      this.state.refreshTokens = this.state.refreshTokens.filter((row) => !matchesWhere(row, args?.where));
      return { count: before - this.state.refreshTokens.length };
    },
    findFirst: async (args: any) => {
      const token = this.state.refreshTokens.find((row) => matchesWhere(row, args?.where));
      return token ? pickSelected(token, args?.select) : null;
    },
    updateMany: async (args: any) => {
      let count = 0;
      this.state.refreshTokens = this.state.refreshTokens.map((row) => {
        if (!matchesWhere(row, args?.where)) {
          return row;
        }
        count += 1;
        return {
          ...row,
          ...args.data,
        };
      });
      return { count };
    },
    create: async (args: any) => {
      const token: RefreshTokenRow = {
        id: createId(),
        userId: args.data.userId,
        tokenHash: args.data.tokenHash,
        expiresAt: args.data.expiresAt,
        revokedAt: null,
        rotatedFromId: args.data.rotatedFromId ?? null,
        createdAt: new Date(),
      };
      this.state.refreshTokens.push(token);
      return { ...token };
    },
  };

  readonly recording = {
    create: async (args: any) => {
      const recording: RecordingRow = {
        id: createId(),
        userId: args.data.userId,
        objectKey: args.data.objectKey,
        mimeType: args.data.mimeType,
        sizeBytes: args.data.sizeBytes,
        durationMs: args.data.durationMs ?? null,
        status: args.data.status ?? 'PENDING',
        createdAt: new Date(),
      };
      this.state.recordings.push(recording);
      return { ...recording };
    },
    findMany: async (args: any) => {
      const rows = paginateRows(
        orderRows(
          this.state.recordings.filter((row) => matchesWhere(row, args?.where)),
          args?.orderBy,
        ),
        args?.skip ?? 0,
        args?.take,
      );
      return rows.map((row) => ({ ...row }));
    },
    findFirst: async (args: any) => {
      const recording = this.state.recordings.find((row) => matchesWhere(row, args?.where));
      return recording ? { ...recording } : null;
    },
    findUnique: async (args: any) => {
      const recording = this.state.recordings.find((row) => matchesWhere(row, args?.where));
      return recording ? { ...recording } : null;
    },
    deleteMany: async (args: any) => {
      const before = this.state.recordings.length;
      this.state.recordings = this.state.recordings.filter((row) => !matchesWhere(row, args?.where));
      return { count: before - this.state.recordings.length };
    },
  };

  readonly assessment = {
    create: async (args: any) => {
      const now = new Date();
      const assessment: AssessmentRow = {
        id: createId(),
        userId: args.data.userId,
        traceId: createId(),
        inputType: args.data.inputType,
        inputText: args.data.inputText ?? null,
        recordingId: args.data.recordingId ?? null,
        status: 'QUEUED',
        rubricJson: null,
        feedbackMarkdown: null,
        createdAt: now,
        updatedAt: now,
      };
      this.state.assessments.push(assessment);
      return { ...assessment };
    },
    delete: async (args: any) => {
      const assessment = this.state.assessments.find((row) => row.id === args.where.id);
      if (!assessment) {
        throw new Error('Assessment not found');
      }
      this.state.assessments = this.state.assessments.filter((row) => row.id !== args.where.id);
      this.state.assessmentEvents = this.state.assessmentEvents.filter((row) => row.assessmentId !== args.where.id);
      return { ...assessment };
    },
    update: async (args: any) => {
      let updated: AssessmentRow | null = null;
      this.state.assessments = this.state.assessments.map((row) => {
        if (row.id !== args.where.id) {
          return row;
        }
        const next: AssessmentRow = {
          ...row,
          ...args.data,
          updatedAt: new Date(),
        };
        updated = next;
        return next;
      });
      if (!updated) {
        throw new Error('Assessment not found');
      }
      return { ...(updated as AssessmentRow) };
    },
    findUnique: async (args: any) => {
      const assessment = this.state.assessments.find((row) => matchesWhere(row, args?.where));
      return assessment ? pickSelected(assessment, args?.select) : null;
    },
    findFirst: async (args: any) => {
      const assessment = this.state.assessments.find((row) => matchesWhere(row, args?.where));
      if (!assessment) {
        return null;
      }
      if (args?.select?.events) {
        const eventArgs = args.select.events;
        const events = paginateRows(
          orderRows(
            this.state.assessmentEvents.filter(
              (row) => row.assessmentId === assessment.id && matchesWhere(row, eventArgs.where),
            ),
            eventArgs.orderBy,
          ),
          0,
          eventArgs.take,
        ).map((row) => pickSelected(row, eventArgs.select));
        return {
          ...pickSelected(assessment, args.select),
          events,
        };
      }
      return pickSelected(assessment, args?.select);
    },
    findMany: async (args: any) => {
      const rows = paginateRows(
        orderRows(
          this.state.assessments.filter((row) => matchesWhere(row, args?.where)),
          args?.orderBy,
        ),
        args?.skip ?? 0,
        args?.take,
      );
      if (!args?.select) {
        return rows.map((row) => ({ ...row }));
      }
      return rows.map((row) => {
        const result = pickSelected(row, args.select);
        if (args.select._count?.select?.events) {
          result._count = {
            events: this.state.assessmentEvents.filter((event) => event.assessmentId === row.id).length,
          };
        }
        return result;
      });
    },
  };

  readonly assessmentEvent = {
    create: async (args: any) => {
      const event: AssessmentEventRow = {
        id: createId(),
        assessmentId: args.data.assessmentId,
        seq: args.data.seq,
        type: args.data.type,
        payloadJson: args.data.payloadJson,
        createdAt: new Date(),
      };
      this.state.assessmentEvents.push(event);
      return { ...event };
    },
    count: async (args: any) => this.state.assessmentEvents.filter((row) => matchesWhere(row, args?.where)).length,
    findMany: async (args: any) => {
      const rows = paginateRows(
        orderRows(
          this.state.assessmentEvents.filter((row) => matchesWhere(row, args?.where)),
          args?.orderBy,
        ),
        0,
        args?.take,
      );
      return rows.map((row) => ({ ...row }));
    },
  };

  readonly plan = {
    upsert: async (args: any) => {
      const existing = this.state.plans.find((row) => row.code === args.where.code);
      if (existing) {
        Object.assign(existing, args.update ?? {});
        return { ...existing };
      }
      const plan: PlanRow = {
        id: createId(),
        code: args.create.code,
        name: args.create.name,
        type: args.create.type,
        credits: args.create.credits ?? null,
        priceCents: args.create.priceCents,
        createdAt: new Date(),
      };
      this.state.plans.push(plan);
      return { ...plan };
    },
    findMany: async () => this.state.plans.map((row) => ({ ...row })),
    findUniqueOrThrow: async (args: any) => {
      const plan = this.state.plans.find((row) => matchesWhere(row, args?.where));
      if (!plan) {
        throw new Error('Plan not found');
      }
      return { ...plan };
    },
  };

  readonly userBalance = {
    findUnique: async (args: any) => {
      const row = this.state.userBalances.find((balance) => matchesWhere(balance, args?.where));
      return row ? { ...row } : null;
    },
    upsert: async (args: any) => {
      const existing = this.state.userBalances.find((row) => row.userId === args.where.userId);
      if (!existing) {
        const created: UserBalanceRow = {
          id: createId(),
          userId: args.create.userId,
          credits: args.create.credits,
          expiresAt: args.create.expiresAt ?? null,
        };
        this.state.userBalances.push(created);
        return { ...created };
      }
      if (typeof args.update.credits === 'number') {
        existing.credits = args.update.credits;
      } else if (args.update.credits?.increment) {
        existing.credits += args.update.credits.increment;
      } else if (args.update.credits?.decrement) {
        existing.credits -= args.update.credits.decrement;
      }
      if ('expiresAt' in args.update) {
        existing.expiresAt = args.update.expiresAt ?? null;
      }
      return { ...existing };
    },
    updateMany: async (args: any) => {
      let count = 0;
      this.state.userBalances = this.state.userBalances.map((row) => {
        if (!matchesWhere(row, args?.where)) {
          return row;
        }
        count += 1;
        const updated = { ...row };
        if (args.data.credits?.increment) {
          updated.credits += args.data.credits.increment;
        } else if (args.data.credits?.decrement) {
          updated.credits -= args.data.credits.decrement;
        } else if (typeof args.data.credits === 'number') {
          updated.credits = args.data.credits;
        }
        return updated;
      });
      return { count };
    },
    deleteMany: async (args: any) => {
      const before = this.state.userBalances.length;
      this.state.userBalances = this.state.userBalances.filter((row) => !matchesWhere(row, args?.where));
      return { count: before - this.state.userBalances.length };
    },
    update: async (args: any) => {
      const existing = this.state.userBalances.find((row) => row.userId === args.where.userId);
      if (!existing) {
        throw new Error('User balance not found');
      }
      if (typeof args.data.credits === 'number') {
        existing.credits = args.data.credits;
      }
      return { ...existing };
    },
  };

  readonly order = {
    create: async (args: any) => {
      const order: OrderRow = {
        id: createId(),
        userId: args.data.userId,
        planId: args.data.planId,
        amountCents: args.data.amountCents,
        status: 'PENDING',
        provider: args.data.provider,
        providerTradeNo: null,
        createdAt: new Date(),
        paidAt: null,
      };
      this.state.orders.push(order);
      return { ...order };
    },
    findFirstOrThrow: async (args: any) => {
      const order = this.state.orders.find((row) => matchesWhere(row, args?.where));
      if (!order) {
        throw new Error('Order not found');
      }
      return { ...order };
    },
    findUniqueOrThrow: async (args: any) => {
      const order = this.state.orders.find((row) => matchesWhere(row, args?.where));
      if (!order) {
        throw new Error('Order not found');
      }
      if (args?.include?.plan) {
        const plan = this.state.plans.find((row) => row.id === order.planId);
        if (!plan) {
          throw new Error('Plan not found');
        }
        return { ...order, plan: { ...plan } };
      }
      return { ...order };
    },
    findUnique: async (args: any) => {
      const order = this.state.orders.find((row) => matchesWhere(row, args?.where));
      return order ? { ...order } : null;
    },
    update: async (args: any) => {
      let updated: OrderRow | null = null;
      this.state.orders = this.state.orders.map((row) => {
        if (row.id !== args.where.id) {
          return row;
        }
        const next: OrderRow = {
          ...row,
          ...args.data,
        };
        updated = next;
        return next;
      });
      if (!updated) {
        throw new Error('Order not found');
      }
      return { ...(updated as OrderRow) };
    },
  };

  readonly creditLedger = {
    create: async (args: any) => {
      const entry: CreditLedgerRow = {
        id: createId(),
        userId: args.data.userId,
        delta: args.data.delta,
        reason: args.data.reason,
        refId: args.data.refId ?? null,
        createdAt: new Date(),
      };
      this.state.creditLedger.push(entry);
      return { ...entry };
    },
    findFirst: async (args: any) => {
      const entry = this.state.creditLedger.find((row) => matchesWhere(row, args?.where));
      return entry ? { ...entry } : null;
    },
  };

  async $queryRaw(_strings: TemplateStringsArray, ..._values: unknown[]) {
    return [{ '?column?': 1 }];
  }

  async $transaction<T>(callback: (tx: InMemoryPrismaService) => Promise<T>) {
    const snapshot = structuredClone(this.state);
    try {
      return await callback(this);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  async $disconnect() {
    return undefined;
  }

  reset() {
    this.state = {
      users: [],
      refreshTokens: [],
      recordings: [],
      assessments: [],
      assessmentEvents: [],
      plans: [],
      userBalances: [],
      orders: [],
      creditLedger: [],
    };
  }
}

export const createInMemoryPrisma = () => new InMemoryPrismaService();
