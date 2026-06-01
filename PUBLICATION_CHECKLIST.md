# Public Publication Checklist

Complete this checklist before changing the GitHub repository visibility to public.

## Secrets And Credentials

- [ ] Supabase service role key rotated.
- [ ] Supabase anon key and project URL fallbacks removed from committed files.
- [ ] E2E secret rotated.
- [ ] Test user password rotated or test users deleted.
- [ ] Google OAuth client secret rotated if it was ever committed or shared.
- [ ] Vercel, KV, Web Push, and cron secrets rotated if present.
- [ ] Local `.env` and `.env.*` files are ignored and not tracked.
- [ ] `.env.test` removed from the working tree commit and from git history.
- [ ] Local tool settings that contain API keys are untracked or sanitized.

## Repository Hygiene

- [ ] Secret scan is clean on the working tree.
- [ ] Secret scan is clean after history rewrite.
- [ ] CI is green without repository secrets.
- [ ] README, LICENSE, SECURITY, and CONTRIBUTING are present.
- [ ] Public issue and PR templates are present.
- [ ] Open PRs and protected branches are reviewed before history rewrite.
- [ ] A backup clone exists before any force push.

## History Rewrite

- [ ] `git filter-repo` plan reviewed by a human.
- [ ] Rewritten history verified locally.
- [ ] Force push or mirror push approved by a human.

## OpenAI Codex For OSS

- [ ] GitHub repository URL ready.
- [ ] GitHub username ready.
- [ ] Maintainer role description ready.
- [ ] OpenAI organization ID ready for human entry.
- [ ] 500-character qualification statement ready.
- [ ] 500-character API credits usage statement ready.
