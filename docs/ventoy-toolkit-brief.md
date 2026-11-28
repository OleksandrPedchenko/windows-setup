# Ventoy Toolkit — Declarative, reproducible multiboot USB repository

## 1. Project overview

Create a new open-source repository for maintaining and reproducing a customized Ventoy-based multiboot USB toolkit.

The goal is to treat a bootable USB drive as declarative configuration stored in Git, rather than as a manually maintained collection of ISO files.

The repository should allow me to:

- Maintain an organized collection of operating system installers, recovery environments, diagnostic utilities, portable applications and drivers.
- Define downloadable files using lightweight JSON descriptors instead of committing large binaries to Git.
- Discover newer versions of these files from official upstream sources.
- Detect refreshed ISO images even when their release version has not changed.
- Download and verify files on demand.
- Maintain a reusable local download cache.
- Reproduce the entire directory structure on a new Ventoy drive.
- Update an existing drive without unnecessarily downloading or copying unchanged files.
- Eventually automate upstream update checks using a scheduled job running on my homelab server.

The project should be cross-platform, with macOS, Windows and Linux support. My primary development environment is macOS on Apple Silicon, and my homelab runs Proxmox.

Use Node.js and TypeScript. Prefer native Node.js capabilities and minimal dependencies.

Do not introduce a database, web server, frontend, complex plugin framework or unnecessary abstractions.

## 2. Repository structure

The most important architectural decision is that the repository itself mirrors the intended USB drive directory structure.

For example:

