# Gumbo for Chrome

The Chrome extension: Tab, inline Ctrl+K, memory and meetings on every site. What it does and why: [SPEC.md](SPEC.md).

## Build and load
```
pnpm --filter @dream/extension build     # once, into apps/extension/dist
pnpm --filter @dream/extension dev       # rebuild on every change
```
Load it in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`. Its id is always
`cikfcoahiibaldfbafkcnolkdknjnelp` (the signing key is `.secrets/gumbo-extension-key.pem`; `scripts/key.ts` makes one
if it is missing and prints the `key` for manifest.json).

## Test
- Unit tests run with the repo's `pnpm test` (`tests/unit/extension`, the gateway's fast lane in `tests/integration`).
- End to end, headless (no window opens) against a stand-in gateway and local test pages:
  `pnpm --filter @dream/extension build && pnpm --filter @dream/extension test:e2e`.

## Layout
- `src/background`: the service worker (sign-in, the gateway, memory, every surface's engine).
- `src/content`: the content script in every frame (fields, ghost text, Ctrl+K, capture, actions) and the sign-in hand-off.
- `src/shared`: what both use (settings, the gateway client, messages, design tokens).
- `src/popup`, `src/welcome`, `src/sidepanel`, `src/offscreen`: the extension's pages.
- `test`: the stand-in, fixtures, test pages and end-to-end specs.
