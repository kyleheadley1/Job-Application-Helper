# Job Application Helper

Production-minded job triage and application-prep assistant for software engineering roles.

This project helps you evaluate postings, decide whether to apply, choose a resume strategy, generate practical application assets, and track what happened after you applied, while keeping hard rules and realism constraints explicit.

## A. Project Overview

The app ingests job posts (pasted text, URL, or a one-click capture from the Chrome extension), extracts structured data, scores fit conservatively, recommends whether to apply, suggests a resume, and supports on-demand generation of application materials.

A Gmail dashboard reads your application emails (read-only), groups them into applications with their current status, recovers the original job description for each one, and scores it blind to the outcome so you can see whether the fit score predicts real results.

It is designed as an operator assistant, not an autonomous applier.

## B. Features

**Triage and prep**

- Structured job extraction from pasted text/URL inputs
- Conservative fit scoring: capability ± survivability adjustment − gap dock, with explicit hard gates and rule penalties
- Recommendation bands: `apply_cold`, `referral_gated`, `stretch_signal`, `skip`, `no` (hard gate)
- Resume recommendation between your two resume variants: `BASE` (general) and `AI` (specialized). See section H. Older records may show legacy `SWE`/`SIE`/`EARLY_CAREER`
- On-demand generation of cover letter, why-company, talking points, and bullet candidates
- Tracker workflow with an explicit "confirm applied" flow, editable applied date, and notes
- Tracker import from a spreadsheet (`xlsx`)
- Top Jobs discovery (optional): daily JSearch pull, auto-triaged and filtered by score
- Local resume context grounding from files on your machine

**Chrome extension (capture)**

- Side panel that captures the JD from the current page and scores it with your local API
- Capture methods, best first: your text selection, JSON-LD `JobPosting` data, known JD containers on common boards, or paste
- Duplicate captures of the same URL are reused. "Re-score" forces a fresh score
- Recent captures list with a link to the full assessment in the web app

**Gmail dashboard (`/`)**

- Google OAuth with the `gmail.readonly` scope. Full email bodies are never stored, only a per-message classification
- Free rule-based prefilter, then an LLM classifier: applied, assessment, interview, rejected, offer, other. Calendar invites from company domains count as interviews
- Groups emails into applications by company and role, tracks status and the furthest stage reached (e.g. "rejected after interviewing"), and flags estimated applied dates when no confirmation email exists
- Matches applications to tracker rows and suggests status updates (e.g. "Update to Rejected")
- 7- or 30-day window. Syncing again only processes new mail

**JD recovery and blind scoring**

For each application, the app tries to find the original posting, verifies it is the same job, and only then scores it. The scorer sees only the JD text and a company hint, never the emails or the outcome. Steps, cheapest first, stopping at the first verified match:

1. The email itself: an inline JD, or posting links (Greenhouse, Lever, Ashby, Workday, LinkedIn guest pages, JSON-LD)
2. Company job boards named in the emails (sender domains, Workday tenant links, Greenhouse embeds)
3. Guessed board slugs on the free public APIs: Greenhouse, Lever, Ashby, SmartRecruiters, Workable (cached per company)
4. Serper web search, only when no company board was found, within a lifetime query budget

Verification rules:

- Requisition ID match, or exactly one open job on the company's own board with a near-identical title (strict title similarity, level markers like I/II kept)
- Ties are broken by the title or city named in the email. Identical postings repeated per location are merged
- Anything weaker is kept as a candidate for you to pick, or you can paste the JD yourself

Scores are final: a scored row is never re-scored by later syncs, recovery runs, or a change in the application's key. Each new score stores its category breakdown (shown on hover).

**Dashboard metrics**

- Fit score vs outcome (mean fit per outcome, plus applications that reached an interview)
- Where the JDs came from: verified and candidate counts per source (email, company boards, Serper, pasted), with Serper usefulness and budget
- OpenAI cost: today, last 7 days, per scored role, per email, and by feature, estimated from OpenAI-reported token counts
- A low-budget warning when 20% or less of the Serper budget is left

## C. Repo Structure (High-Level)

- `apps/api/` - Express API, scoring/rules/orchestration, Gmail sync and JD recovery, import/verify scripts
  - `src/services/gmail/` - OAuth, sync, prefilter/classifier, application grouping
  - `src/services/gmail/jdRecovery/` - email evidence, ATS board APIs, posting fetchers, matching, Serper, metrics
  - `src/services/llm/` - OpenAI Responses client and usage/cost tracking
- `apps/web/` - React + Vite frontend (Dashboard, Add Job, Top Jobs, Tracker)
- `apps/extension/` - Chrome MV3 side-panel extension (React + Vite)
- `scripts/` - root helper scripts (eval/regression utilities)
- `.env.example` - safe template for local environment config

