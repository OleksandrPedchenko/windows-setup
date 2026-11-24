# windows-setup

A small, configuration-driven PowerShell utility that downloads Windows application installers through WinGet and optional ISO files from Google Drive. It does not install applications.

## Requirements

- Windows with Windows PowerShell 5.1 or later.
- [WinGet](https://learn.microsoft.com/en-us/windows/package-manager/winget/) with the `download` command available.
- Network access to the WinGet source and the installer publishers.

## Use

From a local copy of this repository:

```powershell
powershell.exe -NoProfile -File .\download.ps1
powershell.exe -NoProfile -File .\download.ps1 -Destination 'C:\Installers' -Architecture arm64
```

The default destination is `downloads` beside the script. The default architecture is `x64`; accepted values are `x86`, `x64`, `arm`, and `arm64`. Use `-ConfigPath` to supply another JSON file. The script prints each successful version and a final table of package names, versions, filenames, and statuses. It continues after individual failures and exits with code 1 if any package fails.

To run directly from the public repository in a Windows PowerShell console, without cloning or saving the files yourself:

```powershell
irm 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/download.ps1' -UseBasicParsing | iex
```

This fetches the public `packages.json` from the same repository. If `packages.encrypted.json` is published beside it, the script asks for a passphrase: enter it to include private packages, or press Enter to download only the public ones. Installers go to `downloads` in the current directory. To pass parameters, invoke the fetched text as a script block:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/download.ps1' -UseBasicParsing))) -Destination 'C:\Installers' -Architecture arm64
```

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

`source` identifies the download provider. `winget` and `google-drive` are implemented; direct URLs and GitHub Releases remain future options. WinGet selects the latest version for the requested architecture. The script resolves that version with `winget show`, pins the same version for `winget download`, and leaves WinGet's installer hash verification enabled. It uses `--skip-dependencies` to download only the listed application's installer.

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

You can publish `packages.encrypted.json` beside the script for the same choice with the remote one-liner. Use `-EncryptedConfigPath` if the encrypted file is elsewhere. A wrong passphrase stops the run before any download. Encryption uses PowerShell's AES secure-string format with a random salt, 600,000 PBKDF2 iterations, and an HMAC check for tampering. Use a strong, unique passphrase: anyone with the encrypted file can try guesses offline. This protects the file ID in the configuration; it does not change Google Drive's sharing permissions or invalidate any previously exposed link.

## Validation and limits

Run `pwsh -NoProfile -File ./validate.ps1` on macOS, Linux, or Windows to parse the PowerShell scripts with the AST parser and validate the JSON structure. Run `pwsh -NoProfile -File ./tests/google-drive.ps1` and `pwsh -NoProfile -File ./tests/encrypted-config.ps1` for local stub tests. GitHub Actions runs all checks on pushes and pull requests. These checks do **not** verify real WinGet behavior, a complete Google Drive ISO download, installer availability, checksum validation, or Windows PowerShell 5.1 execution. Those require testing on Windows.

WinGet must support `download`; older installations may need an App Installer update. Some packages may not provide an installer for a requested architecture or may fail because of network, publisher, or source conditions. WinGet output is parsed to report a version, so the version field depends on `winget show` presenting its `Version:` field in English. Existing installers in the destination may be replaced by WinGet; the summary includes files created or changed by each successful download.
