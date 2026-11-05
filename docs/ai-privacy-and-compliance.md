# AI privacy, safety and Australian compliance record

Last reviewed: 1 November 2026. This file records what the code does and which
external policies and laws were checked. It is a working note for whoever runs
the server, not legal advice.

## 1. What leaves the browser

Only an explicit assistant request leaves the device, and only when the
assistant is switched on and a provider key is configured.

The request contains:

- the message itself, capped by `AI_MAX_MESSAGE_CHARS`;
- recent conversation turns, plus older turns that match the question, plus a
  short summary produced in the browser (`src/lib/aiHistory.ts`);
- saved notes that match the question (`src/lib/aiMemory.ts`), capped by
  `AI_MEMORY_LIMIT`;
- the app sections the question mentions (`src/lib/aiContext.ts`), capped at
  2.5 KB before it leaves and 8 KB after server sanitising;
- the age band and display name, if set;
- files deliberately attached to that message: compressed image previews, one
  still frame from a video, text read from small text files, and names and types
  for other files (`server/ai/service.ts` validates and caps each one).

It never contains: journal entries, journal text, photos stored elsewhere in the
app, cycle entries, mood notes, the account password, the account email, the
local account id (only a SHA-256 digest for quotas), or any other account's
records.

## 2. What the server keeps

Nothing about the content. `server/ai/usage.ts` writes a JSON counter file with:

- request counts, token counts and estimated cost per day, month, provider,
  model and cache hits;
- per anonymous install id and per one-way user hash.

It holds no prompts, replies, emails, names or reversible account ids. The file
lives at `data/ai-usage.json` next to the server process.

## 3. Provider retention and training positions

Checked 1 November 2026.

| Provider | Training on API input/output | Retention | Notes |
| --- | --- | --- | --- |
| Freebuff API | Governed by Freebuff's terms for the operator's account. Confirm the current training position before deployment. | The app keeps no prompt text; Freebuff controls retention of the request itself. Check Freebuff's current policy. | OpenAI-compatible endpoint at `https://freebuff.com/api/v1/paid`. Update this row from Freebuff's current policy before launch. |
| OpenAI | No, since 1 March 2023, unless the account explicitly opts in. | Abuse-monitoring logs up to 30 days. | Zero data retention and modified abuse monitoring require prior approval. This app leaves OpenAI disabled unless `OPENAI_ENABLED=true`. |
| Hugging Face router | No at the HF layer; it does not store request bodies or responses. | HF debug logs up to 30 days, no user data or tokens. Upstream vendor policy governs the prompt itself. | The app pins `HF_PROVIDER` to a vendor on its allowlist and never uses automatic routing. |

Sources:

- https://freebuff.com
- https://freebuff.com/account/api
- https://developers.openai.com/api/docs/guides/your-data
- https://developers.openai.com/api/docs/guides/private-safety-processing
- https://huggingface.co/docs/inference-providers/en/security

Because the operator chooses the provider, the privacy page names the provider
and warns that processing may happen outside Australia. That is the APP 8
cross-border disclosure notice.

## 4. Australian Privacy Principles assessment

The app is local-first. The operator of a deployed server is the APP entity for
the assistant traffic; the browser owner is the custodian of the vault.

- APP 1 and APP 5 (open and transparent, notice): `/privacy` explains what is
  sent, who receives it, that it may go overseas, how long it is kept, and how to
  delete it. Settings links to it from the assistant controls.
- APP 3 (collection): only the sections a question mentions are collected, and
  sensitive collections (journal, cycle, photos stored in other screens) are
  excluded in code. A file is included only when the person attaches it to a
  coach message. Memory is opt-in per note and can be switched off entirely.
- APP 6 (use and disclosure): assistant data is used only to answer the question.
  It is not used for training, analytics, advertising or profiling by this app.
- APP 8 (cross-border): provider named, overseas processing disclosed, and the
  feature can be disabled by the user and by the operator.
- APP 11 (security): provider keys stay on the server; the browser never sees a
  key; conversations and memory are AES-GCM encrypted in the local vault;
  requests are same-origin only and carry no CORS headers; reply content is
  never written to disk by the server. Notifiable Data Breaches: the ledger file
  contains no personal information, so a leak of it would not identify anyone.
- APP 12 and APP 13 (access and correction): every saved note is visible, editable
  and deletable in Settings; conversations can be renamed and deleted.
- APP 7 (direct marketing): no marketing use exists.

## 5. Children and the Online Safety Act 2021

- The app collects no birthday. The age band in Settings is a safety control,
  not verification, and the privacy page says so.