## D. Setup Instructions

1. Install dependencies:
   - `npm install`
2. Create your local env file from the template:
   - `cp .env.example .env`
3. Fill in local values in `.env` (Mongo + OpenAI at minimum; see section E).
4. Start the API:
   - `npm run dev` (same as `npm run dev --workspace api`)
5. Start the web app in a second terminal:
   - `npm run dev:web`
6. Optional: set up the Chrome extension (section J) and the Gmail dashboard (section K).

## E. Environment Variables

The app reads environment configuration from the repository-root `.env`. See `.env.example` for every key with comments.

Required:

- `PORT`, `MONGO_URI`, `MONGO_DB_NAME`
- `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5-mini`)

Optional, by feature:

- **Triage / resumes:** `RESUME_CONTEXT_DIR`, `PRELOAD_RESUME_CONTEXT_ON_START`, `TRIAGE_FAST_MODE`, `TRIAGE_SKIP_LLM_RESUME_SELECTION_IN_FAST_MODE`
- **Tracker seed:** `AUTO_IMPORT_TRACKER_ON_START`, `TRACKER_SEED_WORKBOOK_PATH`
- **Web:** `VITE_API_BASE_URL` (web -> API base URL)
- **Top Jobs:** `RAPIDAPI_KEY`, `TOP_JOBS_SYNC_ENABLED`, `TOP_JOBS_*`, `JSEARCH_*`
- **Extension:** `EXTENSION_API_TOKEN` (shared secret, also pasted into the extension options)
- **Gmail:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `WEB_APP_URL`, `GMAIL_CLASSIFY_REASONING_EFFORT` (default `minimal`)
- **JD recovery:** `SERPER_API_KEY` (optional fallback), `SERPER_MAX_QUERIES_TOTAL` (default `1250`), `JD_RECOVERY_MAX_PER_RUN` (default `5`)
- **Cost estimate:** `OPENAI_INPUT_PRICE_PER_M`, `OPENAI_CACHED_INPUT_PRICE_PER_M`, `OPENAI_OUTPUT_PRICE_PER_M` (defaults are gpt-5-mini list prices)

## F. Running API + Web + Extension

- API dev server: `npm run dev`
- Web dev server: `npm run dev:web`
- Extension build: `npm run build:extension` (or `npm run dev:extension` to rebuild on change)
- Build API + web: `npm run build`
- API tests: `npm test`

Scripts run with `tsx`. If `npx tsx` is blocked in your environment, use `node --import tsx <file>`.

## G. Mongo Setup

1. Run a local MongoDB instance (or provide a remote URI in `MONGO_URI`).
2. Set `MONGO_DB_NAME` in `.env`.
3. Start the API and verify it connects successfully in logs.

Default local URI in `.env.example`:

- `mongodb://127.0.0.1:27017/job_agent_mvp`

Gmail and recovery collections: `gmail_auth`, `gmail_messages` (classifications only), `application_evaluations` (recovered JD + blind score + outcome), `ats_boards` (board slug cache), `serper_usage`, `llm_usage` (per-call token counts and cost).

## H. Make It Yours: Resumes and Profile

Scoring is only as good as what the app knows about you. There are three pieces to set up.

### 1. Your resume files (local-only, gitignored)

The app works with two resume variants:

- `BASE`: your general resume, used by default.
- `AI`: a specialized variant, used when a posting's core work matches its focus. It's named for applied-AI roles, but it can be any second track you apply to, such as data, mobile, or infrastructure.

Put them in `apps/api/data/resumes/` (or point `RESUME_CONTEXT_DIR` elsewhere) using these filenames:

- `base_resume.txt` or `base_resume.pdf`
- `ai_resume.txt` or `ai_resume.pdf`

You only need one variant to get started. The easiest way to install one is from a PDF, which copies the PDF and extracts the text the loader prefers:

```bash
cd apps/api
node --import tsx scripts/extract-resume-text.mts BASE /path/to/your-base-resume.pdf
node --import tsx scripts/extract-resume-text.mts AI /path/to/your-specialized-resume.pdf
```

If both `.txt` and `.pdf` exist for a variant, `.txt` wins. Restart the API after replacing a resume, because resume contexts are cached in memory.

### 2. Your candidate profile (local-only, gitignored)

The scorer reads your profile from `user_profile.json` in the same resume folder (`apps/api/data/resumes/user_profile.json` by default). It covers:

- headline
- strengths and weaker areas
- degree status and training
- target roles and location preferences
- flagship projects with measurable outcomes
- estimated professional years
- sponsorship, citizenship and clearance status
- home location
- certifications
- hard constraints, such as "do not invent years of experience"

