# Pal ElevenLabs live proof (2026-09-27)

Production does not yet expose `/api/pub-pal/tools/*`, so this proof used:

- Local dev on port 3005
- Public tunnel: `https://rotten-bushes-raise.loca.lt`
- `npm run pubpal:agent -- --base-url https://rotten-bushes-raise.loca.lt` (temporary webhook URLs)
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
