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

This fetches the public `packages.json` from the same repository. Installers go to `downloads` in the current directory. To pass parameters, invoke the fetched text as a script block:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/OleksandrPedchenko/windows-setup/main/download.ps1' -UseBasicParsing))) -Destination 'C:\Installers' -Architecture arm64
```

Inspect the [script](https://github.com/OleksandrPedchenko/windows-setup/blob/main/download.ps1) before using `iex`: it executes remote code immediately. For a reproducible version, download both files from a specific commit and run the local script.

## Configuration

Edit `packages.json` to add or remove packages:

```json
{
  "packages": [
    { "name": "VLC", "source": "winget", "id": "VideoLAN.VLC" },
    { "name": "My ISO", "source": "google-drive", "id": "YOUR_FILE_ID", "filename": "MyFile.iso", "version": "YOUR_VERSION" }
  ]
}
```

`source` identifies the download provider. `winget` and `google-drive` are implemented; direct URLs and GitHub Releases remain future options. WinGet selects the latest version for the requested architecture. The script resolves that version with `winget show`, pins the same version for `winget download`, and leaves WinGet's installer hash verification enabled. It uses `--skip-dependencies` to download only the listed application's installer.

A Google Drive entry points to a **single file ID**, not its parent folder. Keep private links in `packages.local.json`, which is ignored by Git, and run `powershell.exe -NoProfile -File .\download.ps1 -ConfigPath .\packages.local.json`. For remote script execution with private local configuration, pass `-ConfigPath 'C:\path\packages.local.json'` using the script-block form above. The `version` value is supplied by the configuration, not verified against a software publisher. Google Drive downloads do not receive WinGet checksum verification. The script rejects an empty response or an HTML warning page instead of saving it as an ISO. The Drive file must remain downloadable to the user running the script.

## Validation and limits

Run `pwsh -NoProfile -File ./validate.ps1` on macOS, Linux, or Windows to parse the PowerShell scripts with the AST parser and validate the JSON structure. Run `pwsh -NoProfile -File ./tests/google-drive.ps1` for a local stub test of the Drive file handling. GitHub Actions runs both on pushes and pull requests. These checks do **not** verify real WinGet behavior, a complete Google Drive ISO download, installer availability, checksum validation, or Windows PowerShell 5.1 execution. Those require testing on Windows.

WinGet must support `download`; older installations may need an App Installer update. Some packages may not provide an installer for a requested architecture or may fail because of network, publisher, or source conditions. WinGet output is parsed to report a version, so the version field depends on `winget show` presenting its `Version:` field in English. Existing installers in the destination may be replaced by WinGet; the summary includes files created or changed by each successful download.
