export type HealthResponse = {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  redis?: 'up' | 'down' | 'disabled';
  uptime: number;
};

export type AuthTokens = {
  accessToken: string;
};

export type WsTicket = {
  ticket: string;
  expiresAt: string;
};

export type UserProfile = {
  id: string;
  email: string;
  createdAt: string;
};

export type CreditBalance = {
  credits: number;
};

export type PlanDto = {
  id: string;
  code: string;
  name: string;
  credits: number;
  priceCents: number;
};

export type RecordingDto = {
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  status: string;
  createdAt: string;
  url: string;
};

export type RecordingDetailDto = RecordingDto & {
  playUrl: string;
};

export type OrderDto = {
  id: string;
  planId: string;
  amountCents: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  provider: string;
  createdAt: string;
  paidAt: string | null;
  payUrl?: string;
};

export type AssessmentDto = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  inputType: 'TEXT' | 'RECORDING';
  inputText: string | null;
  rubricJson: Record<string, number> | null;
  feedbackMarkdown: string | null;
  issues?: string[];
  rewrites?: string[];
  drills?: string[];
  createdAt: string;
};

export type AssessmentCreatedDto = {
  assessmentId: string;
  traceId: string;
  sseUrl: string;
  wsUrl?: string;
};

export type PresignResponseDto = {
  uploadUrl: string;
  objectKey: string;
  fileUrl: string;
};
