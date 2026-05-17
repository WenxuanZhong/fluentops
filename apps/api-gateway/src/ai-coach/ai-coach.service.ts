import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, timer, from, EMPTY } from 'rxjs';
import { switchMap, concatMap, tap, map, takeWhile, expand } from 'rxjs/operators';
import { PrismaService } from '../prisma';
import { BillingService } from '../billing';
import { buildGraph, createLLM, runMockWorkflow } from './ai-coach.workflow';
import { AssessDto } from './dto';
import { PaginationDto } from '../common/pagination.dto';
import { AssessmentRealtimeService } from '../realtime/assessment-realtime.service';

const STAGE_PCT: Record<string, [number, number]> = {
  diagnose: [5, 25],
  rewrite: [30, 50],
  drills: [55, 75],
  score: [80, 95],
};

const WORKFLOW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const STREAM_MAX_DURATION_MS = WORKFLOW_TIMEOUT_MS + 30 * 1000;
const STREAM_STATUS_CHECK_INTERVAL = 5;

@Injectable()
export class AICoachService {
  private readonly logger = new Logger(AICoachService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private billingService: BillingService,
    private realtimeService: AssessmentRealtimeService,
  ) {}

  async createAssessment(userId: string, dto: AssessDto) {
    if (dto.inputType === 'recording') {
      throw new BadRequestException('Recording assessments are not supported yet');
    }

    const assessment = await this.prisma.assessment.create({
      data: {
        userId,
        inputType: dto.inputType === 'text' ? 'TEXT' : 'RECORDING',
        inputText: dto.text?.trim(),
        recordingId: dto.recordingId,
      },
    });

    try {
      await this.billingService.deductCredit(userId, 'ai_assess', assessment.id);
    } catch (error) {
      await this.prisma.assessment.delete({ where: { id: assessment.id } }).catch((deleteError) => {
        this.logger.error(
          `Failed to roll back assessment ${assessment.id} after credit reservation error`,
          deleteError instanceof Error ? deleteError.stack : deleteError,
        );
      });
      throw error;
    }

    this.runWorkflowWithTimeout(assessment.id, userId, dto).catch((err) =>
      this.logger.error(`Workflow failed for assessment ${assessment.id}`, err?.stack ?? err),
    );

    return { assessmentId: assessment.id, traceId: assessment.traceId };
  }

