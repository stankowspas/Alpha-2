# Alpha Chat 2.0

**Official name:** Изкуствен интелект – олекотен езиков модел  
**Developed by:** Spas Stankov  
**Status:** internal Alpha development

Alpha Chat 2.0 is a browser-first PWA. The active chat path calls the official Gemini API directly from the user's browser; there is no production Alpha AI HTTP server.

## Current runtime

- Web UI: React + TypeScript + Vite.
- AI runtime: `BrowserGeminiModelAdapter` inside the browser.
- Provider: official Google Gemini API over HTTPS/SSE.
- Primary model: `gemini-3.6-flash`; fallback: `gemini-3.5-flash`.
- Conversation history is stored locally.
- FAST / THINKING modes and LOW / MEDIUM / HIGH response depth are supported.

## ApplicationCore invariant

Every user request becomes exactly one `MODEL` step:

```text
User request
  -> normalize
  -> one MODEL step
  -> browser Gemini runtime
  -> execution verification
  -> completion
  -> finalization
  -> user-visible answer
```

There is no automatic request Router, SIMPLE/COMPLEX classifier, regex capability selector, or automatic Search/Weather/Time/Calculator selection inside `ApplicationCore`.

## Browser API key model

The production Pages workflow exposes the GitHub Actions secret `GEMINI_API_KEY` to Vite as `VITE_GEMINI_API_KEY` during the build. Because Vite variables are compiled into client JavaScript, this value is visible to users of the site by design.

For this architecture, restrict the key at the Google side to the intended web origin and the Gemini/Generative Language API, and apply quotas. Do not treat this key as a private server credential.

## Local development

Create `.env.local` with:

```bash
VITE_GEMINI_API_KEY=your-key
```

Then run:

```bash
npm install
npm run dev:web
```

Search (`5174`) and Fetch (`5175`) development services remain separate support services and are not part of the active automatic chat path.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## PWA / GitHub Pages

Production deployment is static:

```text
GitHub Pages -> Alpha 2 PWA -> Gemini API
```

There is no `VITE_AI_ENDPOINT`, no production Python AI backend, and no Render deployment requirement.
