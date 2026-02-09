# resume-builder-ai

AI orchestration service (JD parsing, resume scoring, critiques, skill gap analysis).

## Setup
1. Install dependencies
2. Copy `.env.example` to `.env.local`

## Environment
- `PORT` (default: 7001)
- `LLM_PROVIDER` (default: mock)
- `LLM_API_KEY` (optional)

## Commands
- `npm run dev`
- `npm run start`
- `npm run build`

## Endpoints
- `POST /ai/parse-jd`
- `POST /ai/score-resume`
- `POST /ai/critique`
- `POST /ai/skill-gap`
- `GET /health`
