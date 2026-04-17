# Job Application Helper

Production-minded job triage and application-prep assistant for software engineering roles.

This project helps you evaluate postings, decide whether to apply, choose a resume strategy, and generate practical application assets while keeping hard rules and realism constraints explicit.

## A. Project Overview

The app ingests job posts from URL or pasted text, extracts structured data, scores fit conservatively, recommends whether to apply, suggests a resume type, and supports on-demand generation of application materials.

It is designed as an operator assistant, not an autonomous applier.

## B. Features

- Structured job extraction from pasted text/URL inputs
- Conservative fit scoring with explicit rule penalties
- Recommendation bands: `yes`, `selective_yes`, `no`
- Resume recommendation (`SWE`, `SIE`, `EARLY_CAREER`)
- On-demand generation for:
  - cover letter
  - why company
  - talking points
  - bullet candidates
- Tracker workflow with explicit "confirm applied" flow
- Tracker import support from spreadsheet (`xlsx`) via scripts
- Optional local resume context grounding from files on your machine

## C. Repo Structure (High-Level)

- `apps/api/` - Express API, scoring/rules/orchestration, import/verify scripts
- `apps/web/` - React + Vite frontend
- `scripts/` - root helper scripts (eval/regression utilities)
- `.env.example` - safe template for local environment config

## D. Setup Instructions

1. Install dependencies:
   - `npm install`
2. Create your local env file from the template:
   - `cp .env.example .env`
3. Fill in local values in `.env` (Mongo + OpenAI keys/config).
4. Start the API:
   - `npm run dev --workspace api`
5. Start the web app in a second terminal:
   - `npm run dev --workspace web`

## E. Environment Variables

The app reads environment configuration from the repository-root `.env`.

Required keys (see `.env.example`):

- `PORT`
- `MONGO_URI`
- `MONGO_DB_NAME`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Optional:

- `RESUME_CONTEXT_DIR` (override local resume folder path)
- `VITE_API_BASE_URL` (web -> API base URL)

## F. Running API + Web

- API dev server: `npm run dev --workspace api`
- Web dev server: `npm run dev --workspace web`
- Build all: `npm run build`
- API tests: `npm run test --workspace api`

## G. Mongo Setup

1. Run a local MongoDB instance (or provide a remote URI in `MONGO_URI`).
2. Set `MONGO_DB_NAME` in `.env`.
3. Start the API and verify it connects successfully in logs.

Default local URI in `.env.example`:

- `mongodb://127.0.0.1:27017/job_agent_mvp`

## H. Resume Context Setup (Local-Only, Gitignored)

Optional local resume context lives at:

- `apps/api/data/resumes/`

Expected filenames:

- `swe_resume.txt` or `swe_resume.pdf`
- `sie_resume.txt` or `sie_resume.pdf`
- `early_career_resume.txt` or `early_career_resume.pdf`

Notes:

- Resume files are local-only and gitignored.
- If both `.txt` and `.pdf` exist for a resume type, `.txt` is preferred.
- You can override the default folder with `RESUME_CONTEXT_DIR`.

## I. Tracker Import / Verify Scripts

From `apps/api`:

- Import tracker spreadsheet:
  - `npm run import:tracker --workspace api`
- Verify tracker reseed behavior:
  - `npm run verify:tracker --workspace api`

Root-level helper scripts:

- `npm run eval:seed`
- `npm run eval:run`

## J. Important Privacy Note

Before publishing this project publicly:

- Do not commit `.env` or secrets.
- Do not commit personal resume files.
- Do not commit personal/local tracker artifacts.
- Always commit only `.env.example` (never real keys).

This repository is configured so local resume files and common secret/local artifact paths are ignored by git. You are still responsible for reviewing staged files before pushing.
