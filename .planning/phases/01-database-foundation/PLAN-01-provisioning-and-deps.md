---
phase: 01-database-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - bun.lock
  - .env.local
  - .gitignore
autonomous: false
requirements: [DB-01, DB-02, DEV-01]
user_setup:
  - service: neon
    why: "Provision Neon Postgres via Vercel Marketplace; auto-injects DATABASE_URL + DATABASE_URL_UNPOOLED into the Vercel project"
    env_vars:
      - name: DATABASE_URL
        source: "Auto-injected by Vercel Neon Marketplace integration (pooled, PgBouncer)"
      - name: DATABASE_URL_UNPOOLED
        source: "Auto-injected by Vercel Neon Marketplace integration (direct connection)"
    dashboard_config:
      - task: "Install Neon integration on this Vercel project"
        location: "Vercel dashboard -> Project -> Storage tab -> Browse Marketplace -> Neon -> Free tier -> connect to this project, scopes: Production + Preview + Development"

must_haves:
  truths:
    - "Neon Postgres database exists, provisioned through the Vercel Marketplace integration on this Vercel project"
    - "DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED (direct) are present in the Vercel project's env (all three scopes) AND in local .env.local after vercel env pull"
    - "@neondatabase/serverless ^1.x and drizzle-orm ^0.45.x are installed as dependencies; drizzle-kit ^0.31.x as a dev dependency"
    - ".env.local exists locally with the Neon URLs but is NOT committed (already gitignored via .env*)"
    - "POST /api/generate continues to return PNGs unchanged (no regression)"
  artifacts:
    - path: "package.json"
      provides: "Neon + Drizzle dependencies recorded"
      contains: "@neondatabase/serverless"
    - path: "package.json"
      provides: "drizzle-orm and drizzle-kit recorded"
      contains: "drizzle-orm"
    - path: ".env.local"
      provides: "Local Neon connection strings"
      contains: "DATABASE_URL_UNPOOLED"
  key_links:
    - from: "Vercel project (run-map-generator)"
      to: "Neon project"
      via: "Vercel Marketplace integration"
      pattern: "DATABASE_URL is set in Vercel env (Production+Preview+Development)"
    - from: "Local dev"
      to: "Vercel project env"
      via: "bunx vercel env pull .env.local"
      pattern: "DATABASE_URL.*neon.*tech"
---

<objective>
Stand up the **infrastructure and dependency layer** for Phase 1 — provision the Neon database via the Vercel Marketplace, pull the auto-injected env vars to local, and install the Neon HTTP driver + Drizzle ORM + drizzle-kit as Bun deps. **No application code, no schema, no migrations** in this plan — that's PLAN-02. This plan is intentionally separated because the Marketplace step is interactive (browser) and we don't want any subsequent automated work to be blocked by a half-installed integration.

Purpose: Without a provisioned DB and the right env vars in place locally, PLAN-02 cannot run `drizzle-kit generate` or `drizzle-kit migrate`. Splitting also keeps the human-action checkpoints isolated to one plan.

Output: A Vercel project linked to a Neon database, the `DATABASE_URL` / `DATABASE_URL_UNPOOLED` env vars present locally in `.env.local`, and `@neondatabase/serverless` + `drizzle-orm` + `drizzle-kit` installed via Bun. The existing generate route still works.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/01-database-foundation/CONTEXT.md
@.planning/research/neon-drizzle.md
@.planning/codebase/STACK.md
@.planning/codebase/STRUCTURE.md
@.planning/codebase/ARCHITECTURE.md
@package.json
@.gitignore
@.env.example
</context>

