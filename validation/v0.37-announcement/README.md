# JS Webhook Validation

Verifies the JS webhook example from the
[Obelisk 0.37 announcement](@/blog/2026-04-13-announcing-obelisk-0-37.md).

The deployment contains three components that mirror the code shown in the post:

- **`activity/weather.js`** — fetches the current temperature for a city from `wttr.in`
- **`workflow/city_temperatures.js`** — fetches temperatures for multiple cities in parallel using join sets
- **`webhook/weather.js`** — accepts `POST /weather` with `{"cities": [...]}`, schedules the workflow, and immediately returns `{"execId": "..."}` with HTTP 202

## Prerequisites

- `obelisk` on `$PATH`
- Outbound network access to `wttr.in`

## Running

```sh
./test.sh
```
