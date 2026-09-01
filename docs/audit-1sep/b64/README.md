# Audit screenshot base64 sidecars (1 Sep)

ASCII base64 of PNG audit screenshots. Do not decode in-repo yet.

## Split files (exceeded GitHub Contents API size)

These originals were split into ≤700000-character parts. Concatenate parts in order to restore the full `.png.b64` file:

| Original | Parts |
|----------|-------|
| `desktop/01-home.png.b64` | `desktop/01-home.png.b64.part00` … `part01` |
| `desktop/02-map.png.b64` | `desktop/02-map.png.b64.part00` … `part03` |
| `desktop/03-map-log-wall.png.b64` | `desktop/03-map-log-wall.png.b64.part00` … `part02` |
| `desktop/09-map-list-error.png.b64` | `desktop/09-map-list-error.png.b64.part00` … `part02` |

Restore example:
```bash
cat desktop/01-home.png.b64.part00 desktop/01-home.png.b64.part01 > 01-home.png.b64
```
