# Phase 1 implementation plan

Scope: implement Phase 1 from [the brief](ventoy-toolkit-brief.md) in this repository, without changing the PowerShell downloader or implementing USB deployment.

1. Add a Node.js 22+ TypeScript CLI with `list` and `validate`. Discover explicit `.iso.json`, `.img.json`, `.exe.json`, `.zip.json`, and `.msi.json` descriptors beneath `drive/`; validate all inputs before network or output writes. Derive stable destination paths from descriptor paths.
2. Implement `direct`, `github-release`, `checksum-index`, and `manual` metadata resolvers. Use official GitHub release asset digests and official checksum indexes when available. Distinguish provider failure, ambiguous metadata, and unknown image identity.
3. Add deterministic `toolkit.lock.json` and read-only `check-updates`; `--write-lock` is the only lock mutation. No temporary URLs or credentials enter the lock. Preserve old entries after provider errors.
4. Add `download <destination>` with a configurable cache outside Git, streaming `.part` files, SHA-256 and size checks, and promotion only after verification. Require a matching lock entry to prevent silently downloading a newer upstream artifact.
5. Add a small set of official descriptors, unit tests with local fixtures, cross-platform Node CI, and runnable documentation. Keep binaries out of Git.

Review focus: symlinks and traversal under `drive/`; multiple GitHub assets matching one pattern; changed checksum without changed version; provider outage during lock write; failed download retaining an existing cached binary.
