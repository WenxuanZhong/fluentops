# API Verification Guide

This document is the operational counterpart to `docs/api-reference.md`.

- `docs/api-reference.md` shows endpoint-by-endpoint request examples.
- This guide shows which end-to-end flows to run, in what order, and what is already covered by automated verification.

## 1. Recommended Verification Order

### 1.1 Automated

Use the automated suite first.

```bash
# Local default: in-memory Prisma adapter, no Docker required
pnpm verify:api:e2e

# Real PostgreSQL path
pnpm verify:api:e2e:realdb
```

Expected success:

- `Test Suites: 1 passed, 1 total`
- `Tests: 28 passed, 28 total`

### 1.2 Manual smoke after the automated suite

Run the manual path only when you need to validate a live local server or external providers:

1. Start infra with `pnpm infra:start`
2. Start the API with `pnpm dev` or `pnpm --filter api-gateway dev`
3. Use the curl examples in `docs/api-reference.md`
4. Validate flows in this order:
   - `/health`
   - auth
   - media
   - billing
   - AI assess
   - notifications

## 2. Manual Smoke Checklist

### 2.1 Health

- `GET /health`
- Expect `status=ok`
- Expect `db=up`
- Expect `redis` to be `up`, `down`, or `disabled` depending on local setup

### 2.2 Auth

- Register a new user
- Login and capture `accessToken` / `refreshToken`
- Call `/me` with the access token
- Refresh once and verify the refresh token rotates
- Logout and verify the revoked refresh token no longer works

### 2.3 Media

- Presign an upload with `audio/webm`
- Upload a real or dummy file to the returned presigned URL
- Complete the upload
- List recordings
- Fetch recording detail and verify `playUrl` exists

### 2.4 Billing

- List plans
- Confirm balance is readable
- Create an order
- If using `mock`, call `/billing/mock/pay`
- Confirm the balance increases after fulfillment

### 2.5 AI Coach

- Submit a text assessment
- Poll `/ai/assess/:id` until the status becomes `SUCCEEDED`
- Verify `rubricJson` and `feedbackMarkdown`
- Verify the balance decreases by 1 after a successful assessment
- If testing realtime manually, also verify SSE or WebSocket progress delivery

### 2.6 Notifications

- After a successful assessment, call `/notifications/assessment-email`
- In `mock` mode, expect success and check server logs
- In `resend` mode, expect a real provider acceptance response

## 3. Automated Coverage Matrix

The current e2e suite in `apps/api-gateway/test/app.e2e-spec.ts` covers:

### 3.1 Health

- `GET /health`
- Database-up path

### 3.2 Auth

- register
- login
- `/me`
- refresh rotation
- logout
- revoked refresh token rejection

### 3.3 Media

- presign success
- presign invalid content type rejection
- complete upload
- list
- detail
- ownership isolation
- unauthenticated rejection

### 3.4 AI Coach

- create assessment
- poll final result
- list recent assessments
- unauthenticated rejection

### 3.5 Billing

- list plans
- get balance
- create order
- mock pay
- credit increase after purchase
- credit decrease after assessment
- `402` when credits are exhausted

## 4. Provider Boundaries

### 4.1 Safe defaults for local and CI

These are part of the default verification path:

- `AI_PROVIDER=mock`
- `BILLING_PROVIDER=mock`
- `EMAIL_PROVIDER=mock`
- local e2e without Docker-backed DB unless `E2E_USE_REAL_DB=true`

### 4.2 Not covered by the default automated suite

These still require manual validation or dedicated future automation:

- OpenAI-backed AI responses
- Alipay sandbox callbacks
- Resend-backed email delivery
- Live MinIO object IO against a real running MinIO service
- Live Redis cache behavior under a running Redis instance

## 5. When To Use Which Path

- Use `pnpm verify:api:e2e` for the fastest regression signal.
- Use `pnpm verify:api:e2e:realdb` when changing Prisma schema, migrations, or DB-specific behavior.
- Use the manual smoke path when validating real provider credentials, live local infrastructure, or curl examples before a demo or release.
