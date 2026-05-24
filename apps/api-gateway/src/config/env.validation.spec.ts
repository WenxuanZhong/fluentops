import { validate } from './env.validation';

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    DATABASE_URL: 'postgresql://fluentops:fluentops@localhost:5432/fluentops',
    JWT_SECRET: 'development-jwt-secret',
    REFRESH_SECRET: 'development-refresh-secret',
    ...overrides,
  };
}

describe('env validation', () => {
  it('accepts the development mock provider defaults', () => {
    expect(() => validate(baseConfig())).not.toThrow();
  });

  it('rejects unsupported provider names before startup', () => {
    expect(() => validate(baseConfig({ AI_PROVIDER: 'anthropic' }))).toThrow(
      /AI_PROVIDER/,
    );
    expect(() => validate(baseConfig({ BILLING_PROVIDER: 'stripe' }))).toThrow(
      /BILLING_PROVIDER/,
    );
    expect(() => validate(baseConfig({ EMAIL_PROVIDER: 'smtp' }))).toThrow(
      /EMAIL_PROVIDER/,
    );
  });

  it('requires real production providers and https CORS origin', () => {
    expect(() =>
      validate(
        baseConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-production-jwt-secret-with-length',
          REFRESH_SECRET: 'a-production-refresh-secret-with-length',
          MINIO_ACCESS_KEY: 'fluentops-prod',
          MINIO_SECRET_KEY: 'fluentops-prod-secret',
          MINIO_ENDPOINT: 'minio',
          MINIO_PUBLIC_URL: 'https://app.example.com/objects',
          REDIS_URL: 'redis://:secret@redis:6379',
          CORS_ORIGIN: 'http://app.example.com',
          AI_PROVIDER: 'openai',
          OPENAI_API_KEY: 'openai-test-key',
          BILLING_PROVIDER: 'alipay',
          ALIPAY_APP_ID: 'app-id',
          ALIPAY_PRIVATE_KEY: 'private-key',
          ALIPAY_PUBLIC_KEY: 'public-key',
          ALIPAY_GATEWAY: 'https://openapi.alipay.com/gateway.do',
          ALIPAY_NOTIFY_URL: 'https://app.example.com/api/v1/billing/alipay/notify',
          EMAIL_PROVIDER: 'resend',
          EMAIL_FROM: 'noreply@example.com',
          RESEND_API_KEY: 'resend-test-key',
        }),
      ),
    ).toThrow(/https/);
  });

  it('rejects non-https production callback and object URLs', () => {
    const productionConfig = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a-production-jwt-secret-with-length',
      REFRESH_SECRET: 'a-production-refresh-secret-with-length',
      MINIO_ACCESS_KEY: 'fluentops-prod',
      MINIO_SECRET_KEY: 'fluentops-prod-secret',
      MINIO_ENDPOINT: 'minio',
      MINIO_PUBLIC_URL: 'https://app.example.com/objects',
      REDIS_URL: 'redis://:secret@redis:6379',
      CORS_ORIGIN: 'https://app.example.com',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'openai-test-key',
      BILLING_PROVIDER: 'alipay',
      ALIPAY_APP_ID: 'app-id',
      ALIPAY_PRIVATE_KEY: 'private-key',
      ALIPAY_PUBLIC_KEY: 'public-key',
      ALIPAY_GATEWAY: 'https://openapi.alipay.com/gateway.do',
      ALIPAY_NOTIFY_URL: 'https://app.example.com/api/v1/billing/alipay/notify',
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'noreply@example.com',
      RESEND_API_KEY: 'resend-test-key',
    };

    expect(() =>
      validate(
        baseConfig({
          ...productionConfig,
          MINIO_PUBLIC_URL: 'http://objects.example.com',
        }),
      ),
    ).toThrow(/MINIO_PUBLIC_URL/);

    expect(() =>
      validate(
        baseConfig({
          ...productionConfig,
          MINIO_PUBLIC_URL: undefined,
        }),
      ),
    ).toThrow(/MINIO_PUBLIC_URL/);

    expect(() =>
      validate(
        baseConfig({
          ...productionConfig,
          ALIPAY_NOTIFY_URL: 'http://app.example.com/api/v1/billing/alipay/notify',
        }),
      ),
    ).toThrow(/ALIPAY_NOTIFY_URL/);

    expect(() =>
      validate(
        baseConfig({
          ...productionConfig,
          ALIPAY_NOTIFY_URL: 'https://app.example.com/api/v1/billing/notify',
        }),
      ),
    ).toThrow(/ALIPAY_NOTIFY_URL/);
  });
});
