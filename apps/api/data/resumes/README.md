# Local Resume Files (Gitignored)

This folder is for local-only resume files used by resume selection, scoring, and generation grounding.

Expected filenames (one per resume type):

- `base_resume.txt` or `base_resume.pdf` (BASE: general full-stack)
- `ai_resume.txt` or `ai_resume.pdf` (AI: AI-heavy)

Install or refresh from a PDF (copies the PDF and extracts the `.txt`):

```
node --import tsx scripts/extract-resume-text.mts BASE ../../data/Candidate_Resume_Base.pdf
node --import tsx scripts/extract-resume-text.mts AI ../../data/Candidate_Resume_AI.pdf
```

Notes:

- These files are local-only and are ignored by git.
- If both `.txt` and `.pdf` exist for a resume type, the app prefers `.txt`.
- Restart the API after replacing a resume; contexts are cached in memory.
- Do not commit personal resume content to a public repository.
