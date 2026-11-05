# Serene Structure 🌸

A minimal, calming, and neurodivergent-friendly life organizer designed with custom routines, visual time blocking, and one capture box that files what you type.

The app runs with **no API keys**: the capture box, the coach's built-in replies and the encrypted vault all work offline. An optional AI assistant can be turned on by setting one provider key on the server, and most of the app keeps working without it.

---

## 🚀 Deployment to GitHub Pages (Static Frontend)

Browsers cannot run raw TypeScript/Vite files (`.tsx`) directly from the source repository. To host the frontend of this application on **GitHub Pages**, it must be compiled into standard HTML, CSS, and JavaScript.

We have included an **Automatic GitHub Actions Workflow** (`.github/workflows/deploy.yml`) that builds and deploys your site whenever you push code.

### 📋 Steps to Make It Work on GitHub Pages:

#### 1. Enable Workflow Permissions on GitHub
To allow the GitHub Action to push the built site to your repository:
1. Go to your GitHub repository in your web browser.
2. Click **Settings** (top bar) > **Actions** (left sidebar) > **General**.
3. Scroll down to **Workflow permissions**.
4. Select **Read and write permissions**.
5. Click **Save**.

#### 2. Push Your Code to GitHub
Push your latest changes to the `main` or `master` branch on GitHub:
```bash
git add .
git commit -m "Deploy Serene Structure"
git push origin main
```

#### 3. Enable GitHub Pages in Repository Settings
Once the GitHub Action run completes in the **Actions** tab:
1. Go to **Settings** > **Pages** (left sidebar).
2. Under **Build and deployment** > **Source**, select **Deploy from a branch**.
3. Under **Branch**, select `gh-pages` and `/ (root)`.
4. Click **Save**.
5. Your live app URL will appear at `https://<your-username>.github.io/<your-repo-name>/`.

---

## ✍️ The capture box

The Coach screen takes one message and sorts it:

- `Dentist tomorrow at 3pm` → a task on that day
- `Spent $8.90 on bubble tea` → a budget expense
- `Yoga 30 min` → a workout
- `lunch: chicken salad` → a meal
- `note: feeling good today` → a journal entry

Each filed item can be opened or undone from the reply. Anything that isn't a filing goes to the built-in coach replies, or to the AI assistant when one is configured.

---

## 🤖 The AI system

One central service answers every AI request, so features never talk to a provider directly.

```
src/pages/*  →  src/lib/ai.ts  →  POST /api/ai/chat  →  server/ai/service.ts
                                                        ├─ config.ts     providers, models, prices, limits
                                                        ├─ providers.ts  one OpenAI-compatible adapter
                                                        ├─ prompts.ts    shared instructions + age rules
                                                        ├─ safety.ts     crisis notes, refusals, reply guard
                                                        └─ usage.ts      request/token/cost ledger
```

- **Providers:** Freebuff (default, OpenAI-compatible at `https://freebuff.com/api/v1/paid`, model set by `FREEBUFF_MODEL`), OpenAI (`gpt-6-luna`) as the fallback, and Hugging Face Inference Providers when `HF_MODEL` is set. All three speak the OpenAI chat-completions shape, so adding a fourth is one entry in `config.ts`.
- **Routing and fallback:** requested provider, then the default model, then the backup, then any other enabled provider, capped at three attempts. A timeout, a 429, a 5xx or an unreachable host moves to the next model; a 400 stops the chain because it would fail everywhere. The reply reports which provider answered and whether it fell back.
- **Streaming:** `POST /api/ai/chat/stream` sends server-sent events, and the Coach renders text as it arrives. Fallback only happens before the first token, so a reply is never spliced from two providers. `AI_STREAMING=false` falls back to one-shot replies.
- **Providers:** Freebuff is the primary. It needs both `FREEBUFF_API_KEY` and a model id in `FREEBUFF_MODEL`, because model ids change and this project does not hard-code one. OpenAI is a paid provider and stays disabled until you set `OPENAI_ENABLED="true"`, so adding a key for later does not start spend. Hugging Face needs a token and `HF_MODEL`.
- **Context:** the last few turns, notes the user asked it to remember, and a small snapshot of app data. Conversations, memory and preferences are stored in the existing encrypted vault, not in a new database.
- **Limits:** per-client requests per minute, requests and tokens per day, and a monthly dollar budget from `data/ai-usage.json` (counts and estimated cost only, no message content, gitignored).
- **Safety:** crisis language adds signposting to the system prompt, unambiguous disallowed requests are refused without calling a provider, and the age setting (adult, teen, under 13) tightens the rules for younger users.

