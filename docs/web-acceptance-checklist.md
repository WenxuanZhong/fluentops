# Web Acceptance Checklist

This checklist is for manual product validation of the full web flow.

Use it after local setup is stable and before demos, release candidates, or major frontend merges.

## 1. Preconditions

### 1.1 Tooling

- Node 20.x 或任意更新的 LTS（项目契约 `engines.node` 已放宽为 `>=20`）
- pnpm 9.15.4
- `pnpm doctor:env` passes except for any explicitly accepted local warnings

### 1.2 Local services

- Run `pnpm infra:start`
- Run `pnpm --filter api-gateway prisma migrate dev`
- Run `pnpm dev`

### 1.3 URLs

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Health: `http://localhost:3000/health`

### 1.4 Recommended local provider mode

Use these defaults unless the checklist item explicitly says otherwise:

- `AI_PROVIDER=mock`
- `BILLING_PROVIDER=mock`
- `EMAIL_PROVIDER=mock`

That gives the safest local acceptance path with the fewest external dependencies.

## 2. Startup Sanity Check

### 2.1 Health endpoint

- Open `/health`
- Expect HTTP 200
- Expect `status: ok`
- Expect `db: up`
- Expect `redis` to be `up`, `down`, or `disabled` depending on your local setup

### 2.2 Frontend boot

- Open the home page
- Expect the page to render without console crashes
- Expect the hero section, navigation, and call-to-action links to appear
- Expect language toggle to work

## 3. Home And Auth Flow

### 3.1 Home page

- Visit `/`
- Expect the public landing page layout
- Expect links to login and register
- Expect mobile navigation and desktop layout both to remain usable

### 3.2 Register

- Visit `/register`
- Create a fresh account
- Expect success feedback
- Expect you can move on to login

### 3.3 Login

- Visit `/login`
- Login with the new account
- Expect redirect to `/dashboard`
- Expect authenticated layout shell to appear

### 3.4 Route protection

- Open `/dashboard`, `/speaking`, `/coach`, `/billing` while authenticated
- Expect all four pages to load
- Logout
- Re-open one protected route
- Expect redirect back to `/login`

## 4. Dashboard

### 4.1 Initial authenticated state

- After login, land on `/dashboard`
- Expect the current user email to render
- Expect balance, recordings, and assessments cards to render
- Expect empty-state behavior to be understandable for a new user

### 4.2 Navigation shell

- Switch between dashboard, speaking, coach, and billing
- Expect sidebar state and active navigation highlighting to update correctly
- On mobile, expect the menu to open and close cleanly

## 5. Speaking Flow

### 5.1 Microphone permission

- Visit `/speaking`
- Start recording
- If permission is denied, expect an understandable error message
- If permission is granted, expect the state to change to recording

### 5.2 Record, pause, resume, stop

- Start recording
- Pause
- Resume
- Stop
- Expect the state indicator to track the flow correctly

### 5.3 Upload and list refresh

- After stopping, wait for upload completion
- Expect success feedback
- Expect the new recording to appear in the recordings list
- Expect file metadata to render

### 5.4 Playback

- Open a recording from the list
- Expect an audio player with a playable `playUrl`

## 6. Billing Flow

### 6.1 Mock-mode path

Precondition:
- `BILLING_PROVIDER=mock`

Steps:
- Visit `/billing`
- Expect plans and current balance to render
- Create an order
- Complete mock pay
- Expect the displayed balance to increase

### 6.2 Real provider path

Precondition:
- Real provider credentials configured

Steps:
- Create an order
- Verify the returned payment flow is reachable
- Verify order state updates after the external callback

Note:
- This path is not part of the default local acceptance pass.

## 7. AI Coach Flow

### 7.1 Credits gate

- Visit `/coach`
- If credits are `0`, expect the submit action to be disabled or the buy-credits path to be visible
- After buying credits in mock mode, return to `/coach`

### 7.2 Text assessment

- Submit a text assessment
- Expect progress UI to appear
- Expect the result panel to eventually render
- Expect rubric, issues, rewrites, drills, and feedback to be populated in mock mode

### 7.3 History

- Refresh the history list
- Expect the recent assessment to appear
- Open the assessment again from history
- Expect the detail view to match the completed result

### 7.4 Realtime

- During submission, expect either WebSocket progress or SSE fallback to keep the progress area moving
- If realtime fails, expect the flow to fail clearly rather than silently hanging

## 8. Notifications And Poster

### 8.1 Email summary

Precondition:
- A successful assessment exists

Steps:
- Click the email summary action
- In `mock` mode, expect success feedback and a server log entry
- In `resend` mode, expect the provider call to succeed

### 8.2 Poster download

- Download the assessment poster
- Expect a file to be generated locally
- Expect long feedback not to break the export completely

## 9. Failure-State Checks

Run at least one targeted failure test before calling the pass complete.

### 9.1 API unavailable

- Stop the API
- Refresh a protected page
- Expect visible failure behavior rather than a silent blank screen

### 9.2 No Redis

- Run without `REDIS_URL` or with Redis unavailable
- Expect the API to remain usable
- Expect health or logs to make the degraded state understandable

### 9.3 No MinIO

- Run without reachable MinIO
- Expect recording features to fail clearly
- Expect non-media pages to remain usable

## 10. Sign-Off Criteria

Call the web pass complete only if all of the following are true:

- Public pages render
- Auth flow works
- Protected routes work
- Recording upload works in the chosen local mode
- Billing works in the chosen provider mode
- AI assessment works in the chosen provider mode
- Email and poster actions are at least validated in the intended mode
- One explicit failure-path check has been exercised
