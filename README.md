# windows-setup

This repository contains a Ventoy artifact toolkit and a configuration-driven PowerShell utility for downloading Windows application installers. The PowerShell utility uses WinGet, µTorrent Classic's publisher, and optional Google Drive ISO files; it does not install applications.

The repository uses `drive/` as the future Ventoy USB content tree. The existing downloader lives in `drive/Tools/Scripts/`. A separate TypeScript toolkit now discovers artifact descriptors, checks upstream metadata, and downloads verified files into a local cache. USB build and sync are planned in [next steps](docs/next-steps.md). The original [project brief](docs/ventoy-toolkit-brief.md) is saved for reference.

## Ventoy toolkit (Phase 1)

Requires Node.js 22 or later. From the repository root:

```bash
npm ci
npm run toolkit -- validate
npm run toolkit -- list
npm run toolkit -- check-updates
npm run --silent toolkit -- check-updates --report json
npm run toolkit -- check-updates --write-lock
npm run toolkit -- download ISO/Servers/Proxmox.iso
```

`check-updates` is read-only unless `--write-lock` is given. It reads only metadata and never downloads an ISO. `download` requires a matching lock entry, resolves the source again, and places the file in a cache outside Git. Set `VENTOY_TOOLKIT_CACHE` or pass `--cache PATH` to choose the cache. The default is `~/.cache/ventoy-toolkit` on macOS/Linux and `%LOCALAPPDATA%\ventoy-toolkit` on Windows. Large downloads stream to temporary `.part` files and are promoted only after size and SHA-256 checks. There is no resume support yet.

The current descriptors are Proxmox VE (official checksum index), Rescuezilla (GitHub release digest), and Windows 10/11 English x64 (official Microsoft pages and download service). Windows metadata checks are automatic. `download` requests a fresh Microsoft ISO link, but Microsoft may reject automated link generation; in that case the CLI prints the official page for manual download. No command currently builds or synchronizes a USB drive. See the [toolkit guide](docs/toolkit.md) for descriptor format, provider behavior, lock semantics, and limitations. The repository is available under the [MIT license](LICENSE).

## Requirements

