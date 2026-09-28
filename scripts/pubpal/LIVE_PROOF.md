# Pal ElevenLabs live proof (2026-09-27)

This pre-deploy proof ran before `/api/pub-pal/tools/*` was live in production:

- Local dev on port 3005
- Public tunnel to local dev (localtunnel; hostname omitted from docs)
- `npm run pubpal:agent -- --base-url <tunnel-url>` (temporary webhook URLs only for proof)
- `npm run pubpal:prove-text-tool`

Evidence (`toolSeen: true` — agent invoked a server webhook tool during text-only mode):

```json
{
  "toolSeen": true,
  "agentTextLength": 228,
  "agentTextPreview": "I am sorry, I cannot fulfil this request. The available tools lack the functionality to search for pubs based on their noise level. I can search for pubs in Clapham that have listed prices, but I cannot guarantee they are quiet."
}
```

After production deploy, re-run:

`npm run pubpal:agent -- --base-url https://pubmaxxing.com`

so webhook tools point at the live deployment (not the tunnel).
