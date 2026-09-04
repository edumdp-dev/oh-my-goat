# OhMyGoat Coding Agent Installer for Windows
# Verify first: gh attestation verify install.ps1 --repo edumdp-dev/oh-my-goat --signer-workflow edumdp-dev/oh-my-goat/.github/workflows/release-ohmg.yml --source-ref refs/tags/ohmg-v0.0.2 --deny-self-hosted-runners
# Then run: & ([scriptblock]::Create((Get-Content .\install.ps1 -Raw)))
# Or quick: irm https://ohmygoat.vercel.app/install.ps1 | iex
#
# Or with options:
#   & ([scriptblock]::Create((Get-Content .\install.ps1 -Raw))) -Binary
#   & ([scriptblock]::Create((Get-Content .\install.ps1 -Raw))) -Source
#   & ([scriptblock]::Create((Get-Content .\install.ps1 -Raw))) -Source -Ref ohmg-v0.0.2
#   & ([scriptblock]::Create((Get-Content .\install.ps1 -Raw))) -Binary -Ref ohmg-v0.0.2

param(
    [switch]$Source,
    [switch]$Binary,
    [string]$Ref
)

$ErrorActionPreference = "Stop"

$Repo = "edumdp-dev/oh-my-goat"
$DefaultTag = "ohmg-v0.0.2"
$InstallDir = if ($env:PI_INSTALL_DIR) { $env:PI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "ohmg" }
$NativeArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($NativeArchitecture -notin @("x64", "arm64")) {
    throw "Unsupported Windows architecture: $NativeArchitecture"
}
$BinaryName = "ohmg-windows-$NativeArchitecture.exe"
$MinimumBunVersion = "1.3.14"