- Children's Online Privacy Code: exposure draft released 31 March 2026, final
  Code to be registered by 10 December 2026. Relevant draft duties already
  reflected here: child's best interests, privacy by default, no default-on
  memory, age-appropriate notice, ability to see and delete a child's data.
- Online Safety Act phase 2 codes (registered 9 September 2025, commenced in
  stages from 27 December 2025) place duties on services with AI chat features,
  including risk assessment, default protections for children, reporting and
  age assurance where risk is high. This app is not an AI companion product, but
  it applies the same defaults: no persuasive persona, no emotional dependency
  framing, crisis escalation, hard blocks on sexual content involving minors,
  and no streaming for minors so every reply can be filtered first.
- Basic Online Safety Expectations: generative AI is named; the practical
  expectations (safe defaults, reporting, transparency) are met by the blocks,
  the visible controls and this record.

Sources:

- https://www.oaic.gov.au/privacy/privacy-registers/privacy-codes/childrens-online-privacy-code
- https://ministers.ag.gov.au/media-centre/draft-childrens-online-privacy-code-released-31-03-2026
- https://www.esafety.gov.au/industry/basic-online-safety-expectations
- https://www.esafety.gov.au/newsroom/media-releases/esafety-report-shows-ai-companions-are-putting-children-at-risk

## 6. Safety controls that do not depend on the model

Implemented in `server/ai/safety.ts` and enforced in `server/ai/service.ts`:

- input blocks: sexual content involving minors, weapon and explosive
  construction, drug synthesis, malware, self-harm methods, eating-disorder
  instructions, hate-directed violence;
- input flags: suicide, self-harm, overdose and abuse language, which add crisis
  guidance and a server-added resource list to the reply;
- injection detection: attempts to replace or reveal the instructions are
  flagged and passed to the model as quoted content, never as commands;
- output moderation: internal instruction marker removed, sexual content
  involving minors replaced, harm-method replies replaced with crisis text,
  stricter filters for child and teen bands, personal data not present in the
  question redacted, replies truncated to `AI_MAX_REPLY_CHARS`;
- action proposals are stripped unless the action is allowed on that screen, and
  nothing is written without an explicit confirmation in the interface.

Streaming is disabled for children, teenagers and crisis conversations so the
full reply is moderated before it is displayed.

## 7. Review triggers

Re-check this file when: a provider changes its terms; the Children's Online
Privacy Code commences; the Digital Duty of Care Bill passes; a new provider or
model is added; a new collection is added to `aiContext.ts`; or the age bands
change.

## Where provider keys live

Keys are server environment variables, never application data.

- Local or self-hosted: put them in `.env` in the project root. The server reads that file at startup (`process.loadEnvFile`), real environment variables take precedence, and the file is gitignored. Restart the server after changing it.
- Hosted: set them in the host's environment or secret manager. No file is needed.
- Never put a key in `src/`, a `VITE_` variable, `data/ai-settings.json`, a screenshot, a commit or a chat message. The dashboard can switch a provider on or off but cannot add or reveal a key, and the connection test uses the provider's model list so it verifies a key without spending tokens or returning it.
- The server refuses to serve `.env` and other dotfiles (`server.ts` blocks them), and `.gitignore` excludes `.env*` apart from `.env.example`.
- Rotate any key that has been pasted into a chat, issue tracker or log.

## Admin dashboard

The operator dashboard is at `/admin/ai` and talks only to `/api/ai/admin/*`.

- Every admin request needs `AI_ADMIN_TOKEN` in an `Authorization: Bearer` header. The token is compared in constant time with a hashed copy of the environment value. If no token is set the routes answer 503 and the page explains the setup step. A wrong or missing token gets 401. The token is held in `sessionStorage` for the tab, never in the account vault or localStorage, and is never returned by the server.
- The dashboard may enable or disable a configured provider, choose the primary and backup model, set global, daily, per-user and per-provider limits, and run a connection test. Changes are stored in `data/ai-settings.json` and apply immediately. They cannot add a key or bypass the under-18 vendor policy for Hugging Face.
- The connection test calls the provider's model list only. It verifies the key and reachability without generating a reply and never returns the key or an upstream auth header.
- The dashboard shows counts, token totals, estimated cost, latency, failures, rate-limit errors, fallbacks, moderation counts, blocked requests, reported replies and safety errors. It never shows prompts, replies, saved notes, emails or account ids. Reports carry a reason category only and never the reply text.
- The ledger in `data/ai-usage.json` keeps 35 days of daily totals and monthly aggregates, then prunes. Safety counters keep fixed flag identifiers, and flag values that are not identifiers are discarded.
- Limits are enforced before a provider call. Reaching the daily or monthly budget, the token ceiling, a per-user ceiling or a provider ceiling returns 429 and the request never leaves the server.
