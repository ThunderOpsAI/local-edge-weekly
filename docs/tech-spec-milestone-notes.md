# Tech Spec Milestone Notes

Branch: `codex/intel-fusion-engine`

## Milestone 1/2: Pressure Scores And Reddit Signals

- Commit: `10c5093 Add pressure scoring and reddit signal pass`
- Pushed to GitHub: yes
- Note: Python smoke tests could not run because `python` resolves to `C:\Users\james\AppData\Local\Microsoft\WindowsApps\python.exe`, the Windows Store alias, and no real Python interpreter was found on PATH.

## Milestone 3/4/5/6/7/8: Decision Packs, Report UI, Snapshot Metadata, Demo Seeding

- Commit: `d3743dd Add decision packs to reports`
- Pushed to GitHub: yes
- TypeScript verification: `npx.cmd tsc --noEmit` passed.
- Note: `npm.cmd run build` hung twice without useful output, once at 2 minutes and once at 5 minutes. The build-spawned Node processes were stopped after each timeout.
- Note: Screenshot comparison is wired as decision-pack snapshot metadata and renders only for website-delta candidates. Real Playwright screenshot capture and Supabase Storage image upload should be debugged in the final e2e pass because the repo currently does not have a local Playwright install or browser capture worker.
