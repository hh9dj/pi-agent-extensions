# deepseek-tier

Publishes DeepSeek peak/off-peak pricing tier via `ctx.ui.setStatus("deepseekTier", ...)` when a DeepSeek model is active.

## Config

Optional `~/.pi/agent/deepseek-tier.json` (loaded on startup / `/reload`; missing fields use defaults):

```json
{
  "enabled": true,
  "peakWindowsUtc": [[1, 4], [6, 10]],
  "labels": { "peak": "peak pricing", "offPeak": "off-peak pricing" }
}
```

- `peakWindowsUtc`: `[startHour, endHour)` UTC ranges, Mon–Fri (weekends are off-peak).
- Refreshes every 60s in UI sessions.
- Styled with Pi theme colors (`error` for peak, `muted` for off-peak).

## zentui

To preserve theme colors in zentui:

```json
{
  "components": {
    "footer": {
      "styles": {
        "starship": {
          "extensionStatuses": {
            "colorModes": { "deepseekTier": "original" }
          }
        }
      }
    }
  }
}
```
