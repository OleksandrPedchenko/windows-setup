# Phase 2 design

Phase 2 makes the existing cache useful when an ISO was obtained outside the CLI and adds a small, verified set of official images. It stays separate from USB deployment.

## Import

`toolkit import <destination> <file> [--cache PATH]` imports a local image for a known descriptor. The destination must have a lock entry with an official SHA-256. The command streams the local file into a temporary cache file, computes SHA-256, checks the locked hash and optional size, then atomically moves it into the content-addressed cache. A mismatch leaves the existing cache intact. A matching cached image is reused after its hash is checked. The source file is never moved or modified. Paths inside the repository remain invalid for the cache.

This first import path deliberately requires an official hash; the existing Windows descriptors have one. A manual descriptor without a trusted hash remains unsupported for import rather than implying that a user-supplied hash proves upstream integrity.

## Initial collection expansion

Add Debian amd64 netinst, Ubuntu Desktop 26.04 LTS amd64, and Proxmox Backup Server from official SHA256SUMS files. These fit the existing checksum-index provider. Their descriptors use stable destination names while the lock captures current upstream filenames and hashes. No new provider is added without a verified official source that needs one.

## Boundaries

No multi-gigabyte ISO is downloaded in tests. No USB is written. The PowerShell downloader keeps its current invocation. Microsoft automated link reliability remains an upstream limitation; importing a browser-downloaded ISO is its practical fallback.
