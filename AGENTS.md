# Project instructions

## Floorplan skill (installed)

Floorplan is installed in this project at `.agents/skills/floorplan/` — an interactive, plain-English
map of this codebase, generated and served locally. Read `.agents/skills/floorplan/SKILL.md` before
using it; that file is the full instruction set.

Use it when the user wants to visualize, map, diagram or document this app or repo, understand how
the frontend talks to the backend, onboard onto unfamiliar code, see what a change touched, or
update an existing map — even if they don't say "floorplan". There is no `$floorplan` / `/floorplan`
command in this client: if the user asks for a floorplan, open the skill and follow it.

Replace `${CLAUDE_SKILL_DIR}` from SKILL.md with `.agents/skills/floorplan` and run the scripts from
this project root, for example:

```
node .agents/skills/floorplan/scripts/status.mjs .
node .agents/skills/floorplan/scripts/scan.mjs .
node .agents/skills/floorplan/scripts/build.mjs .
node .agents/skills/floorplan/scripts/describe.mjs .
node .agents/skills/floorplan/scripts/recent.mjs .
node .agents/skills/floorplan/scripts/open.mjs . --no-open
```

Notes for this environment:

- Ask bar: the map's server answers questions through the `codex` or `claude` CLI, and neither is
  installed on this machine, so the Ask bar will explain what it needs. Answer architecture questions
  in chat instead, using `floorplan/query.mjs` and reading the source.
- Show the map with `register_preview` (run `open.mjs <root> --no-open` and register the printed
  `http://127.0.0.1:4378` URL with the server's PID) rather than `open.mjs` opening a browser.
- `floorplan/` is generated output and ignores itself in git; never hand-edit `graph.json`,
  `index.html` or `describe.mjs` worksheets. `architecture.json`, `descriptions/`, `recent-work.json`
  and `custom-flows.json` are user content — keep them on refresh.

Update the skill by replacing `.agents/skills/floorplan/` from
https://github.com/haydenschmitty/floorplan (installed from commit `cec10754`, v0.6.0).