- Windows with Windows PowerShell 5.1 or later.
- [WinGet](https://learn.microsoft.com/en-us/windows/package-manager/winget/) with the `download` command available.
- Network access to the WinGet source and the installer publishers.

## Use

From a local copy of this repository:

```powershell
powershell.exe -NoProfile -File .\drive\Tools\Scripts\download.ps1
powershell.exe -NoProfile -File .\drive\Tools\Scripts\download.ps1 -Destination 'C:\Installers' -Architecture arm64
powershell.exe -NoProfile -File .\drive\Tools\Scripts\download.ps1 -CheckOnly
```

The default destination is `downloads` beside the script (`drive/Tools/Scripts/downloads` in a local clone). The default architecture is `x64`; accepted values are `x86`, `x64`, `arm`, and `arm64`. Use `-ConfigPath` to supply another JSON file. The script prints each successful version and a final table of package names, versions, filenames, statuses, and average download speeds. It continues after individual failures and exits with code 1 if any package fails.

Direct downloads (the ISO and uTorrent Classic) show live transfer speed in MiB/s while downloading. WinGet shows its own download progress; the summary calculates average speed from the downloaded installer size and transfer time. Preview mode does not show a speed.

`-CheckOnly` previews the same package selection without creating the destination folder or downloading installers. It reads the latest WinGet version and installer metadata, resolves the uTorrent Classic release version and hash, and checks the Drive file's response headers, filename, and size. WinGet filenames shown in this preview are inferred from installer URLs and may differ from the saved names. Drive versions come from the encrypted configuration. Availability and checksum verification are confirmed only during the actual download.

To run directly from the public repository in a Windows PowerShell console, without cloning or saving the files yourself:

```powershell
irm 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/drive/Tools/Scripts/download.ps1' -UseBasicParsing | iex
```

This fetches the public `drive/Tools/Scripts/packages.json` and encrypted `drive/Tools/Scripts/packages.encrypted.json` from the same repository. The script asks for a passphrase: enter it to include the private ISO, or press Enter to download only the public packages. Installers go to `downloads` in the current directory.

After the passphrase prompt, the script shows a numbered list of available packages. Enter numbers separated by commas (for example, `1,3`) to download or preview only those packages. Press Enter to select all listed packages. The private ISO appears in the list only if you entered its passphrase. Invalid numbers stop the run before any downloads.

To pass flags, fetch the same script into a variable and invoke it as a script block. For example, run the first line, then choose **one** of the commands below:

```powershell
$setup = irm 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/drive/Tools/Scripts/download.ps1' -UseBasicParsing
& ([scriptblock]::Create($setup)) -CheckOnly
& ([scriptblock]::Create($setup)) -Destination 'C:\Installers'
& ([scriptblock]::Create($setup)) -Destination 'C:\Installers' -Architecture arm64 -CheckOnly
```

`-CheckOnly` shows the versions and files without downloading. The passphrase prompt appears in both preview and download modes. Plain `iex` runs with default settings; use the script block form for parameters.

Inspect the [script](https://github.com/OleksandrPedchenko/windows-setup/blob/main/drive/Tools/Scripts/download.ps1) before using `iex`: it executes remote code immediately. For a reproducible version, download both files from a specific commit and run the local script.

## Configuration

Edit the public `drive/Tools/Scripts/packages.json` to add or remove WinGet packages:

```json
{
  "packages": [
    { "name": "VLC", "source": "winget", "id": "VideoLAN.VLC" }
  ]
}
```

Keep the Drive entry in the ignored `drive/Tools/Scripts/packages.local.json`:

```json
{
  "packages": [
    { "name": "My ISO", "source": "google-drive", "id": "YOUR_FILE_ID", "filename": "MyFile.iso", "version": "YOUR_VERSION" }
  ]
}
```

`source` identifies the download provider. WinGet selects the latest version for the requested architecture. The script resolves that version with `winget show`, pins the same version for `winget download`, and leaves WinGet's installer hash verification enabled. It uses `--skip-dependencies` to download only the listed application's installer. WinGet also generates YAML manifests; the script downloads each package into a temporary folder, moves only installer files into the destination, and removes the temporary folder and YAML files.

Steam and AnyDesk use their x86 WinGet installers because those packages currently publish x86 installers only. TeamViewer selects its EXE (`nullsoft`) installer instead of its ZIP. An explicit `-Architecture` argument overrides package defaults; a package without that architecture will fail while the others continue.

Signal uses WinGet ID `OpenWhisperSystems.Signal`. µTorrent Classic uses the publisher's stable download endpoint:

```json
{ "name": "uTorrent Classic", "source": "utorrent-classic", "url": "https://download-new.utorrent.com/endpoint/utorrent/os/windows/track/stable" }
```

The µTorrent source reads the redirected release URL to report its version and build, and verifies the downloaded installer against the publisher's SHA-256 metadata. The publisher currently provides a Windows installer rather than a separate x64 download, so `-Architecture` does not affect this entry. This source requires its official stable endpoint; other arbitrary direct URLs and GitHub Releases are not supported yet.

A Google Drive entry points to a **single file ID**, not its parent folder. The `version` value is supplied by the configuration, not verified against a software publisher. Google Drive downloads do not receive WinGet checksum verification. The script rejects an empty response or an HTML warning page instead of saving it as an ISO. Drive files must remain anonymously downloadable; this script does not sign in to Google.

### Password-encrypted configuration

To create a portable encrypted configuration from your ignored local file, run this on your own machine. The script prompts twice for a passphrase; do not place it in a command or send it to anyone:

```powershell
powershell.exe -NoProfile -File .\drive\Tools\Scripts\download.ps1 -EncryptConfig -ConfigPath .\drive\Tools\Scripts\packages.local.json -EncryptedConfigPath .\drive\Tools\Scripts\packages.encrypted.json
```

Put `drive/Tools/Scripts/packages.encrypted.json` beside `download.ps1`, then run the script normally. Enter your passphrase to download the public WinGet packages **and** the private ISO, or press Enter to download only the public packages:

```powershell
powershell.exe -NoProfile -File .\drive\Tools\Scripts\download.ps1 -Destination 'C:\Installers'
```

The encrypted file is published beside the script so the remote one-liner offers the same choice. Use `-EncryptedConfigPath` if the encrypted file is elsewhere. A wrong passphrase stops the run before any download. Encryption uses PowerShell's AES secure-string format with a random salt, 600,000 PBKDF2 iterations, and an HMAC check for tampering. Anyone with the encrypted file can try passphrases offline. This protects the file ID in the configuration; it does not change Google Drive's sharing permissions or invalidate any previously exposed link.

Use `-CheckOnly` together with the passphrase prompt to preview both public and private packages, or press Enter to preview only the public ones.

## Validation and limits

Run `pwsh -NoProfile -File ./validate.ps1` on macOS, Linux, or Windows to parse the PowerShell scripts with the AST parser and validate the JSON structure. Run the scripts under `tests/` for local tests; the Google Drive smoke test uses Python's standard library to serve a small local fixture. GitHub Actions runs all checks on pushes and pull requests. These checks do **not** verify real WinGet behavior, a complete Google Drive ISO download, installer availability, checksum validation, or Windows PowerShell 5.1 execution. Those require testing on Windows.

WinGet must support `download`; older installations may need an App Installer update. Some packages may not provide an installer for a requested architecture or may fail because of network, publisher, or source conditions. WinGet output is parsed to report a version, so the version field depends on `winget show` presenting its `Version:` field in English. Existing installers in the destination may be replaced by WinGet; the summary includes files created or changed by each successful download.
