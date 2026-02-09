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
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

API runs at:
```
http://localhost:3000
```

## Production
```bash
npm ci
npm run prisma:generate
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

## Commands
- `npm run start:dev`
- `npm run build`
- `npm run prisma:generate`
- `npm run prisma:migrate`

## Endpoints
- `GET /health`
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
- `GET /resumes` (JWT)
- `POST /resumes` (JWT)
- `GET /resumes/:id` (JWT)
- `PATCH /resumes/:id` (JWT)
- `DELETE /resumes/:id` (JWT)
- `POST /resumes/:id/ats-score` (JWT)
- `GET /resumes/:id/pdf` (JWT)
