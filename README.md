# windows-setup

A small, configuration-driven PowerShell utility that downloads Windows application installers through WinGet, µTorrent Classic from its publisher, and optional ISO files from Google Drive. It does not install applications.

## Requirements

- Windows with Windows PowerShell 5.1 or later.
- [WinGet](https://learn.microsoft.com/en-us/windows/package-manager/winget/) with the `download` command available.
- Network access to the WinGet source and the installer publishers.

## Use

From a local copy of this repository:

```powershell
powershell.exe -NoProfile -File .\download.ps1
powershell.exe -NoProfile -File .\download.ps1 -Destination 'C:\Installers' -Architecture arm64
powershell.exe -NoProfile -File .\download.ps1 -CheckOnly
```

The default destination is `downloads` beside the script. The default architecture is `x64`; accepted values are `x86`, `x64`, `arm`, and `arm64`. Use `-ConfigPath` to supply another JSON file. The script prints each successful version and a final table of package names, versions, filenames, statuses, and average download speeds. It continues after individual failures and exits with code 1 if any package fails.

Direct downloads (the ISO and uTorrent Classic) show live transfer speed in MiB/s while downloading. WinGet shows its own download progress; the summary calculates average speed from the downloaded installer size and transfer time. Preview mode does not show a speed.

`-CheckOnly` previews the same package selection without creating the destination folder or downloading installers. It reads the latest WinGet version and installer metadata, resolves the uTorrent Classic release version and hash, and checks the Drive file's response headers, filename, and size. WinGet filenames shown in this preview are inferred from installer URLs and may differ from the saved names. Drive versions come from the encrypted configuration. Availability and checksum verification are confirmed only during the actual download.

To run directly from the public repository in a Windows PowerShell console, without cloning or saving the files yourself:

```powershell
irm 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/download.ps1' -UseBasicParsing | iex
```

This fetches the public `packages.json` and encrypted `packages.encrypted.json` from the same repository. The script asks for a passphrase: enter it to include the private ISO, or press Enter to download only the public packages. Installers go to `downloads` in the current directory.

After the passphrase prompt, the script shows a numbered list of available packages. Enter numbers separated by commas (for example, `1,3`) to download or preview only those packages. Press Enter to select all listed packages. The private ISO appears in the list only if you entered its passphrase. Invalid numbers stop the run before any downloads.

To pass flags, fetch the same script into a variable and invoke it as a script block. For example, run the first line, then choose **one** of the commands below:

```powershell
$setup = irm 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/download.ps1' -UseBasicParsing
& ([scriptblock]::Create($setup)) -CheckOnly
& ([scriptblock]::Create($setup)) -Destination 'C:\Installers'
& ([scriptblock]::Create($setup)) -Destination 'C:\Installers' -Architecture arm64 -CheckOnly
```

`-CheckOnly` shows the versions and files without downloading. The passphrase prompt appears in both preview and download modes. Plain `iex` runs with default settings; use the script block form for parameters.

Inspect the [script](https://github.com/OleksandrPedchenko/windows-setup/blob/main/download.ps1) before using `iex`: it executes remote code immediately. For a reproducible version, download both files from a specific commit and run the local script.

## Configuration

Edit the public `packages.json` to add or remove WinGet packages:

```json
{
  "packages": [
    { "name": "VLC", "source": "winget", "id": "VideoLAN.VLC" }
  ]
}
```

Keep the Drive entry in the ignored `packages.local.json`:

```json
{
  "packages": [
    { "name": "My ISO", "source": "google-drive", "id": "YOUR_FILE_ID", "filename": "MyFile.iso", "version": "YOUR_VERSION" }
  ]
}
```

`source` identifies the download provider. WinGet selects the latest version for the requested architecture. The script resolves that version with `winget show`, pins the same version for `winget download`, and leaves WinGet's installer hash verification enabled. It uses `--skip-dependencies` to download only the listed application's installer. WinGet also generates YAML manifests; the script downloads each package into a temporary folder, moves only installer files into the destination, and removes the temporary folder and YAML files.

Signal uses WinGet ID `OpenWhisperSystems.Signal`. µTorrent Classic uses the publisher's stable download endpoint:

```json
{ "name": "uTorrent Classic", "source": "utorrent-classic", "url": "https://download-new.utorrent.com/endpoint/utorrent/os/windows/track/stable" }
```

The µTorrent source reads the redirected release URL to report its version and build, and verifies the downloaded installer against the publisher's SHA-256 metadata. The publisher currently provides a Windows installer rather than a separate x64 download, so `-Architecture` does not affect this entry. This source requires its official stable endpoint; other arbitrary direct URLs and GitHub Releases are not supported yet.

A Google Drive entry points to a **single file ID**, not its parent folder. The `version` value is supplied by the configuration, not verified against a software publisher. Google Drive downloads do not receive WinGet checksum verification. The script rejects an empty response or an HTML warning page instead of saving it as an ISO. Drive files must remain anonymously downloadable; this script does not sign in to Google.

### Password-encrypted configuration

To create a portable encrypted configuration from your ignored local file, run this on your own machine. The script prompts twice for a passphrase; do not place it in a command or send it to anyone:

```powershell
powershell.exe -NoProfile -File .\download.ps1 -EncryptConfig -ConfigPath .\packages.local.json -EncryptedConfigPath .\packages.encrypted.json
```

Put `packages.encrypted.json` beside `download.ps1`, then run the script normally. Enter your passphrase to download the public WinGet packages **and** the private ISO, or press Enter to download only the public packages:

```powershell
powershell.exe -NoProfile -File .\download.ps1 -Destination 'C:\Installers'
```

The encrypted file is published beside the script so the remote one-liner offers the same choice. Use `-EncryptedConfigPath` if the encrypted file is elsewhere. A wrong passphrase stops the run before any download. Encryption uses PowerShell's AES secure-string format with a random salt, 600,000 PBKDF2 iterations, and an HMAC check for tampering. Anyone with the encrypted file can try passphrases offline. This protects the file ID in the configuration; it does not change Google Drive's sharing permissions or invalidate any previously exposed link.

Use `-CheckOnly` together with the passphrase prompt to preview both public and private packages, or press Enter to preview only the public ones.

## Validation and limits

Run `pwsh -NoProfile -File ./validate.ps1` on macOS, Linux, or Windows to parse the PowerShell scripts with the AST parser and validate the JSON structure. Run the scripts under `tests/` for local tests; the Google Drive smoke test uses Python's standard library to serve a small local fixture. GitHub Actions runs all checks on pushes and pull requests. These checks do **not** verify real WinGet behavior, a complete Google Drive ISO download, installer availability, checksum validation, or Windows PowerShell 5.1 execution. Those require testing on Windows.

WinGet must support `download`; older installations may need an App Installer update. Some packages may not provide an installer for a requested architecture or may fail because of network, publisher, or source conditions. WinGet output is parsed to report a version, so the version field depends on `winget show` presenting its `Version:` field in English. Existing installers in the destination may be replaced by WinGet; the summary includes files created or changed by each successful download.
