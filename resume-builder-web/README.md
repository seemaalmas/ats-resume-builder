# resume-builder-web

Next.js (App Router) web client for the Resume Builder SaaS.

## Setup
1. Install dependencies
2. Create `.env.local` based on `.env.example`

## Environment
- `NEXT_PUBLIC_API_URL` (default: http://localhost:3000)

## Commands
- `npm run dev`
- `npm run build`
- `npm run start`

## Routes
- `/auth/login`
- `/auth/register`
- `/dashboard`
- `/resume`
- `/billing`

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