<pre_flight>
Before any task, the executor MUST:
1. Read `.planning/phases/01-database-foundation/CONTEXT.md` end-to-end. Every "LOCKED" decision is non-negotiable.
2. Read `.planning/research/neon-drizzle.md` sections 1 (driver) and 3 (Vercel Marketplace).
3. Confirm `.env*` is already in `.gitignore` (it is — line `.env*`). Do NOT add a duplicate.
4. Confirm Bun is the package manager (presence of `bun.lock`). NEVER run `npm` / `npx` / `node` for installs.
5. Confirm the existing generate flow works before touching anything: `bun dev`, then `curl -X POST -H "x-generate-password: $GENERATE_PASSWORD" http://localhost:3000/api/generate -o /tmp/before.png && file /tmp/before.png` should report `PNG image data`. (Skip if no GENERATE_PASSWORD is in `.env.local` yet — note this in the SUMMARY and run the equivalent check at the end of the plan after `vercel env pull` repopulates env.)
</pre_flight>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 1: Provision Neon via Vercel Marketplace (USER ACTION)</name>
  <what-built>Nothing automated. Claude cannot click through the Vercel dashboard.</what-built>
  <how-to-verify>
    Step-by-step (per CONTEXT.md > Provisioning, and research/neon-drizzle.md section 3):

    1. Open https://vercel.com/dashboard in a browser.
    2. Select the **run-map-generator** project (the one this repo is linked to via `.vercel/project.json`).
    3. Click the **Storage** tab in the project nav.
    4. Click **Browse Marketplace** (or **Create Database** if you've used the marketplace here before).
    5. Find **Neon** in the Postgres section. Click **Add Integration** / **Install**.
    6. Select **Free tier** (the project is single-user / personal).
    7. When prompted to attach to a project, choose **run-map-generator**.
    8. Confirm env-var injection scopes: tick **Production**, **Preview**, AND **Development**. (All three. Development is needed for `vercel env pull`.)
    9. Click **Connect** / **Install** to finish.
    10. Wait ~30s for provisioning. The integration page should show "Connected" with a Neon project name.

    Verify in the Vercel dashboard:
    - Go to **Project Settings -> Environment Variables**.
    - Confirm `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are listed across all three scopes. (Also `PGHOST`, `PGUSER`, etc. — ignore them per CONTEXT.md.)

    If the dashboard shows the Neon integration is already installed from a previous session, skip steps 4-9 — just confirm the env vars are present in step 10. Done.
  </how-to-verify>
  <resume-signal>
    Reply "provisioned" once both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are visible in Vercel project env settings (Production + Preview + Development scopes).

    If you hit a problem (wrong project, no Vercel CLI link, integration already on a different Neon project), describe it and we'll debug before proceeding.
  </resume-signal>
  <done>Neon project provisioned. `DATABASE_URL` + `DATABASE_URL_UNPOOLED` present in Vercel env across Production, Preview, Development scopes.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: Pull Vercel env to .env.local (USER ACTION — interactive auth)</name>
  <what-built>
    Claude WILL attempt the pull automatically first via `bunx vercel env pull .env.local`. If Vercel CLI is already authenticated locally (token cached in `~/.local/share/com.vercel.cli/`), this completes without user interaction and this task self-resolves.

    If the CLI prompts for browser login (`vercel login`), THAT step is what the user must complete in a browser. Claude should run `bunx vercel login` first if needed, observe the device-code URL it prints, and then surface this checkpoint.
  </what-built>
  <how-to-verify>
    Claude (automated first):
    ```bash
    cd /Users/kalebnim/Documents/GitHub/run-map-generator
    bunx vercel env pull .env.local
    ```

    Expected: `Downloaded development Environment Variables to .env.local`. If success → skip user-action steps.

    If the command instead prints `> No existing credentials found` or asks for login:
    1. Run `bunx vercel login` in the project dir (Claude does this).
    2. Vercel CLI prints a URL like `https://vercel.com/api/registration/login-with-github?mode=login&next=...`. Claude surfaces it here.
    3. **USER**: open the URL in a browser, complete GitHub/email auth, return to terminal.
    4. CLI confirms "Success!". Claude re-runs `bunx vercel env pull .env.local`.

    Verify after pull (Claude runs):
    ```bash
    grep -E '^(DATABASE_URL|DATABASE_URL_UNPOOLED)=' .env.local | wc -l
    ```
    Must output `2`. If `0` or `1`, the integration scope is wrong (missing Development) — go back to Task 1 step 8.

    Also verify the URL shape:
    ```bash
    grep '^DATABASE_URL=' .env.local | grep -E 'postgres(ql)?://.*neon\.tech.*-pooler'
    grep '^DATABASE_URL_UNPOOLED=' .env.local | grep -E 'postgres(ql)?://.*neon\.tech' | grep -v -- '-pooler'
    ```
    `DATABASE_URL` MUST contain `-pooler` in the host (it's the PgBouncer endpoint). `DATABASE_URL_UNPOOLED` MUST NOT. Per CONTEXT.md > Driver / `drizzle.config.ts`, getting these confused breaks runtime OR drizzle-kit.
  </how-to-verify>
  <resume-signal>
    Reply "pulled" once `.env.local` contains both `DATABASE_URL` (pooled, has `-pooler`) and `DATABASE_URL_UNPOOLED` (direct, no `-pooler`).

    If `bunx vercel env pull` worked without any browser step, this task auto-resolves — Claude proceeds to Task 3 without waiting.
  </resume-signal>
  <done>`.env.local` exists in repo root with both Neon URLs correctly distinguished. File is NOT committed (verify `git status` does not list it). `.gitignore` already excludes `.env*` — confirm with `git check-ignore .env.local` returning the file path.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Install Neon driver + Drizzle ORM + drizzle-kit (Bun)</name>
  <files>package.json, bun.lock</files>
  <action>
    Install exactly these per CONTEXT.md > Driver and research/neon-drizzle.md section 2. **BUN ONLY** — no npm, no npx for installs.

    Runtime deps:
    ```bash
    bun add @neondatabase/serverless drizzle-orm
    ```

    Dev dep (drizzle-kit is a CLI used at build/dev time, not imported by app code):
    ```bash
    bun add -d drizzle-kit
    ```

    After install, verify the major versions match the research's compatibility band (CONTEXT.md says `@neondatabase/serverless@^1.x`). Open `package.json`:
    - `dependencies."@neondatabase/serverless"` MUST resolve to `^1.x` (e.g. `^1.1.0`). If Bun pinned an older 0.x, force-upgrade with `bun add @neondatabase/serverless@^1.1.0`. The 1.x line is required because `neonConfig.fetchConnectionCache` is a no-op there (default-on) — copying old snippets that set it would silently do nothing on 1.x and actively confuse on 0.x.
    - `dependencies."drizzle-orm"` should be `^0.45.x` or newer.
    - `devDependencies."drizzle-kit"` should be `^0.31.x` or newer.

    Do NOT install `pg`, `ws`, `@types/pg`, `@types/ws`, or `drizzle-orm/neon-serverless`-related polyfills. The HTTP driver does not need them and CONTEXT.md explicitly forbids them.

    Do NOT install `dotenv`. Next 16 reads `.env.local` automatically; drizzle-kit reads it via Next's loader when invoked from a Bun script in this repo (verified in PLAN-02).
  </action>
  <verify>
    <automated>
      cd /Users/kalebnim/Documents/GitHub/run-map-generator && \
      grep -q '"@neondatabase/serverless"' package.json && \
      grep -q '"drizzle-orm"' package.json && \
      grep -q '"drizzle-kit"' package.json && \
      ! grep -qE '"(pg|ws|@types/pg|@types/ws)"' package.json && \
      node -e 'const p=require("./package.json"); const v=p.dependencies["@neondatabase/serverless"]; if(!/^\^?1\./.test(v)) { console.error("BAD VERSION:", v); process.exit(1); } console.log("ok",v);'
    </automated>
  </verify>
  <done>
    - `package.json` lists `@neondatabase/serverless` (^1.x), `drizzle-orm` (^0.45.x+), `drizzle-kit` (^0.31.x+, devDep).
    - No `pg` / `ws` deps present.
    - `bun install` (implicit from `bun add`) succeeded — `bun.lock` updated.
    - `bun run build` (existing build, no script change yet) still succeeds — sanity check that nothing in the dep install broke the existing build. If it fails, the issue is upstream of any DB code.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Smoke-test no regression on /api/generate</name>
  <what-built>The dependency installs above. We need to verify the existing PNG-generation flow still works before handing off to PLAN-02.</what-built>
  <how-to-verify>
    Claude runs:
    ```bash
    # In one terminal:
    cd /Users/kalebnim/Documents/GitHub/run-map-generator && bun dev
    ```

    Then in another shell (or the user manually in a browser):
    ```bash
    # Read GENERATE_PASSWORD from .env.local (now populated by Task 2)
    PASSWORD=$(grep '^GENERATE_PASSWORD=' .env.local | cut -d= -f2- | tr -d '"')
    curl -sS -X POST -H "x-generate-password: $PASSWORD" http://localhost:3000/api/generate -o /tmp/after-plan01.png
    file /tmp/after-plan01.png
    ```

    Expected: `/tmp/after-plan01.png: PNG image data, ...` and a non-zero file size (> 50 KB typical).

    If `GENERATE_PASSWORD` is not in `.env.local`, the user must add it manually (it's not auto-injected by the Neon integration — it's a pre-existing app secret). Add it to Vercel env first, re-run `bunx vercel env pull .env.local`.

    Browser alternative: open `http://localhost:3000`, enter password, click Generate, confirm an image renders within ~2 minutes.
  </how-to-verify>
  <resume-signal>Reply "no regression" once a PNG is returned. If the generate flow is broken, STOP — PLAN-02 cannot proceed until this works because PLAN-02's smoke test depends on the same baseline.</resume-signal>
  <done>`POST /api/generate` returns a valid PNG end-to-end. The dev server starts cleanly with no new module-resolution errors from `@neondatabase/serverless` or `drizzle-orm` (none should be imported anywhere yet).</done>
</task>

</tasks>

<verification>
After all four tasks:

1. `bunx vercel env ls` shows `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Production + Preview + Development.
2. `cat .env.local | grep -c DATABASE_URL` returns `2` (both pooled and unpooled).
3. `git check-ignore .env.local` returns `.env.local` (it is ignored).
4. `bun pm ls 2>/dev/null | grep -E '@neondatabase/serverless|drizzle-orm|drizzle-kit'` lists all three.
5. `bun run build` succeeds with the unchanged build script.
6. `POST /api/generate` returns a PNG.
</verification>

<success_criteria>
- Neon DB provisioned through Vercel Marketplace; both DB URLs in Vercel env across all three scopes.
- `.env.local` populated locally with both URLs and confirmed gitignored.
- `@neondatabase/serverless` (^1.x), `drizzle-orm` (^0.45.x+), `drizzle-kit` (^0.31.x+) installed via Bun.
- No `pg` / `ws` dependencies introduced.
- Existing `POST /api/generate` PNG flow unchanged.
- PLAN-02 can immediately run `bunx drizzle-kit generate` and `bunx drizzle-kit migrate` without any prerequisite blocking.
</success_criteria>

<requirements_coverage>
| Requirement | Task |
|-------------|------|
| DB-01 (Neon provisioned via Vercel Marketplace) | Task 1 |
| DB-02 (`@neondatabase/serverless` HTTP driver dep installed; wiring in PLAN-02) | Task 3 |
| DEV-01 (`bunx vercel env pull .env.local` populates DB secrets) | Task 2 |

`drizzle-orm` and `drizzle-kit` deps installed here are prerequisites for DB-03..07, SCH-01..04 which are wired in PLAN-02.
</requirements_coverage>

<output>
After completion, create `.planning/phases/01-database-foundation/01-01-SUMMARY.md` documenting:
- Neon project name (from Vercel dashboard)
- Resolved versions of `@neondatabase/serverless`, `drizzle-orm`, `drizzle-kit`
- Whether `vercel env pull` required interactive login
- Smoke-test result for `/api/generate`
- Any deviations from CONTEXT.md
</output>