To create it, copy the fictional example in `apps/api/src/config/userProfile.example.ts` into JSON form, then replace every value with your own. The field types are defined in `apps/api/src/types/userProfile.ts`.

If the file is missing, the API logs a warning and scores against the example profile. Tests always use the example profile, so editing your own never changes test results.

Keep claims factual. The scorer uses them to judge requirement overlap and how well your resume would survive a screen, so inflated claims produce inflated scores. Restart the API after editing the profile.

### 3. Resume variant descriptions

`apps/api/src/config/resumeProfiles.ts` tells the selector when each variant fits. Each entry has:

- `bestFor` and `avoidFor`
- `summaryStyle`
- `emphasisKeywords`
- `exampleRationale`

Edit these to describe your own two resumes.

### Keep personal data out of git

`apps/api/data/resumes/*`, the top-level `data/` folder, and all `*.pdf`, `*.docx` and `*.xlsx` files are gitignored. Before you push, run `git status` to confirm nothing personal is staged.

## I. Tracker Import / Verify Scripts

- Import tracker spreadsheet: `npm run import:tracker --workspace api`
- Verify tracker reseed behavior: `npm run verify:tracker --workspace api`
- Re-score tracker roles: `npm run rescore:tracker` / `npm run rescore:tracker-all`
- Pull Top Jobs once: `npm run sync:top-jobs --workspace api`

Startup behavior:

- By default, API boot auto-imports `data/job_role_scores_current.xlsx` if present (idempotent upsert). Disable with `AUTO_IMPORT_TRACKER_ON_START=false` or override the path with `TRACKER_SEED_WORKBOOK_PATH`.
- API startup also preloads local resume context by default to reduce first-triage latency.

Triage speed notes:

- `TRIAGE_FAST_MODE=true` keeps extraction/scoring quality but skips the LLM resume-selection tie-break when deterministic selection is ambiguous.

Root-level helper scripts:

- `npm run eval:seed`
- `npm run eval:run`

## J. Chrome Extension Setup

1. Set `EXTENSION_API_TOKEN` in `.env` to any long random string and restart the API.
2. Build the extension: `npm run build:extension`.
3. In Chrome, open `chrome://extensions`, enable Developer mode, click "Load unpacked", and choose `apps/extension/dist`.
4. Open the extension options and set the API base URL (default `http://localhost:4000/api`), the same token, and the web app URL.
5. On a job posting, click the extension icon to open the side panel and capture. Select the JD text first if auto-detection picks the wrong block.

Captures are scored in the background and appear like an Add Job result: open the full assessment, then confirm applied to add it to the tracker. Capturing at apply time is the most reliable way to get a JD for every application.

## K. Gmail Dashboard + JD Recovery Setup

1. In Google Cloud Console, create an OAuth client of type "Web application" with the redirect URI `http://localhost:4000/api/gmail/oauth/callback`, and enable the Gmail API.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `WEB_APP_URL` in `.env`, then restart the API.
3. Open the web app dashboard (`/`), click Connect Gmail, and approve read-only access.
4. Click "Sync now" (the dashboard also syncs on load if the last sync is over 15 minutes old). Recovery starts automatically after each sync and scores up to `JD_RECOVERY_MAX_PER_RUN` roles per run. "Recover JDs" starts a run by hand.
5. Optional: set `SERPER_API_KEY` to enable the web search fallback. Serper's 2,500 free queries are a one-time grant, so the default budget is half of that.

Working the dashboard:

- **Needs your pick:** choose the right posting from the candidates, or paste the JD.
- **Not found:** the note says why (e.g. "board has no open jobs (posting likely closed)" or the closest title on the board). Paste the JD if you still care about the role.
- Hover the fit score for its breakdown and the JD match badge for every step that was tried.

Suggested routine: sync once a day, clear "Needs your pick" weekly, and read the score-vs-outcome card once there are about 30 outcomes.

## L. Cost Notes

All job-board lookups and the Gmail API are free. Costs are OpenAI calls (and Serper after its free credits):

- Email classification: about 0.03-0.05¢ per email (minimal reasoning effort)
- Scoring a role (extraction + scoring): about 1.25¢
- Typical daily use (5-10 applications): a few dollars a month

The dashboard's OpenAI cost card shows actual spend from recorded token counts.

## M. Important Privacy Note

Before publishing this project publicly:

- Do not commit `.env` or secrets.
- Do not commit personal resume files.
- Do not commit personal/local tracker artifacts.
- Always commit only `.env.example` (never real keys).

Gmail access is read-only. Email bodies are fetched on demand and never stored. Only classifications, subjects/senders, and recovered job descriptions are kept in your local Mongo.

This repository is configured so local resume files and common secret/local artifact paths are ignored by git. You are still responsible for reviewing staged files before pushing.
