# Job Application Helper MVP

Conservative job triage + application-prep copilot for software engineering roles.

## Stack

- API: Express + TypeScript + MongoDB + Zod
- Web: React + Vite + TypeScript

## Run

1. Install dependencies:
   - `npm install --workspace api`
   - `npm install --workspace web`
2. Copy `.env.example` to **`.env` in the repository root** (not under `apps/api`) and set values. The API and web dev server both read that file.
3. Start API: `npm run dev --workspace api`
4. Start web: `npm run dev --workspace web`

## Key API routes

- `POST /api/jobs/triage`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `PATCH /api/jobs/:id/status`
- `POST /api/jobs/:id/generate-assets`
- `POST /api/jobs/:id/rescore`
- `POST /api/jobs/:id/export`

## Testing

- `npm run test --workspace api`