function Test-BunInstalled {
    try {
        $null = Get-Command bun -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Get-BunVersion {
    try {
        $versionText = (bun --version 2>$null)
        if (-not $versionText) {
            return $null
        }

        $clean = $versionText.Trim().Split("-")[0]
        return [version]$clean
    } catch {
        return $null
    }
}

function Test-BunVersion {
    param([string]$MinimumVersion)

    $currentVersion = Get-BunVersion
    if (-not $currentVersion) {
        return $false
    }

    return $currentVersion -ge [version]$MinimumVersion
}

function Assert-BunVersion {
    param([string]$MinimumVersion)

    if (-not (Test-BunVersion $MinimumVersion)) {
        $current = Get-BunVersion
        $currentText = if ($current) { $current.ToString() } else { "unknown" }
        throw "Bun $MinimumVersion or newer is required. Current version: $currentText. Upgrade Bun at https://bun.sh/docs/installation"
    }
}

function Test-GitInstalled {
    try {
        $null = Get-Command git -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Test-GitLfsInstalled {
    try {
        $null = Get-Command git-lfs -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Find-BashShell {
    # Check Git Bash first (most common on Windows)
    $gitBash = "C:\Program Files\Git\bin\bash.exe"
    if (Test-Path $gitBash) {
        return $gitBash
    }

    # Check bash.exe on PATH (Cygwin, MSYS2, WSL)
    try {
        $bashCmd = Get-Command bash.exe -ErrorAction Stop
        return $bashCmd.Source
    } catch {
        return $null
    }
}

function Configure-BashShell {
    try {
        $settingsDir = Join-Path $env:USERPROFILE ".ohmg\agent"
        $settingsFile = Join-Path $settingsDir "settings.json"

        # Never touch an existing settings file: shellPath is only added
        # when creating a brand-new config.
        if (Test-Path $settingsFile) {
            return
        }

        $bashPath = Find-BashShell

        if ($bashPath) {
            Write-Host "Found bash shell: $bashPath" -ForegroundColor Cyan

            # Create settings directory if needed
            if (-not (Test-Path $settingsDir)) {
                New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
            }

            # Read existing settings or create new. ConvertFrom-Json -AsHashtable
            # requires PowerShell 6+; build the hashtable manually so Windows
            # PowerShell 5.1 merges instead of clobbering existing settings.
            $settings = @{}
            if (Test-Path $settingsFile) {
                try {
                    $parsed = Get-Content $settingsFile -Raw | ConvertFrom-Json
                    foreach ($prop in $parsed.PSObject.Properties) {
                        $settings[$prop.Name] = $prop.Value
                    }
                } catch {
                    $settings = @{}
                }
            }

            # Set shellPath
            $settings["shellPath"] = $bashPath

            # Write settings
            $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsFile -Encoding UTF8
            Write-Host "[OK] Configured shell path in $settingsFile" -ForegroundColor Green
        } else {
            Write-Host "No bash shell found - ohmygoat will use its built-in shell." -ForegroundColor Cyan
            Write-Host "  For shell snapshots and interactive terminals, install Git for Windows:" -ForegroundColor Cyan
            Write-Host "    https://git-scm.com/download/win" -ForegroundColor Cyan
            Write-Host "  Or set a custom path in:" -ForegroundColor Cyan
            Write-Host "    $settingsFile" -ForegroundColor Cyan
            Write-Host '    { "shellPath": "C:\\path\\to\\bash.exe" }' -ForegroundColor Cyan
        }
    } catch {
        Write-Host "[WARN] Could not configure bash shell: $_" -ForegroundColor Yellow
    }
}

function Install-Bun {
    Write-Host "Installing bun..."
    irm bun.sh/install.ps1 | iex
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    Assert-BunVersion $MinimumBunVersion
}

function Install-ViaBun {
    Write-Host "Installing via bun..."
    if (-not (Test-GitInstalled)) {
        throw "git is required when installing from source"
    }

    $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ohmg-install-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

    try {
        $repoUrl = "https://github.com/$Repo.git"
        if ($Ref) {
            $cloneOk = $false
            try {
                git clone --depth 1 --branch $Ref $repoUrl $tmpRoot | Out-Null
                $cloneOk = $true
            } catch {
                $cloneOk = $false
            }

            if (-not $cloneOk) {
                git clone $repoUrl $tmpRoot | Out-Null
                Push-Location $tmpRoot
                try {
                    git checkout $Ref | Out-Null
                } finally {
                    Pop-Location
                }
            }
        } else {
            git clone --depth 1 $repoUrl $tmpRoot | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to clone $Repo"
            }
        }

        # Pull LFS files
        if (Test-GitLfsInstalled) {
            Push-Location $tmpRoot
            try {
                git lfs pull | Out-Null
            } finally {
                Pop-Location
            }
        }

        $packagePath = Join-Path $tmpRoot "packages\coding-agent"
        if (-not (Test-Path $packagePath)) {
            throw "Expected package at $packagePath"
        }

        bun install -g $packagePath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install from $packagePath via bun"
        }
    } finally {
        Remove-Item -Recurse -Force $tmpRoot -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "[OK] Installed ohmg via bun" -ForegroundColor Green

    Configure-BashShell

    Write-Host "Run 'ohmg' to get started!"
}

function Get-OhmgFileHash {
    # SHA-256 hex digest of a file without depending on module autoload:
    # Get-FileHash (Microsoft.PowerShell.Utility) failed to load on Windows
    # PowerShell 5.1 in a constrained environment. Pure .NET, works on 5.1+
    param([string]$Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $hashBytes = $sha256.ComputeHash($stream)
        } finally {
            $stream.Close()
        }
    } finally {
        $sha256.Dispose()
    }
    return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
}

function Seed-Preset {
    param([string]$Tag, [string]$Asset, [string]$Destination, [string]$SumsPath)
    $leaf = Split-Path $Destination -Leaf
    if (Test-Path $Destination) {
        Write-Host "Keeping existing $leaf"
        return
    }
    Write-Host "Seeding $leaf from release $Tag..."
    $tmp = "$Destination.part"
    try {
        Invoke-WebRequest -Uri "https://github.com/$Repo/releases/download/$Tag/$Asset" -OutFile $tmp -TimeoutSec 60
        # Presets are attested release assets too: never seed an unverified file.
        if (Test-Path $SumsPath) {
            $assetMatch = Select-String -Path $SumsPath -Pattern "  $Asset$" | Select-Object -First 1
            if ($assetMatch) {
                $assetExpected = ($assetMatch.Line -split '\s+')[0].ToLowerInvariant()
                $assetActual = Get-OhmgFileHash -Path $tmp
                if ($assetActual -ne $assetExpected) {
                    Write-Host "[WARN] Checksum mismatch for $Asset; not seeding." -ForegroundColor Yellow
                    return
                }
            }
        }
        Move-Item -Path $tmp -Destination $Destination -Force
    } catch {
        Write-Host "[WARN] Could not seed $leaf; ohmg will create defaults on first run." -ForegroundColor Yellow
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Install-Binary {
    $Tag = if ($Ref) { $Ref } else { $DefaultTag }
    Write-Host "Using version: $Tag"

    $BinaryUrl = "https://github.com/$Repo/releases/download/$Tag/$BinaryName"
    $SumsUrl = "https://github.com/$Repo/releases/download/$Tag/SHA256SUMS.txt"
    $AgentDir = Join-Path $env:USERPROFILE ".ohmg\agent"

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $OutPath = Join-Path $InstallDir "ohmg.exe"
    $TmpPath = "$OutPath.new-$PID"
    $SumsPath = "$OutPath.sums-$PID"

    try {
        # The asset must be listed in the release checksum manifest first,
        # otherwise there is nothing safe to install.
        Write-Host "Fetching SHA256SUMS.txt for $Tag..."
        try {
            Invoke-WebRequest -Uri $SumsUrl -OutFile $SumsPath -TimeoutSec 60
        } catch {
            throw "Failed to download SHA256SUMS.txt for release $Tag. Check that the release exists: https://github.com/$Repo/releases/tag/$Tag"
        }
        $match = Select-String -Path $SumsPath -Pattern "  $BinaryName$" | Select-Object -First 1
        $Expected = if ($match) { ($match.Line -split '\s+')[0] } else { $null }
        if (-not $Expected) {
            throw "Release $Tag has no asset named $BinaryName"
        }

        # Download to a temp path and verify before anything is replaced, so
        # a failed download can never break a working install.
        Write-Host "Downloading $BinaryName..."
        Invoke-WebRequest -Uri $BinaryUrl -OutFile $TmpPath -TimeoutSec 900
        Unblock-File -Path $TmpPath -ErrorAction SilentlyContinue

        $Actual = Get-OhmgFileHash -Path $TmpPath
        if ($Actual -ne $Expected.ToLowerInvariant()) {
            throw "Checksum mismatch for ${BinaryName}: expected $Expected, actual $Actual. Aborting without touching the installed ohmg."
        }
        Write-Host "Checksum OK"

        # Smoke-test the download before it replaces anything.
        $smoke = & $TmpPath --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Downloaded $BinaryName cannot start:`n$smoke"
        }

        # Atomic replacement, then a post-install smoke test.
        Move-Item -Path $TmpPath -Destination $OutPath -Force

        $smoke = & $OutPath --version 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Installed $OutPath cannot start:`n$smoke"
        }

        Write-Host ""
        Write-Host "[OK] Installed ohmg ($smoke) to $OutPath" -ForegroundColor Green

        # Seed the portable preset and model catalog, but never overwrite the
        # user's own files. Sources are the release assets pinned to this tag
        # — never main, never ~/.omp.
        New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
        $configYml = Join-Path $AgentDir "config.yml"
        if (-not (Test-Path $configYml) -and -not (Test-Path (Join-Path $AgentDir "config.yaml"))) {
            Seed-Preset -Tag $Tag -Asset "ohmygoat.config.yml" -Destination $configYml -SumsPath $SumsPath
        } else {
            Write-Host "Keeping existing agent config"
        }
        Seed-Preset -Tag $Tag -Asset "ohmygoat.models.yml" -Destination (Join-Path $AgentDir "models.yml") -SumsPath $SumsPath
    } finally {
        Remove-Item $TmpPath -Force -ErrorAction SilentlyContinue
        Remove-Item $SumsPath -Force -ErrorAction SilentlyContinue
    }

    # Add to PATH if not already there (idempotent substring check).
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $needsRestart = $UserPath -notlike "*$InstallDir*"
    if ($needsRestart) {
        Write-Host "Adding $InstallDir to PATH..."
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    }

    Configure-BashShell

    if ($needsRestart) {
        Write-Host "Restart your terminal, then run 'ohmg' to get started!"
    } else {
        Write-Host "Run 'ohmg' to get started!"
    }
}

# Main logic
if ($Source) {
    if (-not (Test-BunInstalled)) {
        Install-Bun
    }
    Assert-BunVersion $MinimumBunVersion
    Install-ViaBun
} else {
    # Default: install the prebuilt binary.
    Install-Binary
}