```text
ventoy-toolkit/
├── drive/
│   ├── ISO/
│   │   ├── Windows/
│   │   │   ├── Windows11.iso.json
│   │   │   └── Windows10.iso.json
│   │   ├── Linux/
│   │   │   └── Ubuntu.iso.json
│   │   ├── Servers/
│   │   │   └── Proxmox.iso.json
│   │   ├── Recovery/
│   │   │   ├── HirensBootCD.iso.json
│   │   │   ├── Rescuezilla.iso.json
│   │   │   └── SystemRescue.iso.json
│   │   └── Diagnostics/
│   │       ├── GParted.iso.json
│   │       └── MemTest86Plus.iso.json
│   ├── Tools/
│   │   ├── Drivers/
│   │   ├── PortableApps/
│   │   └── Scripts/
│   └── ventoy/
│       ├── ventoy.json
│       ├── themes/
│       ├── unattended/
│       └── injection/
├── src/
│   ├── providers/
│   ├── commands/
│   └── cli.ts
├── tests/
├── docs/
├── toolkit.lock.json
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

This structure is illustrative. Adjust it where necessary, but preserve the central design.

The `drive/` directory represents the desired contents of the USB drive.

Everything outside this directory is tooling, documentation or development infrastructure.

When preparing a drive:

- `Windows11.iso.json` becomes `Windows11.iso`.
- `Proxmox.iso.json` becomes `Proxmox.iso`.
- Regular scripts, configuration files and themes are copied normally.
- The descriptor files themselves are not copied to the prepared drive.
- Relative directory paths are preserved.

Do not maintain a separate centralized manifest containing a duplicate list of downloadable files. Discover descriptors recursively from the directory structure.

Adding a new ISO should normally require adding only one JSON descriptor.

Moving a descriptor to a different directory should change its destination path accordingly.

## 3. Downloadable file descriptors

Define a simple, extensible JSON descriptor format.

Example Windows descriptor:

```json
{
  "name": "Windows 11",
  "description": "Official Windows 11 installation media",
  "source": {
    "provider": "microsoft",
    "product": "windows11",
    "release": "latest",
    "language": "en-US",
    "architecture": "x64"
  },
  "estimatedSizeBytes": 7000000000,
  "ventoy": {
    "alias": "Windows 11",
    "class": "windows",
    "tip": "Install Windows 11 on a modern PC"
  },
  "profiles": ["essential", "standard", "full"]
}
```

Example GitHub Releases descriptor:

```json
{
  "name": "Rescuezilla",
  "description": "Disk imaging, backup and recovery",
  "source": {
    "provider": "github-release",
    "repository": "rescuezilla/rescuezilla",
    "release": "latest",
    "assetPattern": "rescuezilla.*64bit.*\\.iso$"
  },
  "ventoy": {
    "alias": "Rescuezilla",
    "class": "recovery",
    "tip": "Create and restore disk backups"
  },
  "profiles": ["standard", "full"]
}
```

Example checksum index descriptor:

```json
{
  "name": "Proxmox VE",
  "source": {
    "provider": "checksum-index",
    "baseUrl": "https://download.cdn.proxmox.com/iso/",
    "checksumFile": "SHA256SUMS",
    "assetPattern": "^proxmox-ve_(\\d+\\.\\d+-\\d+)\\.iso$"
  },
  "ventoy": {
    "alias": "Proxmox VE",
    "class": "server",
    "tip": "Install Proxmox Virtual Environment"
  },
  "profiles": ["essential", "standard", "full"]
}
```

These are proposed descriptor examples. Verify actual upstream URLs, filename patterns, architectures and supported release mechanisms before using them.

The descriptor format should support:

- Human-readable name and description.
- Source provider and provider-specific configuration.
- Latest or pinned release selection.
- Language and architecture where applicable.
- Estimated file size.
- Optional expected checksum.
- Optional Ventoy-specific metadata.
- Optional collection profiles.
- Official product or documentation URL where useful.

Validate descriptors before performing network or filesystem operations.

Keep filenames stable on the prepared USB so that Ventoy configuration does not break whenever upstream filenames change.

The source filename and destination filename should be treated as separate concepts.

Although the initial focus is ISO files, avoid unnecessarily restricting the format to ISOs. Eventually, it should support descriptors such as:

```text
Windows11.iso.json
SteamDeckRecovery.img.json
Rufus.exe.json
CrystalDiskInfo.zip.json
IntelStorageDrivers.zip.json
```

Use an explicit descriptor detection convention so that ordinary JSON configuration files, particularly `ventoy.json`, are not accidentally interpreted as download descriptors.

## 4. Download providers

Implement lightweight, reusable download providers.

A provider should understand how to discover an upstream release and obtain the metadata required to download it.

Providers should not know anything about:

- Ventoy configuration.
- Physical USB drives.
- Directory synchronization.
- Collection profiles.
- Download progress.
- Local cache management.
- Git operations.

Those responsibilities belong to shared application logic.

Prefer generic providers over product-specific providers where practical.

Potential providers:

| Provider | Responsibility |
|---|---|
| `direct` | Resolve a known direct download URL |
| `github-release` | Resolve release assets through GitHub's API |
| `checksum-index` | Discover releases through published checksum files |
| `directory-index` | Discover files in official HTTP download directories |
| `microsoft` | Discover official Windows installation media |
| `sourceforge` | Discover files published through SourceForge |
| `manual` | Describe files requiring manual download |

A possible normalized provider result:

```typescript
interface ResolvedArtifact {
  version?: string;
  filename: string;
  sha256?: string;
  sizeBytes?: number;
  publishedAt?: string;
  downloadUrl?: string;
  productPageUrl?: string;
}
```

Consider separating metadata resolution from download URL resolution, particularly for sources with temporary or expiring download URLs.

For example:

```typescript
interface ArtifactProvider<TSource> {
  resolveMetadata(
    source: TSource
  ): Promise<ResolvedArtifact>;