### Configuration

Copy the AI block from `.env.example` into `.env` and set at least one key:

```bash
FREEBUFF_API_KEY="..."     # primary
FREEBUFF_MODEL="..."       # the model id your Freebuff plan serves
OPENAI_API_KEY="..."       # fallback
AI_ENABLED="auto"          # auto | true | false
AI_DEFAULT_MODEL="freebuff:your-model-id"
AI_COST_PER_MONTH_USD="10"
```

Keys are read only by the server. Nothing in `src/` references them, and `/api/ai/status` returns provider names and limits only. With no key set, `/api/ai/chat` answers `503` and the Coach uses its built-in replies, so the screen is never broken.

Hugging Face requests are pinned to a named upstream provider (`HF_PROVIDER`, default `together`) because the router's automatic and cheapest modes can fail a request over to vendors whose terms require end users to be 18 or older. Only `together`, `cerebras`, `deepinfra`, `cohere` and `hf-inference` are accepted.

### Switching providers

Nothing outside `server/ai/config.ts` names a provider. In `.env`:

```bash
AI_PROVIDER_ORDER="freebuff,openai,huggingface"   # preference and fallback order
AI_DEFAULT_MODEL="freebuff:your-model-id"         # primary
AI_BACKUP_PROVIDER="openai"                        # used when the primary fails
AI_BACKUP_MODEL="openai:gpt-6-luna"
AI_DISABLED_MODELS="freebuff:some-model"           # switch individual models off
FREEBUFF_ENABLED="true"
OPENAI_ENABLED="false"                             # paid, opt in explicitly
OPENAI_DAILY_REQUESTS="200"                        # per-provider ceiling
AI_VALIDATE_MODELS="true"                          # check ids against the live list
```

### Checking what is configured

```bash
npm run ai:check                     # providers, models, prices, limits, usage
npm run ai:models                    # ask each provider for its live model list
npx tsx scripts/ai-check.ts --live "hello"   # one real request, when keys exist
```

`npm run ai:models` prints the live ids and marks each configured model as available or not, which is the supported way to confirm a model has not been withdrawn. Because Freebuff model ids change, `npm run ai:models` is also the way to find the id to put in `FREEBUFF_MODEL` instead of copying one from an old tutorial.

### Cost controls

Three layers, all server-side: global requests and tokens per day plus a monthly dollar ceiling (`AI_REQUESTS_PER_DAY`, `AI_TOKENS_PER_DAY`, `AI_COST_PER_MONTH_USD`); a per-provider daily ceiling (`<PROVIDER>_DAILY_REQUESTS`) that removes a provider from the chain once reached; and a per-device daily ceiling (`AI_REQUESTS_PER_DAY_PER_CLIENT`) on top of a per-minute limit. Usage and estimated cost are written to `data/ai-usage.json`, broken down by model and provider, with no message content. `freebuff` counts once its key and model are set; `openai` counts only when `OPENAI_ENABLED="true"`.

---

## 💻 Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
Open your browser at `http://localhost:3000`.

### 3. Production Build & Start
```bash
npm run build
npm run start
```

---

## 🛠️ Full-Stack Hosting (Render, Railway, Fly.io, Cloud Run)

To deploy both the frontend AND the Express backend server online:
- **Render / Railway / Fly.io / Cloud Run**: Connect your GitHub repository, set the Build Command to `npm run build` and the Start Command to `npm start`. For Supabase-backed accounts, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `APP_ORIGIN` from `.env.example`. Without them, the app keeps its legacy development account path. See `docs/authentication.md` for the required Supabase redirect and email-template setup.
