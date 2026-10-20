# रसोई प्लानर — Sultana & Daughter's Kitchen

A phone app for planning one recipe video end to end: what to film, **what to say**,
and exactly what to paste into YouTube when uploading.

Everything a person types stays in their own browser (`localStorage`). No accounts,
no server, no data leaves the phone.

## Why it exists

The channel's own numbers, 15 Sep – 19 Oct 2026:

- 17–22 second videos were watched to **71–83%** and got the most views; longer ones got far fewer.
- 2,556 views produced **zero net subscribers** — watching was never the problem.
- 8 of 9 uploads in that window went up with no language set and some with no tags at all.

So the app does three things the channel needs: keeps videos short, puts a **spoken script**
in her hand, and makes correct metadata a copy-paste rather than something to remember.

## The five steps

| Step | What it does |
|---|---|
| 1 जानकारी | Dish, what's different, ingredients, steps |
| 2 बोलना | Hindi narration script with cue times, and how long the video should be |
| 3 शूट | Filming checklist (open on the finished dish, talk throughout, loop the ending) |
| 4 अपलोड | Title, description, tags — one tap each — plus the upload settings checklist |
| 5 नतीजा | The two numbers to check after 48 hours, and what they mean |

The title, description and tag rules mirror `src/metadata_gen.py`; the narration mirrors
`src/narration.py`. What she gets here matches what the channel tooling produces.

## Deploy

```bash
gh auth login
gh repo create sultana-rasoi-planner --public --source=. --push
gh api -X POST repos/{owner}/sultana-rasoi-planner/pages \
  -f "source[branch]=main" -f "source[path]=/"
```

If the last command errors, enable it by hand: **Settings → Pages → Branch: main / root**.
The site appears at `https://<your-username>.github.io/sultana-rasoi-planner/` within a minute or two.

The repo must be **public** for Pages on a free account. Nothing sensitive is in here —
no keys, no tokens, no analytics data.

## Installing it on her phone

1. Open the link in Chrome (Android) or Safari (iPhone).
2. Menu → **Add to Home Screen**.
3. It then opens full screen with its own icon, and works with no signal.

## Updating it

Edit, then bump `CACHE` in `sw.js` (`rasoi-planner-v1` → `-v2`) so phones fetch the new
files instead of the cached ones, and push. Her copy updates on next open.

```bash
git add -A && git commit -m "..." && git push
```
