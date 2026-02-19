# resume-builder-web

Next.js (App Router) web client for the Resume Builder SaaS.

## Setup
1. Install dependencies
2. Create `.env.local` based on `.env.example`

## Environment
- `NEXT_PUBLIC_API_URL` (default: http://localhost:3000)
- `NEXT_PUBLIC_ADMIN_EMAILS` (comma-separated admin emails for UI visibility)
- `NEXT_PUBLIC_ADMIN_USER_IDS` (comma-separated admin user ids for UI visibility)

## Commands
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm test`

## Test Notes
- Frontend tests run with the Node test runner:
  - `npm test`

## Routes
- `/auth/login`
- `/auth/register`
- `/dashboard`
- `/resume`
- `/billing`
- `/admin/settings` (admin-only UI visibility + backend-enforced access)

## Dev Lock Recovery
If Next.js fails with `Unable to acquire lock at .next/dev/lock`:
1. Stop any running `next dev` process.
2. Delete `.next/dev/lock`.
3. Run `npm run dev` again.

Windows quick fix:
```bat
for /f "tokens=2" %a in ('tasklist ^| findstr node.exe') do taskkill /F /PID %a
if exist .next\dev\lock del /f /q .next\dev\lock
npm run dev
```