  resolveDownloadUrl?(
    source: TSource,
    artifact: ResolvedArtifact
  ): Promise<string>;
}
```

Treat this interface as a starting point, not a mandatory design. Keep it as simple as practical.

Use TypeScript discriminated unions for provider-specific configuration where appropriate.

Do not implement inheritance hierarchies, dependency injection containers or dynamic plugin loading unless there is a demonstrated need.

### Existing projects to investigate

Before implementing complex providers from scratch, investigate:

- https://github.com/JoshuaVandaele/SuperISOUpdater
- https://github.com/pbatard/Fido
- https://github.com/asudbring/multi-boot-usb
- https://github.com/rngauf/ventoy-multiboot-toolkit

SuperISOUpdater is particularly relevant because it already implements upstream discovery and downloading for many operating systems.

Investigate whether its approaches can be reused, adapted or integrated. Check licensing compatibility before copying or adapting implementation code.

Do not blindly introduce these projects as runtime dependencies.

## 5. Official Microsoft Windows images

Supporting official Windows ISO images is important.

The project should eventually support at least:

- Windows 11 x64.
- Windows 10 x64, while official images remain available.
- Configurable language selection.
- Potentially Windows 11 ARM64 as a separate descriptor.

Investigate Microsoft's official software download pages and existing implementations such as Fido and SuperISOUpdater.

The provider should ideally support:

- Discovering the currently published Windows release.
- Retrieving official SHA-256 checksums.
- Detecting refreshed installation media.
- Obtaining official download URLs on demand.
- Providing a manual download fallback.

Microsoft may publish refreshed ISO images without changing the Windows release name.

For example, the release might remain `25H2`, while the official ISO checksum changes.

Therefore, do not rely exclusively on version numbers or filenames when detecting updates.

Microsoft download URLs may expire. Do not persist temporary URLs in Git or treat them as permanent identifiers.

Do not use unofficial Windows ISO mirrors or modified installation images.

If Microsoft's automation mechanisms are unreliable, implement a clearly documented manual fallback rather than allowing the Microsoft provider to block the entire project.

Investigate this provider carefully instead of inventing undocumented API behavior.

## 6. Lock file and version tracking

Maintain a generated `toolkit.lock.json` file committed to Git.

The descriptors define what we want to maintain. The lock file records the resolved upstream versions and metadata.

Example:

```json
{
  "schemaVersion": 1,
  "artifacts": {
    "ISO/Windows/Windows11.iso": {
      "version": "25H2",
      "filename": "Win11_25H2_English_x64.iso",
      "sha256": "...",
      "sizeBytes": 7000000000
    },
    "ISO/Servers/Proxmox.iso": {
      "version": "9.3-1",
      "filename": "proxmox-ve_9.3-1.iso",
      "sha256": "...",
      "sizeBytes": 2000000000
    }
  }
}
```

These values are illustrative, not verified release information.

The lock file should:

- Be deterministic.
- Have stable ordering.
- Produce readable Git diffs.
- Record upstream versions and checksums when available.
- Avoid storing temporary download URLs or credentials.
- Avoid timestamp changes when no meaningful metadata has changed.
- Preserve existing entries when an upstream check fails.
- Support both pinned versions and tracking the latest release.

A lock file must not imply that the actual binary has been downloaded or verified.

Also account for the fact that some upstream vendors remove older release images. If a locked version is no longer available, report the problem instead of silently downloading a different version.

## 7. Update detection

Implement a lightweight update-checking command that does not download the actual ISO files.

It should discover all configured descriptors, query their providers and compare the resulting metadata against the lock file.

Support statuses such as:

- Up to date.
- New version available.
- Same version, refreshed image.
- Previously unresolved.
- Upstream image changed.
- Possible downgrade.
- Manual check required.
- Upstream source unavailable.
- Unable to determine whether the image changed.

Prefer official SHA-256 checksums for identifying exact image changes.

When checksums are unavailable, consider available upstream identifiers, release asset metadata, ETag or Last-Modified headers where appropriate. Clearly distinguish weaker update indicators from checksum-based comparisons.

Do not assume that identical version strings prove that two ISO files are identical.

Do not assume that every changed version is newer.

A provider failure must not be reported as "up to date."

The default update check should be read-only.

An explicit option should allow writing newly resolved metadata into the lock file.

Example commands:

```bash
npm run toolkit -- check-updates
npm run toolkit -- check-updates --write-lock
npm run toolkit -- check-updates --report json
npm run toolkit -- check-updates --report markdown
```

The exact CLI syntax may be adjusted.

The report should include an understandable summary of:

- Existing versions.
- Newly discovered versions.
- Changed checksums.
- Estimated download sizes, where known.
- Provider failures.
- Manual actions required.

## 8. Downloading and local cache

Implement shared downloading logic independent of individual providers.

Do not download ISO files directly onto the USB drive.

Maintain a configurable local download cache outside the Git repository.

Example:

```text
~/.cache/ventoy-toolkit/
├── artifacts/
│   ├── windows11/
│   ├── windows10/
│   ├── proxmox/
│   └── rescuezilla/
└── temporary/
```

The cache should allow:

- Reusing previously downloaded images.
- Preparing multiple USB drives without repeated downloads.
- Downloading and verifying updates before replacing existing files.
- Retaining previous verified versions when new downloads fail.
- Importing manually downloaded files.

Download requirements:

- Stream large files to disk.
- Never load entire ISO files into memory.
- Display progress where practical.
- Handle HTTP and network failures.
- Use temporary `.part` files.
- Verify official checksums when available.
- Check expected file sizes where available.
- Only promote a file into the completed cache after successful verification.
- Do not overwrite a known-good cached artifact with an incomplete download.
- Keep credentials and temporary download URLs out of logs where appropriate.

Consider download resumption as a later enhancement if implementing it reliably adds unnecessary initial complexity.

If an official checksum is unavailable, clearly report that upstream integrity verification was not possible. Calculating a local checksum is still useful for subsequent integrity checks but is not equivalent to verification against an official checksum.

Provide a way to import an already downloaded ISO into the cache rather than downloading it again.

## 9. Build and USB synchronization

Separate downloading from deployment.

The project should be able to prepare the desired directory structure either in a local output directory or directly on an existing Ventoy data partition.

For example:

```bash
npm run toolkit -- build --output ./dist
```

Or:

```bash
npm run toolkit -- sync --target /Volumes/Ventoy
```

The initial implementation should assume that Ventoy itself has already been installed on the USB drive.

Do not implement automatic USB formatting, partitioning or bootloader installation in the initial version.

These operations are destructive and platform-specific.

Synchronization should:

- Validate the destination.
- Determine which artifacts are missing or outdated.
- Reuse cached files where possible.
- Check available storage.
- Copy only required files.
- Preserve unrelated user files.
- Verify copied files where appropriate.
- Record successfully deployed versions.
- Support a dry-run mode.
- Avoid destructive operations by default.

Provide an explicit preview of files that would be replaced or removed.

Never delete unrelated files simply because they are absent from the repository.

For updates where insufficient free space prevents safely staging a replacement alongside the existing ISO, ensure that the new artifact is already downloaded and verified in the local cache. Report the situation and require explicit permission before removing the existing USB copy.

## 10. Installed drive state

Keep the repository's desired state separate from the actual state of a physical USB drive.

Consider maintaining a small generated file on each prepared USB:

```text
.toolkit/installed.json
```

This file should record:

- Installed artifact paths.
- Actual installed versions.
- Actual checksums.
- Selected collection profile, if applicable.
- Last successful synchronization.

This would allow multiple USB drives to be maintained independently against the same repository.

For example, my everyday 32 GB USB might contain an older Proxmox installer while my future 128 GB USB contains the latest version.

Updating the repository lock file must not imply that any physical USB drive has been updated.

Avoid trusting the installed-state file blindly. Provide a verification command that can check actual files when required.

## 11. Ventoy configuration

Maintain a base `ventoy.json` in the repository.

Initially, configure useful Global Control settings, including:

- TreeView navigation.
- Restricting bootable image discovery to `/ISO`.
- Ignoring macOS AppleDouble metadata files.
- Enabling the secondary boot menu.
- Avoiding automatic boot timeouts.
- Explicitly controlling Windows installation requirement bypass behavior.

Verify the exact configuration properties against the official Ventoy documentation:

https://www.ventoy.net/en/doc_start.html

Eventually, automatically generate or merge selected Ventoy plugin sections using descriptor metadata.

For example:

```json
"ventoy": {
  "alias": "Windows 11",
  "class": "windows",
  "tip": "Official Windows installation media"
}
```

Could generate the corresponding Menu Alias, Menu Class and Menu Tip entries.

Future support could include:

- Auto Installation profiles.
- Injection archives.
- Persistence configuration.
- Themes and icons.
- Directory aliases.

Avoid overwriting manually maintained Ventoy configuration unexpectedly.

Clearly define which configuration sections are generated and which are manually maintained.

Generated entries should correspond only to files included in the selected build or drive profile.

## 12. Collection profiles and storage planning

I currently have a 32 GB USB drive but plan to use a larger 128 GB drive eventually.

The repository should not be tied to one physical drive capacity.

Consider supporting profiles such as:

- `essential`: Windows installers, essential recovery tools and Proxmox.
- `standard`: Additional Linux distributions and recovery utilities.
- `full`: Extended diagnostics, portable applications, drivers and other tools.

Descriptors may declare profile membership.

The toolkit should eventually support calculating required storage before downloading or deploying files.

Example:

```bash
npm run toolkit -- plan --profile essential
```

Expected information:

- Selected artifacts.
- Total estimated download size.
- Actual known file sizes.
- Files already available in the cache.
- Required destination storage.
- Missing metadata or uncertain size estimates.

Use actual available filesystem space when validating a physical drive rather than relying exclusively on its advertised capacity.

Profiles should remain optional. Do not introduce an elaborate profile inheritance system.

## 13. CLI experience

Design a simple and consistent CLI.

Potential commands:

```bash
toolkit list
toolkit status
toolkit validate
toolkit plan
toolkit check-updates
toolkit download
toolkit import
toolkit verify
toolkit build
toolkit sync
toolkit cleanup
```

Example usage:

```bash
# Discover configured artifacts
npm run toolkit -- list

