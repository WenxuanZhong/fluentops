import { plainToInstance } from 'class-transformer';
import { IsString, IsOptional, IsIn, validateSync } from 'class-validator';

class EnvVars {
  @IsString()
  DATABASE_URL!: string;

  @IsString()
  JWT_SECRET!: string;

  @IsString()
  REFRESH_SECRET!: string;

  @IsString()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

  @IsString()
  ACCESS_TOKEN_TTL: string = '15m';

  @IsString()
  REFRESH_TOKEN_TTL: string = '7d';

  @IsString()
  WS_TICKET_TTL: string = '60s';

  @IsString()
  MINIO_ENDPOINT: string = 'localhost';

  @IsString()
  MINIO_PORT: string = '9000';

  @IsString()
  MINIO_USE_SSL: string = 'false';

  @IsString()
  MINIO_ACCESS_KEY: string = 'minio';

  @IsString()
  MINIO_SECRET_KEY: string = 'minio123456';

  @IsString()
  MINIO_BUCKET: string = 'fluentops';

  @IsString()
  @IsOptional()
  MINIO_PUBLIC_URL?: string;

  @IsString()
  @IsOptional()
  OPENAI_API_KEY?: string;

  @IsString()
  AI_PROVIDER: string = 'mock';

  @IsString()
  MODEL_NAME: string = 'gpt-4o-mini';

  @IsString()
  AI_TEMPERATURE: string = '0.7';

  @IsString()
  BILLING_PROVIDER: string = 'mock';

  @IsString()
  @IsOptional()
  ALIPAY_APP_ID?: string;

  @IsString()
  @IsOptional()
  ALIPAY_PRIVATE_KEY?: string;

  @IsString()
  @IsOptional()
  ALIPAY_PUBLIC_KEY?: string;

  @IsString()
  @IsOptional()
  CORS_ORIGIN?: string;

  @IsString()
  @IsOptional()
  REDIS_URL?: string;

  @IsString()
  @IsOptional()
  ALIPAY_GATEWAY?: string;

  @IsString()
  @IsOptional()
  ALIPAY_NOTIFY_URL?: string;

  @IsString()
  EMAIL_PROVIDER: string = 'mock';

  @IsString()
  @IsOptional()
  EMAIL_FROM?: string;

  @IsString()
  @IsOptional()
  RESEND_API_KEY?: string;

  @IsString()
  @IsOptional()
  COOKIE_DOMAIN?: string;

  @IsString()
  @IsOptional()
  PORT?: string;
}

const MOCK_DEFAULT_SECRETS = new Set([
  'change-me-jwt',
  'change-me-refresh',
  'change-me',
  'secret',
  'changeme',
]);

function failIfMockSecret(name: string, value: string) {
  if (MOCK_DEFAULT_SECRETS.has(value) || value.length < 24) {
    throw new Error(
      `${name} must be a strong (24+ char) secret in production`,
    );
  }
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const missing = errors.map((e) => e.property).join(', ');
    throw new Error(`Missing required env vars: ${missing}`);
  }

  // Cross-field requirements: provider implies secret keys
  if (validated.AI_PROVIDER !== 'mock' && !validated.OPENAI_API_KEY) {
    throw new Error(`AI_PROVIDER=${validated.AI_PROVIDER} requires OPENAI_API_KEY`);
  }
  if (validated.BILLING_PROVIDER === 'alipay') {
    const missing = [
      'ALIPAY_APP_ID',
      'ALIPAY_PRIVATE_KEY',
      'ALIPAY_PUBLIC_KEY',
      'ALIPAY_GATEWAY',
      'ALIPAY_NOTIFY_URL',
    ].filter((k) => !validated[k as keyof EnvVars]);
    if (missing.length > 0) {
      throw new Error(
        `BILLING_PROVIDER=alipay requires: ${missing.join(', ')}`,
      );
    }
  }
  if (validated.EMAIL_PROVIDER === 'resend') {
    const missing = ['RESEND_API_KEY', 'EMAIL_FROM'].filter(
      (k) => !validated[k as keyof EnvVars],
    );
    if (missing.length > 0) {
      throw new Error(
        `EMAIL_PROVIDER=resend requires: ${missing.join(', ')}`,
      );
    }
  }

  // Production hardening — refuse to start with development defaults
  if (validated.NODE_ENV === 'production') {
    failIfMockSecret('JWT_SECRET', validated.JWT_SECRET);
    failIfMockSecret('REFRESH_SECRET', validated.REFRESH_SECRET);
    if (validated.JWT_SECRET === validated.REFRESH_SECRET) {
      throw new Error('JWT_SECRET and REFRESH_SECRET must differ in production');
    }
    if (
      validated.MINIO_ACCESS_KEY === 'minio' ||
      validated.MINIO_SECRET_KEY === 'minio123456'
    ) {
      throw new Error(
        'MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be changed from defaults in production',
      );
    }
    if (validated.MINIO_ENDPOINT === 'localhost') {
      throw new Error('MINIO_ENDPOINT must be set explicitly in production');
    }
    if (!validated.CORS_ORIGIN) {
      throw new Error('CORS_ORIGIN must be set in production');
    }
    if (!validated.REDIS_URL) {
      throw new Error('REDIS_URL must be set in production');
    }
    if (validated.AI_PROVIDER === 'mock') {
      throw new Error(
        'AI_PROVIDER=mock is not allowed in production; set AI_PROVIDER=openai with OPENAI_API_KEY',
      );
    }
    if (validated.BILLING_PROVIDER === 'mock') {
      throw new Error(
        'BILLING_PROVIDER=mock is not allowed in production; configure a real provider (e.g. alipay)',
      );
    }
    if (validated.EMAIL_PROVIDER === 'mock') {
      throw new Error(
        'EMAIL_PROVIDER=mock is not allowed in production; configure a real provider (e.g. resend)',
      );
    }
  }
  return validated;
}
