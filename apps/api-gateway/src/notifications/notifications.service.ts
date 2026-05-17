import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma';

type DeliveryResult = {
  provider: 'mock' | 'resend';
  accepted: boolean;
};

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function renderLinesAsHtml(lines: string[]): string {
  const parts: string[] = [];
  let listBuffer: string[] = [];
  const flushList = () => {
    if (listBuffer.length === 0) return;
    parts.push(`<ul>${listBuffer.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    listBuffer = [];
  };
  for (const line of lines) {
    if (line.startsWith('- ')) {
      listBuffer.push(line.slice(2));
      continue;
    }
    flushList();
    if (line.trim() === '') {
      continue;
    }
    parts.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushList();
  return parts.join('');
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendAssessmentSummary(userId: string, assessmentId: string): Promise<DeliveryResult> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, userId },
      include: { user: true, events: { where: { type: 'FINAL' }, orderBy: { seq: 'desc' }, take: 1 } },
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }
    if (assessment.status !== 'SUCCEEDED') {
      throw new BadRequestException('Assessment must be completed before emailing');
    }

    const finalPayload = (assessment.events[0]?.payloadJson ?? {}) as {
      issues?: string[];
      rewrites?: string[];
      drills?: string[];
    };

    const subject = `Your FluentOps assessment summary`;
    const lines = [
      `Hi ${assessment.user.email},`,
      '',
      'Here is your latest FluentOps assessment:',
      `Input: ${assessment.inputText ?? '(recording)'}`,
      `Status: ${assessment.status}`,
      `Grammar score: ${((assessment.rubricJson as Record<string, number> | null)?.grammar ?? 0)}%`,
      `Fluency score: ${((assessment.rubricJson as Record<string, number> | null)?.fluency ?? 0)}%`,
      '',
      'Issues:',
      ...(finalPayload.issues?.map((item) => `- ${item}`) ?? ['- None']),
      '',
      'Rewrites:',
      ...(finalPayload.rewrites?.map((item) => `- ${item}`) ?? ['- None']),
      '',
      'Drills:',
      ...(finalPayload.drills?.map((item) => `- ${item}`) ?? ['- None']),
      '',
      assessment.feedbackMarkdown ?? '',
    ];

    return this.deliver({
      to: assessment.user.email,
      subject,
      text: lines.join('\n'),
      html: renderLinesAsHtml(lines),
    });
  }

  private async deliver(payload: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<DeliveryResult> {
    const provider = (this.config.get<string>('EMAIL_PROVIDER') || 'mock').toLowerCase();
    const from = this.config.get<string>('EMAIL_FROM') || 'noreply@fluentops.local';
    const apiKey = this.config.get<string>('RESEND_API_KEY');

    if (provider === 'resend' && apiKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(`Resend delivery failed: ${body}`);
        throw new BadRequestException('Email provider rejected the request');
      }

      return { provider: 'resend', accepted: true };
    }

    this.logger.log(
      `Mock email delivery -> to=${payload.to} subject="${payload.subject}" body="${payload.text.slice(0, 160)}"`,
    );
    return { provider: 'mock', accepted: true };
  }
}
