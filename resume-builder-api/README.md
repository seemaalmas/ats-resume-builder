# resume-builder-api

NestJS API for the Resume Builder SaaS.

## Local Development
1. Install dependencies
2. Set environment variables from `.env.example`
3. Generate Prisma client
4. Run migrations
5. Start API

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

API runs at:
```
http://localhost:3000
```

## Production
```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
node dist/main.js
```

## Environment Variables
- `PORT` (default: 3000)
- `NODE_ENV`
- `CORS_ORIGIN` (default: http://localhost:3000)
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `JWT_REFRESH_SECRET`
- `JWT_REFRESH_EXPIRES_IN`
- `AI_SERVICE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STUDENT`
- `STRIPE_PRICE_PRO`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`
- `ADMIN_EMAILS` (comma-separated)
- `ADMIN_USER_IDS` (comma-separated)
- `ADMIN_MOBILES` (comma-separated normalized mobile numbers for admin access)
- `SMS_GATEWAY_URL` (URL where the SMS gateway listens, defaults to http://localhost:7071)
- `RESUME_CREATION_RATE_LIMIT_DEFAULT` (default fallback if DB setting is missing)
- `FORCE_DISABLE_RATE_LIMIT` (`true` hard-disables resume create rate limiting)

## Commands
- `npm run start:dev`
- `npm run build`
- `npm test`
- `npm run prisma:generate`
- `npm run prisma:migrate`

## Database URL Format
- Use `postgresql://` or `postgres://` for `DATABASE_URL`.
- Do not use `prisma://` unless Prisma Accelerate/Data Proxy is intentionally configured.
- Local example:
  - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/resume_builder?schema=public`

## Endpoints
- `GET /health`
- `GET /health/db`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout` (JWT)
- `POST /ai/parse-jd` (JWT)
- `POST /ai/critique` (JWT)
- `POST /ai/skill-gap` (JWT)
- `POST /billing/checkout` (JWT)
- `POST /billing/portal` (JWT)
- `POST /billing/webhook` (Stripe)
- `GET /companies/suggest`
- `GET /meta/suggest/institutions?q=<query>&limit=10`
- `GET /meta/suggest/skills?q=<query>&type=technical|soft&limit=10`
- `GET /meta/suggest/certifications?q=<query>&limit=10`
- `GET /resumes` (JWT)
- `POST /resumes` (JWT)
- `GET /resumes/:id` (JWT)
- `PATCH /resumes/:id` (JWT)
- `DELETE /resumes/:id` (JWT)
- `POST /resumes/:id/ats-score` (JWT)
- `GET /resumes/:id/pdf` (JWT)
- `GET /admin/settings` (JWT + Admin)
- `PUT /admin/settings/rate-limit` (JWT + Admin)
- `PATCH /admin/settings` (JWT + Admin)

## Test Notes
- Backend tests are deterministic and run via:
  - `npm test`

## Free Plan Quotas
- Free plan supports up to `2` resumes.
- Free plan supports up to `2` ATS scans.

## Rollout Plan: Resume Creation Rate Limit
1. Keep rate limiting disabled in pre-launch/testing:
   - set `FORCE_DISABLE_RATE_LIMIT=true` or keep `RESUME_CREATION_RATE_LIMIT_DEFAULT=false`.
2. Enable later from admin UI/API:
   - `PUT /admin/settings/rate-limit` with `{ "enabled": true }`.
3. Emergency kill switch in production:
   - set `FORCE_DISABLE_RATE_LIMIT=true` and restart API.

# SMS Gateway

- The project ships with a lightweight [sms-gateway](../sms-gateway) microservice that proxies to a local GSM modem via the `gammu` CLI.
- In production, `/auth/request-otp` (added in this iteration) will call `SMS_GATEWAY_URL` to deliver the OTP; set the URL in `.env`.
- Run the gateway with `npm install` + `npm start` inside the `sms-gateway` folder before requesting OTPs in production.
