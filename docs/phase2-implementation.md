# Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import officially verified local ISOs into the cache and expand the initial official ISO collection.

**Architecture:** The import command consumes existing descriptors and lock entries, then uses a cache helper that hashes a streamed local file and atomically promotes it. New descriptors reuse the checksum-index provider.

**Tech Stack:** Node.js 22+, TypeScript, Node standard library.

**Spec:** [Phase 2 design](phase2-design.md).

## Global Constraints

- Keep the cache outside the repository and keep binaries out of Git.
- Require a locked official SHA-256 for local import.
- Do not modify source files, write a USB, or change the PowerShell downloader.
- Do not download large ISOs in tests.

## Review Focus

- Wrong local hash or size leaves an existing cached image intact.
- Symlinked source files and non-files are rejected.
- A cache path under the repository is rejected.
- An import without a trusted lock hash is rejected.
- Existing matching cached content is checked before reuse.

---

### Task 1: Verified local import

**Files:** `src/cache.ts`, `src/cli.ts`, `tests/cache.test.ts`, `tests/cli.test.ts`.

- [x] Add failing tests for success, mismatch, source safety, cache location, and reuse.
- [x] Implement `importToCache(destination, path, locked, cacheRoot)` using streamed SHA-256 and an atomic cache promotion.
- [x] Wire `toolkit import` into CLI argument parsing and descriptor/lock lookup.
- [x] Run `npm test` and confirm all tests pass.

### Task 2: Official source expansion

**Files:** `drive/ISO/Linux/*.json`, `drive/ISO/Servers/*.json`, `toolkit.lock.json`, `docs/toolkit.md`, `README.md`.

- [x] Add Debian amd64 netinst, Ubuntu Desktop 26.04 LTS amd64, and Proxmox Backup Server descriptors using official SHA256SUMS indexes.
- [x] Run `toolkit validate` and live `check-updates --write-lock` without downloading images.
- [x] Document import usage and the official source URLs.
- [x] Run `npm test`, inspect the lock, and verify Git excludes large binaries.

### Task 3: Stacked PR

- [x] Review the diff and run `git diff --check`.
- [x] Push `codex/ventoy-phase2` and open a PR targeting `codex/ventoy-phase1`.
- [x] Wait for macOS, Linux, and Windows CI checks.
