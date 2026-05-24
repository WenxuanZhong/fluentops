# API Reference

Base URL: `http://localhost:3000/api/v1`

All authenticated endpoints require `Authorization: Bearer <accessToken>`.

---

## Auth

### Register

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

### Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
# Returns: {"accessToken":"...","refreshToken":"..."}
```

### Get Current User

```bash
curl http://localhost:3000/api/v1/me \
  -H "Authorization: Bearer <accessToken>"
```

### Refresh Tokens

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
```

### Logout

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
```

---

## Media (Recording)

All endpoints require Bearer token.

### Presign Upload

```bash
TOKEN="<accessToken>"

curl -X POST http://localhost:3000/api/v1/media/presign \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.webm","contentType":"audio/webm"}'
# Returns: {"uploadUrl":"...","objectKey":"...","fileUrl":"..."}
```

### Upload File to Presigned URL

```bash
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: audio/webm" \
  --data-binary @test.webm
```

### Complete Upload

```bash
curl -X POST http://localhost:3000/api/v1/media/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"objectKey":"<objectKey>","sizeBytes":12345,"mimeType":"audio/webm","durationMs":5000}'
# Returns: {"id":"...","url":"...","createdAt":"..."}
```

### List Recordings

```bash
curl http://localhost:3000/api/v1/media \
  -H "Authorization: Bearer $TOKEN"
```

### Get Recording Detail

```bash
curl http://localhost:3000/api/v1/media/<id> \
  -H "Authorization: Bearer $TOKEN"
```

---

## AI Coach

All endpoints require Bearer token. Each assessment costs 1 credit.

### Start Assessment

```bash
TOKEN="<accessToken>"

curl -X POST http://localhost:3000/api/v1/ai/assess \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputType":"text","text":"I go to school yesterday and buyed a book"}'
# Returns: {"assessmentId":"...","traceId":"...","sseUrl":"/api/v1/ai/assess/.../stream","wsUrl":"/ws/assessments"}
```

### Get Assessment Result

```bash
curl http://localhost:3000/api/v1/ai/assess/<assessmentId> \
  -H "Authorization: Bearer $TOKEN"
```

### SSE Stream

```bash
curl -N http://localhost:3000/api/v1/ai/assess/<assessmentId>/stream \
  -H "Authorization: Bearer $TOKEN"

# Reconnect from seq 3
curl -N "http://localhost:3000/api/v1/ai/assess/<assessmentId>/stream?since=3" \
  -H "Authorization: Bearer $TOKEN"
```

### List Recent Assessments

```bash
curl http://localhost:3000/api/v1/ai/assessments \
  -H "Authorization: Bearer $TOKEN"
```

### WebSocket Stream

Use the same JWT access token in the query string, then subscribe to an assessment ID.

```text
ws://localhost:3000/ws/assessments?token=<accessToken>
```

```json
{"action":"subscribe","assessmentId":"<assessmentId>"}
```

### SSE Event Format

```
event: progress
data: {"stage":"diagnose","pct":5}
id: 0

event: progress
data: {"stage":"diagnose","pct":25}
id: 1

event: final
data: {"rubric":{"grammar":40,...},"issues":[...],"rewrites":[...],"drills":[...],"feedbackMarkdown":"..."}
id: 8

event: error
data: {"message":"..."}
```

---

## Billing

All endpoints require Bearer token except the Alipay notify callback.

### List Plans

```bash
TOKEN="<accessToken>"

curl http://localhost:3000/api/v1/billing/plans \
  -H "Authorization: Bearer $TOKEN"
```

### Check Balance

```bash
curl http://localhost:3000/api/v1/billing/balance \
  -H "Authorization: Bearer $TOKEN"
```

### Create Order

```bash
curl -X POST http://localhost:3000/api/v1/billing/order \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"planId":"<planId>"}'
```

### Mock Pay (dev/CI only)

```bash
curl -X POST http://localhost:3000/api/v1/billing/mock/pay \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"<orderId>"}'
```

---

## Notifications

### Email Assessment Summary

```bash
curl -X POST http://localhost:3000/api/v1/notifications/assessment-email \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assessmentId":"<assessmentId>"}'
```

---

## Environment Variables

### Core

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for access tokens |
| `REFRESH_SECRET` | Secret for refresh tokens |
| `ACCESS_TOKEN_TTL` | Access token TTL (e.g., `15m`) |
| `REFRESH_TOKEN_TTL` | Refresh token TTL (e.g., `7d`) |
| `REDIS_URL` | Optional Redis connection string |

### MinIO

| Variable | Description |
|----------|-------------|
| `MINIO_ENDPOINT` | MinIO host (e.g., `localhost`) |
| `MINIO_PORT` | MinIO API port (e.g., `9000`) |
| `MINIO_ACCESS_KEY` | MinIO access key |
| `MINIO_SECRET_KEY` | MinIO secret key |
| `MINIO_BUCKET` | MinIO bucket name |
| `MINIO_PUBLIC_URL` | Public HTTPS object URL base; with the bundled edge proxy use `/objects`, for example `https://app.example.com/objects` |

### AI Coach

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | — | Set to `mock` for deterministic mock LLM |
| `OPENAI_API_KEY` | — | OpenAI API key (mock used if empty) |
| `MODEL_NAME` | `gpt-4o-mini` | OpenAI model name |
| `AI_TEMPERATURE` | `0.7` | LLM temperature |

### Billing

| Variable | Default | Description |
|----------|---------|-------------|
| `BILLING_PROVIDER` | `mock` | `mock` or `alipay` |
| `ALIPAY_APP_ID` | — | Alipay sandbox app ID |
| `ALIPAY_PRIVATE_KEY` | — | App private key (RSA2) |
| `ALIPAY_PUBLIC_KEY` | — | Alipay public key |
| `ALIPAY_GATEWAY` | sandbox URL | Alipay gateway endpoint |
| `ALIPAY_NOTIFY_URL` | — | Public HTTPS callback URL, ending in `/api/v1/billing/alipay/notify` |

### Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_PROVIDER` | `mock` | `mock` or `resend` |
| `EMAIL_FROM` | — | Sender identity |
| `RESEND_API_KEY` | — | Resend API key |
