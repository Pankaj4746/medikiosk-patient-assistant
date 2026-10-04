# MediKiosk

## Running locally

```powershell
npm install
npm run dev
```

## Patient session persistence

Patient registration is kept in the browser's local storage. Refreshing the app or returning to the landing page shows **Continue My Session** rather than silently ending a patient session. This is prototype browser storage, not a secure clinical record store.

## Gemini Live voice intake

The case-taking screen keeps its local clinical question flow as a fallback. When Gemini Live is configured, **Hear question** speaks a concise symptom-focused question and **Start speaking** records a live microphone response. Gemini output is never displayed as a diagnosis.

1. Copy `.env.example` to `.env.local`.
2. In production, supply a backend-generated short-lived token as `VITE_GEMINI_LIVE_TOKEN`.
3. For a local demo only, use `VITE_GEMINI_API_KEY`.
4. Restart the dev server after editing `.env.local`.

Never deploy a long-lived API key in browser code. Gemini recommends ephemeral tokens for browser connections: [official token guidance](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens). This integration follows Gemini's WebSocket and 16 kHz PCM audio requirements: [official WebSocket guide](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket).

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
