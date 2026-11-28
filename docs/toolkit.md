# Ventoy toolkit Phase 1

## Layout and descriptors

`drive/` represents future USB contents. A descriptor such as `drive/ISO/Servers/Proxmox.iso.json` names the future destination `ISO/Servers/Proxmox.iso`. Descriptors are discovered recursively; there is no second manifest. Only `.iso.json`, `.img.json`, `.exe.json`, `.zip.json`, and `.msi.json` are recognized. Other JSON files, including `ventoy.json` and the PowerShell `packages.json`, are ordinary files. The descriptor files themselves must be omitted from future USB builds.

Each descriptor needs `name` and `source`. Optional fields are `description`, `productUrl`, `estimatedSizeBytes`, `profiles` (array of strings), and `ventoy` metadata (`alias`, `class`, `tip`). Profiles and Ventoy metadata are stored but not acted on in Phase 1.

Supported sources:

| Provider | Required fields | Behavior |
|---|---|---|
| `direct` | `url` | Uses an HTTPS download URL. Optional `version`, `sha256`, `sizeBytes` supply metadata. |
| `github-release` | `repository`, `release`, `assetPattern` | Resolves one asset from GitHub's latest release or a tag. Uses GitHub's SHA-256 asset digest when supplied. |
| `checksum-index` | `baseUrl`, `checksumFile`, `assetPattern` | Parses SHA-256 lines, selects the highest matching version using numeric collation. Optional `release` pins a captured version. The first regex capture is the version. |
| `manual` | none | Reports that the file requires manual action. Optional `url` points to official instructions. |

For example:

```json
{
  "name": "Example recovery ISO",
  "source": {
    "provider": "github-release",
    "repository": "owner/project",
    "release": "latest",
    "assetPattern": "^example-.*-x64\\.iso$"
  }
}
```

Patterns should select exactly one asset and exclude unwanted architectures or variants. A changed upstream naming scheme causes a visible provider error. To add a provider, extend the `Source` union and validation in `src/descriptors.ts`, add metadata resolution in `src/providers.ts`, and add local response fixtures to `tests/providers.test.ts`. Keep USB, cache, and lock concerns out of the provider.

## Lock, checks, and cache

`toolkit.lock.json` records resolved upstream filenames, versions, SHA-256 hashes, and sizes when available. It does not record expiring URLs, local downloads, or the state of any USB. A provider failure preserves its old entry during `--write-lock` and reports `source-unavailable`; it is never reported as up to date. A matching checksum establishes an unchanged image. A changed checksum with the same version reports `refreshed-image`. Without a checksum, unchanged version and filename report `identity-unknown`.

`download` re-resolves metadata and refuses a release that differs from the lock. It stores files by content SHA-256 under the external cache and rechecks a cached file before reuse. The CLI rejects cache paths inside the repository. Metadata and binary requests reject HTTPS-to-HTTP redirects. Official hashes are verified when present. When absent, a local SHA-256 helps detect later cache corruption but cannot prove upstream integrity; cache reuse also requires the same source URL fingerprint. Cache metadata is local and never committed, and raw URLs are not stored in the cache index. A failed download leaves completed cached files intact. There is no import, resume, profile selection, drive build, or USB sync in Phase 1.

## Initial sources and prior art

- [Proxmox official ISO directory](https://download.proxmox.com/iso/) publishes `SHA256SUMS` and ISO signatures. This implementation uses the HTTPS checksum index; it does not verify the index's OpenPGP signature.
- [Rescuezilla official releases](https://github.com/rescuezilla/rescuezilla/releases) publish multiple ISO variants and GitHub asset SHA-256 digests. The descriptor selects the 64-bit Resolute variant explicitly.
- [Microsoft Windows 11](https://www.microsoft.com/en-us/software-download/windows11) and [Windows 10](https://www.microsoft.com/en-us/software-download/windows10ISO) provide manual download paths. Temporary Microsoft URLs are not locked or automated here.
- [SuperISOUpdater](https://github.com/JoshuaVandaele/SuperISOUpdater) covers many ISO sources and is GPL-2.0-or-later. [Fido](https://github.com/pbatard/Fido) automates Microsoft links and is GPL-3.0-or-later. [multi-boot-usb](https://github.com/asudbring/multi-boot-usb) organizes USB content without a declared GitHub license. [ventoy-multiboot-toolkit](https://github.com/rngauf/ventoy-multiboot-toolkit) is MIT licensed. These were reviewed for approach; no code or runtime dependency was copied.

## Limits

Phase 1 supports macOS, Windows, and Linux with Node.js 22+. Checks use network metadata and can fail when an official source is unavailable or its format changes. Large binaries are never part of the test suite. No USB is formatted, modified, or populated by the TypeScript CLI. The PowerShell downloader in `drive/Tools/Scripts/` remains independent and retains its existing invocation and config format.
