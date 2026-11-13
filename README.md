# Coding Bro Lite 1.0.8

Coding Bro Lite is a desktop client for Codex-compatible coding workflows.

## Download

Download the [Lite 1.0.8 release](https://github.com/MobAI-Inc/coding-bro-app/releases/tag/lite-v1.0.8):

- macOS Apple Silicon: `.dmg`
- Windows x64: `.exe` or `.msi`
- Linux amd64: `.deb`

`SHA256SUMS` contains the SHA-256 checksums for the installers. Verify with
`shasum -a 256 <installer>` on macOS or `sha256sum <installer>` on Linux, then
compare the result with `SHA256SUMS`.

## Build the Lite client

Install Node.js 22, pnpm 10, Rust, and the platform prerequisites for Tauri 2.
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @coding-bro/codex-lite typecheck
pnpm build:lite:renderer
pnpm build:lite
```

Set `VITE_CODING_BRO_API_URL` to your compatible service origin before building.
For example, use `VITE_CODING_BRO_API_URL=http://localhost:3001 pnpm build:lite`.
The production-build default is `https://api.example.invalid`; development uses
a local service on port 3001. Authentication, model access and billing require
a compatible service. This repository contains desktop client source; backend
implementations and deployment credentials are excluded.

The workspace includes `apps/codex-lite`, shared `packages/product-core`, and
desktop client components in `src` and `src-tauri`. Lite's version is 1.0.8;
the shared full desktop application retains its own package version.

## License

See [LICENSE](LICENSE) for the MIT license and original copyright attribution.
Third-party licenses and notices remain beside their components, including
`apps/codex-lite/src-tauri/third-party/codex` and game assets.