  private async runWorkflowWithTimeout(assessmentId: string, userId: string, dto: AssessDto) {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Workflow timed out after ${WORKFLOW_TIMEOUT_MS}ms`)),
        WORKFLOW_TIMEOUT_MS,
      );
      timeoutHandle.unref?.();
    });
    try {
      await Promise.race([this.runWorkflow(assessmentId, userId, dto), timeout]);
    } catch (err) {
      // Ensure status is FAILED regardless of where the error originated — use transaction for atomicity
      try {
        const failureEvent = await this.prisma.$transaction(async (tx) => {
          const assessment = await tx.assessment.findUnique({ where: { id: assessmentId } });
          if (!assessment || assessment.status !== 'RUNNING') {
            return null;
          }
          const count = await tx.assessmentEvent.count({ where: { assessmentId } });
          await tx.assessmentEvent.create({
            data: { assessmentId, seq: count, type: 'ERROR', payloadJson: { message: 'Assessment timed out or failed unexpectedly' } },
          });
          await tx.assessment.update({ where: { id: assessmentId }, data: { status: 'FAILED' } });
          return { seq: count };
        });
        if (failureEvent) {
          this.realtimeService.publish({
            assessmentId,
            userId,
            seq: failureEvent.seq,
            type: 'error',
            data: { message: 'Assessment timed out or failed unexpectedly' },
          });
          await this.billingService.refundCredit(userId, 'ai_assess_refund', assessmentId);
        }
      } catch (txErr) {
        this.logger.error(`Failed to mark assessment ${assessmentId} as FAILED`, txErr instanceof Error ? txErr.stack : txErr);
      }
      throw err;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async runWorkflow(assessmentId: string, userId: string, dto: AssessDto) {
    const provider = this.config.get<string>('AI_PROVIDER') || '';
    const apiKey = this.config.get<string>('OPENAI_API_KEY') || '';
    const isMock = provider === 'mock' || !apiKey;

    await this.prisma.assessment.update({ where: { id: assessmentId }, data: { status: 'RUNNING' } });

    try {
      let seq = 0;
      const writeProgress = async (stage: string, pct: number) => {
        await this.writeEvent(assessmentId, userId, seq++, 'PROGRESS', { stage, pct });
      };

      let result: { issues: string[]; rewrites: string[]; drills: string[]; rubric: Record<string, number>; feedback: string };

      if (isMock) {
        result = await runMockWorkflow(writeProgress);
      } else {
        const model = this.config.get<string>('MODEL_NAME') || 'gpt-4o-mini';
        const temperature = parseFloat(this.config.get<string>('AI_TEMPERATURE') || '0.7');
        const llm = createLLM(apiKey, model, temperature);

        const callbacks = {
          beforeNode: async (name: string) => {
            await writeProgress(name, STAGE_PCT[name]?.[0] ?? 0);
          },
          afterNode: async (name: string) => {
            await writeProgress(name, STAGE_PCT[name]?.[1] ?? 0);
          },
        };

        const graph = buildGraph(llm, callbacks);
        result = await graph.invoke({
          text: dto.text || '',
          goals: dto.goals || [],
          issues: [],
          rewrites: [],
          drills: [],
          rubric: {},
          feedback: '',
        });
      }

      const current = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { status: true },
      });
      if (!current || current.status !== 'RUNNING') {
        return;
      }

      const finalPayload = {
        rubric: result.rubric,
        issues: result.issues,
        rewrites: result.rewrites,
        drills: result.drills,
        feedbackMarkdown: result.feedback,
      };

      await this.writeEvent(assessmentId, userId, seq++, 'FINAL', finalPayload);

      await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: { status: 'SUCCEEDED', rubricJson: result.rubric, feedbackMarkdown: result.feedback },
      });
    } catch (err) {
      this.logger.error(`Assessment ${assessmentId} failed`, err instanceof Error ? err.stack : err);
      const current = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { status: true },
      });
      if (current?.status === 'RUNNING') {
        const count = await this.prisma.assessmentEvent.count({ where: { assessmentId } });
        await this.writeEvent(assessmentId, userId, count, 'ERROR', { message: 'Assessment failed' });
        await this.prisma.assessment.update({ where: { id: assessmentId }, data: { status: 'FAILED' } });
      }
      await this.billingService.refundCredit(userId, 'ai_assess_refund', assessmentId);
    }
  }

  private async writeEvent(
    assessmentId: string,
    userId: string,
    seq: number,
    type: string,
    payload: unknown,
  ) {
    await this.prisma.assessmentEvent.create({
      data: {
        assessmentId,
        seq,
        type: type as 'PROGRESS' | 'TOKEN' | 'FINAL' | 'ERROR',
        payloadJson: payload as object,
      },
    });

    if (type === 'PROGRESS' || type === 'FINAL' || type === 'ERROR') {
      this.realtimeService.publish({
        assessmentId,
        userId,
        seq,
        type: type.toLowerCase() as 'progress' | 'final' | 'error',
        data: payload,
      });
    }
  }

  async getAssessment(userId: string, id: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id, userId },
      select: {
        id: true,
        status: true,
        rubricJson: true,
        feedbackMarkdown: true,
        traceId: true,
        inputType: true,
        inputText: true,
        createdAt: true,
        events: {
          where: { type: 'FINAL' },
          orderBy: { seq: 'desc' },
          take: 1,
          select: { payloadJson: true },
        },
      },
    });

    if (!assessment) {
      return null;
    }

    const finalPayload = assessment.events?.[0]?.payloadJson as
      | {
          issues?: string[];
          rewrites?: string[];
          drills?: string[];
          feedbackMarkdown?: string;
          rubric?: Record<string, number>;
        }
      | undefined;

    return {
      id: assessment.id,
      status: assessment.status,
      rubricJson: assessment.rubricJson ?? finalPayload?.rubric ?? null,
      feedbackMarkdown:
        assessment.feedbackMarkdown ?? finalPayload?.feedbackMarkdown ?? null,
      traceId: assessment.traceId,
      inputType: assessment.inputType,
      inputText: assessment.inputText,
      createdAt: assessment.createdAt,
      issues: finalPayload?.issues ?? [],
      rewrites: finalPayload?.rewrites ?? [],
      drills: finalPayload?.drills ?? [],
    };
  }

  async listAssessments(userId: string, pagination?: PaginationDto) {
    return this.prisma.assessment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: pagination?.skip ?? 0,
      take: pagination?.take ?? 20,
      select: {
        id: true,
        status: true,
        inputType: true,
        inputText: true,
        rubricJson: true,
        createdAt: true,
        _count: { select: { events: true } },
      },
    });
  }

  async ensureOwnership(assessmentId: string, userId: string) {
    const owned = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, userId },
      select: { id: true },
    });
    if (!owned) {
      throw new NotFoundException('Assessment not found');
    }
  }

  streamEvents(assessmentId: string, since = -1): Observable<MessageEvent> {
    let lastSeq = since;
    let pollMs = 300; // start fast, back off when idle
    const MIN_POLL = 300;
    const MAX_POLL = 3000;
    const startedAt = Date.now();
    let pollsSinceStatusCheck = 0;

    const fetchEvents = async () => {
      if (Date.now() - startedAt > STREAM_MAX_DURATION_MS) {
        return [
          {
            seq: lastSeq + 1,
            type: 'ERROR',
            payloadJson: { message: 'Stream timed out' },
          },
        ];
      }
      const events = await this.prisma.assessmentEvent.findMany({
        where: { assessmentId, seq: { gt: lastSeq } },
        orderBy: { seq: 'asc' },
        take: 50,
      });
      if (events.length > 0) {
        return events;
      }
      // Periodically check whether the underlying assessment is still RUNNING.
      // If it terminated without writing a terminal event (e.g., process restart),
      // synthesize one so the client doesn't poll forever.
      pollsSinceStatusCheck += 1;
      if (pollsSinceStatusCheck < STREAM_STATUS_CHECK_INTERVAL) {
        return [];
      }
      pollsSinceStatusCheck = 0;
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { status: true },
      });
      if (!assessment) {
        return [
          {
            seq: lastSeq + 1,
            type: 'ERROR',
            payloadJson: { message: 'Assessment not found' },
          },
        ];
      }
      if (assessment.status === 'FAILED') {
        return [
          {
            seq: lastSeq + 1,
            type: 'ERROR',
            payloadJson: { message: 'Assessment failed' },
          },
        ];
      }
      if (assessment.status === 'SUCCEEDED') {
        return [
          {
            seq: lastSeq + 1,
            type: 'FINAL',
            payloadJson: {},
          },
        ];
      }
      return [];
    };

    // Use recursive timer for adaptive polling
    return timer(0).pipe(
      expand(() => timer(pollMs)),
      switchMap(() => from(fetchEvents())),
      tap((events) => {
        if (events.length > 0) {
          pollMs = MIN_POLL; // reset to fast polling on activity
        } else {
          pollMs = Math.min(pollMs * 1.5, MAX_POLL); // back off when idle
        }
      }),
      concatMap((events) => (events.length ? from(events) : EMPTY)),
      tap((event) => {
        lastSeq = event.seq;
      }),
      map(
        (event) =>
          ({
            data: event.payloadJson,
            type: event.type.toLowerCase(),
            id: String(event.seq),
          }) as MessageEvent,
      ),
      takeWhile((event) => event.type !== 'final' && event.type !== 'error', true),
    );
  }
}