# Check upstream versions without downloading
npm run toolkit -- check-updates

# Update the lock file
npm run toolkit -- check-updates --write-lock

# Download a selected artifact
npm run toolkit -- download windows11

# Import an existing ISO
npm run toolkit -- import windows11 ~/Downloads/Windows11.iso

# Download the essential collection
npm run toolkit -- download --profile essential

# Preview USB synchronization
npm run toolkit -- sync --target /Volumes/Ventoy --dry-run

# Synchronize an existing drive
npm run toolkit -- sync --target /Volumes/Ventoy

# Verify installed artifacts
npm run toolkit -- verify --target /Volumes/Ventoy
```

These commands are proposals. Not all of them need to be implemented immediately.

Prefer understandable terminal output, useful error messages, reasonable exit codes and machine-readable output where automation would benefit from it.

Avoid building a sophisticated interactive terminal UI initially.

## 14. Initial artifact collection

Investigate official upstream sources and prepare descriptors for a practical initial collection.

### Windows

- Windows 11.
- Windows 10.

### Linux

- Ubuntu Desktop.
- Linux Mint.
- Debian.

### Servers and homelab

- Proxmox VE.
- Potentially Proxmox Backup Server.

### Recovery

- Hiren's BootCD PE.
- Rescuezilla.
- Clonezilla.
- SystemRescue.

### Diagnostics

- GParted Live.
- MemTest86+.

### Future additions

- Steam Deck recovery image.
- Additional hardware diagnostics.
- Bootloader recovery tools.
- Malware recovery utilities.
- Portable Windows applications.
- Storage and network drivers.

Not all images need to fit on my current 32 GB drive.

Use official upstream sources and verify actual filenames, architectures, release selection behavior and checksums.

Do not add unverified download URLs just to make the collection look complete.

Use manual descriptors for artifacts whose automated discovery is not implemented yet.

Avoid downloading all of these files during development or testing.

## 15. Future homelab automation

The toolkit should eventually be executable as a scheduled job on my Proxmox homelab.

I already run Node.js jobs using systemd timers, so a similar deployment model would be suitable.

The intended workflow is:

1. Pull the latest repository changes.
2. Run metadata-only upstream update checks.
3. Detect new versions or refreshed images.
4. Update the lock file when meaningful changes are discovered.
5. Optionally create a Git commit and open or update a GitHub pull request using the `gh` CLI.
6. Optionally send Telegram notifications.
7. Optionally download and verify approved updates into a persistent server-side cache.

The server could eventually maintain an always-ready collection of installation images accessible over the local network.

This would allow me to prepare a new USB drive using locally cached files rather than downloading everything from the internet again.

Keep the core toolkit independent of cron, systemd, GitHub Actions, Telegram and Proxmox.

These should simply be optional ways to invoke or integrate with the CLI.

GitHub Actions could also be used as an alternative scheduler, but it is not a requirement.

For now, document the proposed automation approach as a follow-up rather than implementing the entire deployment infrastructure.

## 16. Testing and reliability

Add focused automated tests for the implemented functionality.

Prioritize:

- Descriptor discovery.
- Descriptor schema validation.
- Destination path derivation.
- Provider response parsing.
- Release asset selection.
- Version comparison.
- Same-version checksum changes.
- Deterministic lock file generation.
- Handling provider failures.
- Download integrity verification.
- Safe synchronization behavior.

Use small local fixture files and mocked upstream responses.

Tests must not download multi-gigabyte ISO images.

Where useful, provide separate optional integration tests against actual upstream endpoints.

An upstream outage or changed HTML structure should result in a clear provider error rather than misleading output.

Ensure that external metadata cannot cause downloads to escape the intended cache or destination directory.

## 17. Documentation

Create a useful README covering:

- Project motivation.
- Architecture and repository structure.
- Installation and prerequisites.
- How JSON descriptors work.
- How to add a new ISO.
- Supported providers.
- Supported artifacts and current limitations.
- How to check for updates.
- How to download or import an ISO.
- How to prepare a Ventoy drive.
- How to update an existing drive.
- Cache location and configuration.
- Safety considerations.
- Future roadmap.

Include examples that can actually be executed with the implemented functionality.

Distinguish implemented functionality from planned functionality.

Document the descriptor schema and how to implement a new provider.

Ensure large binaries, generated output directories, caches, credentials and temporary downloads are excluded from Git.

## 18. Implementation approach and phases

Do not attempt to implement every feature described above in one pass.

The overall description establishes the intended architecture and direction. Implement it incrementally.

### Phase 1 — Repository foundation and working MVP

Focus on:

- TypeScript project initialization.
- Repository and drive directory structure.
- Descriptor schema and validation.
- Recursive descriptor discovery.
- Basic provider contract.
- Direct URL provider.
- GitHub Releases provider.
- Checksum-index provider.
- Manual provider.
- Deterministic lock file.
- Metadata-only update checking.
- Basic shared streaming downloader.
- SHA-256 verification.
- Configurable local download cache.
- Initial verified example descriptors.
- Focused automated tests.
- README and architectural documentation.

The MVP should demonstrate an end-to-end workflow:

```text
Descriptor
    ↓
