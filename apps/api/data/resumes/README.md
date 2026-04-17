# Local Resume Files (Gitignored)

This folder is for local-only resume files used by resume selection and generation grounding.

Expected filenames (one per resume type):

- `swe_resume.txt` or `swe_resume.pdf`
- `sie_resume.txt` or `sie_resume.pdf`
- `early_career_resume.txt` or `early_career_resume.pdf`

Notes:

- These files are local-only and are ignored by git.
- If both `.txt` and `.pdf` exist for a resume type, the app prefers `.txt`.
- Do not commit personal resume content to a public repository.
