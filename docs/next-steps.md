# Ventoy toolkit: next steps

This repository is the starting point. The original [Ventoy toolkit brief](ventoy-toolkit-brief.md) describes the intended end state; its instruction to create a new repository is superseded by the decision to use this one. The existing PowerShell installer downloader remains a separate, working utility under `drive/Tools/Scripts/`. Its package list is not a Ventoy artifact manifest.

## Current boundary

- `drive/` is the proposed USB content tree. At present it contains only the existing Windows downloader and its configuration. An ISO directory and `drive/ventoy/ventoy.json` should appear when their contents are actually implemented; empty placeholder files would be copied to a USB drive.
- `tests/`, `docs/`, `.github/`, and `validate.ps1` are repository tooling and stay outside `drive/`.
- Do not copy `*.json` descriptors to a prepared drive. Ordinary tracked JSON such as `packages.json` and future `ventoy.json` is copied normally. Exclude ignored local configuration and generated `downloads/` directories from any build or sync.
- The existing downloader still uses PowerShell and WinGet. The proposed Ventoy toolkit will use Node.js and TypeScript and must not silently change the downloader's prompts, flags, or config format.

## Phase 1: separate PRs, in order

1. **Foundation and descriptor discovery.** Add the minimal Node.js/TypeScript setup and a CLI with `list` and `validate`. Recursively find files matching a documented `.<artifact-extension>.json` convention under `drive/`, derive destination paths by removing only the final `.json`, and reject malformed descriptors or paths escaping `drive/`. Keep `packages.json`, `packages.encrypted.json`, and `ventoy.json` outside descriptor discovery. Add focused local tests.
2. **Provider metadata and lock file.** Implement `direct`, `github-release`, `checksum-index`, and `manual` metadata resolution using official sources. Keep providers independent of Ventoy, profiles, cache, and USB sync. Add a deterministic `toolkit.lock.json` keyed by destination path, without expiring URLs, credentials, or a claim that a binary was downloaded. Make `check-updates` read-only by default and write only with `--write-lock`. Retain old lock entries when a provider fails; report the failure. Test same-version checksum changes and ambiguous comparisons.
3. **Cache and download.** Add an external configurable cache, streaming downloads into `.part` files, size and SHA-256 checks, and atomic promotion after verification. A local checksum without an official expected checksum must be labeled accordingly. Do not fetch large images in tests. Keep download URL resolution near download time for expiring links.
4. **Verified example descriptors and documentation.** Research official source URLs, asset patterns, checksums, and licensing or reuse implications of the projects named in the brief before adding descriptors. Start with a few sources the implemented providers can actually resolve. Use `manual` for unsupported sources rather than invented endpoints. Document only runnable CLI examples.

The Phase 1 completion check is: a descriptor can be discovered, its upstream metadata checked and compared with the lock, then its binary downloaded on demand, verified, and stored in the cache. Run automated tests on macOS, Windows, and Linux in CI. Do not download multi-gigabyte ISOs for verification.

## Architecture decisions to settle in Phase 1

- **Stable USB names:** the descriptor path defines the destination filename; upstream filenames are metadata only.
- **Update identity:** compare official SHA-256 first. A version string alone cannot prove the image is unchanged. Report weaker signals separately and never call provider failure “up to date.”
- **Cache identity:** key by verified content checksum when available; retain the destination-path and lock relationship separately. Keep older verified files when a new download fails.
- **Lock semantics:** the lock is resolved upstream metadata in Git, not the installed state of any USB drive.
- **Microsoft:** research documented official mechanisms before implementing this provider. Keep it out of Phase 1 if reliable automation cannot be verified; a manual descriptor is acceptable.

## Later phases

- **Phase 2:** Microsoft and other specialized providers, manual imports, and a broader collection of verified descriptors.
- **Phase 3:** local build output, optional profiles, storage planning, safe USB sync, per-drive installed state, and verification. Never format a USB or delete unrelated files by default.
- **Phase 4:** Ventoy configuration generated only for selected artifacts, with a clear boundary between generated and manually maintained sections. Verify Ventoy keys against official documentation.
- **Phase 5:** homelab scheduling, update PRs, notifications, and optional boot testing. Keep the CLI independent of any scheduler.

Each phase needs explicit authorization before implementation, as requested in the original brief. Open work as PRs against `main` and preserve the PowerShell downloader's supported invocation in future moves.