Discover upstream release
    ↓
Resolve metadata
    ↓
Compare against lock file
    ↓
Download on demand
    ↓
Verify checksum
    ↓
Store in local cache
```

### Phase 2 — Specialized download providers

- Microsoft official Windows images.
- SourceForge.
- Additional upstream discovery mechanisms as required.
- Manual artifact imports.
- More comprehensive initial ISO collection.

### Phase 3 — Drive preparation

- Build output generation.
- Storage planning.
- Collection profiles.
- USB synchronization.
- Installed drive state.
- Safe update and replacement behavior.

### Phase 4 — Ventoy integration

- Generate plugin configuration from descriptors.
- Themes and menu customization.
- Windows unattended installation profiles.
- Injection and driver support.

### Phase 5 — Automation

- Homelab deployment.
- systemd service and timer.
- Automated GitHub pull requests.
- Telegram notifications.
- Persistent server-side cache maintenance.
- Optional GitHub Actions integration.
- Optional QEMU boot testing.

## 19. Engineering principles

Throughout implementation:

- Prefer simple functions and explicit data structures.
- Avoid premature abstractions.
- Avoid implementing speculative features.
- Prefer official upstream sources.
- Reuse generic provider implementations.
- Keep network resolution separate from downloading.
- Keep downloading separate from USB deployment.
- Never silently perform destructive filesystem operations.
- Never commit large downloadable artifacts into Git.
- Make failures visible and understandable.
- Do not fabricate upstream endpoints, checksums or release metadata.
- Keep the repository usable even when individual providers temporarily fail.
- Preserve compatibility with macOS, Windows and Linux.

## 20. Initial task

Start by reviewing the proposed architecture critically and identifying any important gaps, unnecessary complexity or conflicting requirements.

Investigate the relevant existing open-source projects and official upstream download mechanisms.

Make pragmatic architectural decisions, especially around descriptor detection, provider contracts, version tracking, cache identity and lock file semantics.

Then initialize the repository and implement **Phase 1 only**.

Do not proceed into subsequent phases without my explicit instruction.

At the end of Phase 1, provide:

- Summary of implemented functionality.
- Actual repository structure.
- Architectural decisions and trade-offs.
- Supported providers and artifacts.
- Commands to try the implemented workflow.
- Automated test results.
- Known limitations.
- Recommended next steps for Phase 2.

The result should be a small, working, extensible project rather than a large collection of speculative scaffolding.