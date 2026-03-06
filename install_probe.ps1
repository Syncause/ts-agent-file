# install_probe.ps1
# This script automates the installation of the OpenTelemetry-based TS/JS Probe.
# PowerShell equivalent of install_probe.sh — supports Windows, Mac, and Linux via pwsh.
# Usage:
#   .\install_probe.ps1 [version_tag] [--dry-run]
#   pwsh -ExecutionPolicy Bypass -File install_probe.ps1 [version_tag] [--dry-run]

param(
    [string]$Tag = "",
    [switch]$DryRun = $false
)

# --- Helper Functions ---
function Write-Step([string]$msg) {
    Write-Host "==> $msg" -ForegroundColor Cyan
}
function Write-Success([string]$msg) {
    Write-Host "SUCCESS: $msg" -ForegroundColor Green
}
function Write-Err([string]$msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
}
function Write-Warn([string]$msg) {
    Write-Host "WARNING: $msg" -ForegroundColor Yellow
}

# --- Configuration ---
if (-not $Tag) { $Tag = "v1.6.0" }
$GITHUB_BASE = "https://raw.githubusercontent.com/Syncause/ts-agent-file/$Tag"
Write-Step "Using version tag: $Tag"
if ($DryRun) { Write-Warn "DRY-RUN MODE — no files will be downloaded or modified." }

$CORE_DEPS = @(
    "@opentelemetry/sdk-node",
    "@opentelemetry/api",
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/sdk-metrics",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/core",
    "@opentelemetry/winston-transport",
    "express",
    "ws"
)
$TS_DEPS   = @("@types/express", "@types/ws", "@types/node", "tsx")
$NEXT_DEPS = @("@babel/parser", "@babel/traverse", "magic-string")

$EXTERNAL_PACKAGES = @(
    "ws", "bufferutil", "utf-8-validate",
    "@opentelemetry/sdk-node", "@opentelemetry/api",
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/sdk-metrics", "@opentelemetry/sdk-trace-node",
    "@opentelemetry/core"
)

# --- 1. Detect Package Manager ---
$PKG_MANAGER  = "npm"
$INSTALL_CMD  = "npm install"
$DEV_INSTALL_CMD = "npm install -D"

if (Test-Path "pnpm-lock.yaml") {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        $PKG_MANAGER = "pnpm"
        $isWorkspace = (Test-Path "pnpm-workspace.yaml") -or ((Get-Content "package.json" -Raw) -match '"workspaces"')
        if ($isWorkspace) {
            Write-Step "Detected pnpm workspace"
            $INSTALL_CMD = "pnpm add -w"
            $DEV_INSTALL_CMD = "pnpm add -D -w"
        } else {
            $INSTALL_CMD = "pnpm add"
            $DEV_INSTALL_CMD = "pnpm add -D"
        }
    } else {
        Write-Warn "pnpm-lock.yaml found but pnpm is not installed. Falling back..."
    }
} elseif (Test-Path "yarn.lock") {
    if (Get-Command yarn -ErrorAction SilentlyContinue) {
        $PKG_MANAGER = "yarn"
        $yarnVersion = (yarn --version 2>$null) | Select-Object -First 1
        $yarnMajor   = ($yarnVersion -split "\.")[0]
        $isWorkspace = (Get-Content "package.json" -Raw) -match '"workspaces"'
        if ($isWorkspace) {
            Write-Step "Detected Yarn workspace (Yarn v$yarnVersion)"
            if ($yarnMajor -eq "1") {
                $INSTALL_CMD = "yarn add --ignore-workspace-root-check"
                $DEV_INSTALL_CMD = "yarn add -D --ignore-workspace-root-check"
            } else {
                $INSTALL_CMD = "yarn add"
                $DEV_INSTALL_CMD = "yarn add -D"
            }
        } else {
            $INSTALL_CMD = "yarn add"
            $DEV_INSTALL_CMD = "yarn add -D"
        }
    } else {
        Write-Warn "yarn.lock found but yarn is not installed. Falling back..."
    }
}
Write-Step "Using package manager: $PKG_MANAGER"

# --- 2. Detect Project Type ---
# Priority: Next.js > TypeScript > JavaScript
Write-Step "Detecting project type..."

if (-not (Test-Path "package.json")) {
    Write-Err "package.json not found. This doesn't appear to be a Node.js project."
    exit 1
}

$pkgJsonContent = Get-Content "package.json" -Raw
$PROJECT_TYPE = "js"

# Step 2a: Check for Next.js
if ($pkgJsonContent -match '"next"') {
    $PROJECT_TYPE = "next"
    Write-Step "Detected Next.js project"
} elseif ($pkgJsonContent -match '"typescript"|"@types/node"') {
    $PROJECT_TYPE = "ts"
    Write-Step "Detected TypeScript via package.json dependencies"
} elseif (Test-Path "tsconfig.json") {
    $PROJECT_TYPE = "ts"
    Write-Step "Detected TypeScript via tsconfig.json"
} elseif ((Get-ChildItem -Path "." -Filter "*.ts" -ErrorAction SilentlyContinue | Select-Object -First 1) -or
          (Get-ChildItem -Path "." -Filter "*.tsx" -ErrorAction SilentlyContinue | Select-Object -First 1) -or
          (Test-Path "src" -and (Get-ChildItem -Path "src" -Filter "*.ts" -ErrorAction SilentlyContinue | Select-Object -First 1)) -or
          (Test-Path "src" -and (Get-ChildItem -Path "src" -Filter "*.tsx" -ErrorAction SilentlyContinue | Select-Object -First 1))) {
    $PROJECT_TYPE = "ts"
    Write-Step "Detected TypeScript via source files"
} else {
    Write-Step "Detected JavaScript project (no TypeScript indicators)"
}

Write-Step "Final project type: $PROJECT_TYPE"

# --- 3. Detect Target Directory ---
if (Test-Path "src") {
    $TARGET_DIR = "src"
} else {
    $TARGET_DIR = "."
}
$BASE_DIR = if ($TARGET_DIR -eq ".") { "./" } else { "./$TARGET_DIR/" }
Write-Step "Target directory for probe files: $TARGET_DIR"

# --- 4. Download Files ---
function Download-File([string]$url, [string]$dest) {
    if ($DryRun) {
        Write-Host "  [DRY-RUN] Would download: $url -> $dest" -ForegroundColor DarkGray
        return
    }
    try {
        $destDir = Split-Path $dest -Parent
        if ($destDir -and -not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        Write-Host "  Downloaded: $dest" -ForegroundColor DarkGreen
    } catch {
        Write-Err "Failed to download $url : $_"
    }
}

switch ($PROJECT_TYPE) {
    "next" {
        Write-Step "Downloading Next.js instrumentation files and Babel config..."
        Download-File "$GITHUB_BASE/instrumentation.ts"            "$TARGET_DIR/instrumentation.ts"
        Download-File "$GITHUB_BASE/instrumentation.node.next.ts"  "$TARGET_DIR/instrumentation.node.ts"
        Download-File "$GITHUB_BASE/probe-wrapper.ts"              "$TARGET_DIR/probe-wrapper.ts"
        Download-File "$GITHUB_BASE/.babelrc"                      ".babelrc"
        Download-File "$GITHUB_BASE/babel-plugin-probe.js"         "babel-plugin-probe.js"
    }
    "ts" {
        Write-Step "Downloading TypeScript instrumentation files..."
        Download-File "$GITHUB_BASE/instrumentation.ts"     "$TARGET_DIR/instrumentation.ts"
        Download-File "$GITHUB_BASE/instrumentation.node.ts" "$TARGET_DIR/instrumentation.node.ts"
    }
    "js" {
        Write-Step "Downloading JavaScript instrumentation files..."
        Download-File "$GITHUB_BASE/instrumentation.js"     "$TARGET_DIR/instrumentation.js"
        Download-File "$GITHUB_BASE/instrumentation.node.js" "$TARGET_DIR/instrumentation.node.js"
    }
}

# --- 5. Install Dependencies ---
function Run-Cmd([string]$cmd, [string[]]$args) {
    if ($DryRun) {
        Write-Host "  [DRY-RUN] Would run: $cmd $($args -join ' ')" -ForegroundColor DarkGray
        return
    }
    & $cmd @args
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Command failed: $cmd $($args -join ' ')"
        exit $LASTEXITCODE
    }
}

Write-Step "Installing core dependencies..."
$installParts = $INSTALL_CMD -split " ", 2
$installBin  = $installParts[0]
$installArgs = if ($installParts.Count -gt 1) { ($installParts[1] -split " ") + $CORE_DEPS } else { $CORE_DEPS }
Run-Cmd $installBin $installArgs

if ($PROJECT_TYPE -eq "ts" -or $PROJECT_TYPE -eq "next") {
    Write-Step "Installing TypeScript dependencies..."
    $devParts = $DEV_INSTALL_CMD -split " ", 2
    $devBin   = $devParts[0]
    $devArgs  = if ($devParts.Count -gt 1) { ($devParts[1] -split " ") + $TS_DEPS } else { $TS_DEPS }
    Run-Cmd $devBin $devArgs
}

if ($PROJECT_TYPE -eq "next") {
    Write-Step "Installing Next.js specific dependencies..."
    $devParts = $DEV_INSTALL_CMD -split " ", 2
    $devBin   = $devParts[0]
    $devArgs  = if ($devParts.Count -gt 1) { ($devParts[1] -split " ") + $NEXT_DEPS } else { $NEXT_DEPS }
    Run-Cmd $devBin $devArgs
}

# --- 6. Configure tsconfig.json (TypeScript projects only) ---
if ($PROJECT_TYPE -eq "ts") {
    Write-Step "Configuring tsconfig.json with @/probe-wrapper path alias..."
    $probeWrapperPath = if ($TARGET_DIR -eq ".") { "./probe-wrapper" } else { "./$TARGET_DIR/probe-wrapper" }

    if ($DryRun) {
        Write-Host "  [DRY-RUN] Would add `"@/probe-wrapper`": [`"$probeWrapperPath`"] to tsconfig.json" -ForegroundColor DarkGray
    } elseif (Test-Path "tsconfig.json") {
        try {
            $tsconfig = Get-Content "tsconfig.json" -Raw | ConvertFrom-Json
            if (-not $tsconfig.compilerOptions) {
                $tsconfig | Add-Member -NotePropertyName "compilerOptions" -NotePropertyValue ([PSCustomObject]@{})
            }
            if (-not $tsconfig.compilerOptions.baseUrl) {
                $tsconfig.compilerOptions | Add-Member -NotePropertyName "baseUrl" -NotePropertyValue "." -Force
            }
            if (-not $tsconfig.compilerOptions.paths) {
                $tsconfig.compilerOptions | Add-Member -NotePropertyName "paths" -NotePropertyValue ([PSCustomObject]@{}) -Force
            }
            $tsconfig.compilerOptions.paths | Add-Member -NotePropertyName "@/probe-wrapper" -NotePropertyValue @($probeWrapperPath) -Force
            $tsconfig | ConvertTo-Json -Depth 10 | Set-Content "tsconfig.json"
            Write-Host "  Added @/probe-wrapper path alias to tsconfig.json" -ForegroundColor DarkGreen
        } catch {
            Write-Warn "Could not update tsconfig.json: $_"
        }
    } else {
        Write-Warn "tsconfig.json not found, skipping path alias configuration"
    }
}

# --- 7. Configure next.config for Next.js (add serverExternalPackages) ---
if ($PROJECT_TYPE -eq "next") {
    Write-Step "Configuring next.config for Next.js project (adding serverExternalPackages)..."
    $pkgsJson = ($EXTERNAL_PACKAGES | ForEach-Object { "    `"$_`"" }) -join ",`n"
    $pkgsInline = $EXTERNAL_PACKAGES | ConvertTo-Json -Compress

    if ($DryRun) {
        Write-Host "  [DRY-RUN] Would inject serverExternalPackages into next.config.ts/js" -ForegroundColor DarkGray
        Write-Host "  Packages: $pkgsInline" -ForegroundColor DarkGray
    } else {
        # Node.js inline — handles all config file variants (ts/js/mjs)
        $nodeScript = @"
const fs = require('fs');
const externalPackages = $pkgsInline;
const configFiles = ['next.config.ts', 'next.config.js', 'next.config.mjs'];
let configFile = null;
for (const f of configFiles) {
  if (fs.existsSync(f)) { configFile = f; break; }
}
if (!configFile) {
  const newConfig = 'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  serverExternalPackages: ' + JSON.stringify(externalPackages, null, 4) + ',\n};\n\nexport default nextConfig;\n';
  fs.writeFileSync('next.config.ts', newConfig);
  console.log('Created next.config.ts with serverExternalPackages');
} else {
  let content = fs.readFileSync(configFile, 'utf8');
  if (content.includes('serverExternalPackages')) {
    console.log('serverExternalPackages already configured in ' + configFile + ', skipping.');
  } else {
    const packagesStr = '  serverExternalPackages: ' + JSON.stringify(externalPackages, null, 2).replace(/\n/g, '\n  ') + ',';
    const insertPattern = /(const\s+\w+\s*(?::\s*NextConfig\s*)?\s*=\s*\{[\s\S]*?)(\s*\};)/;
    const match = content.match(insertPattern);
    if (match) {
      content = content.replace(insertPattern, (_, before, end) => {
        const body = before.replace(/const\s+\w+\s*(?::\s*NextConfig\s*)?\s*=\s*\{/, '').trim();
        const separator = body.length > 0 ? '\n' : '';
        return before + separator + packagesStr + '\n' + end;
      });
      fs.writeFileSync(configFile, content);
      console.log('Added serverExternalPackages to ' + configFile);
    } else {
      console.log('Warning: Could not auto-update ' + configFile + '. Add manually:\n' + packagesStr);
    }
  }
}
"@
        $nodeScript | node
    }
}

# --- 8. Modify package.json scripts ---
Write-Step "Updating package.json scripts (manual double-check required)..."

if ($DryRun) {
    Write-Host "  [DRY-RUN] Would patch package.json scripts for project type: $PROJECT_TYPE" -ForegroundColor DarkGray
} else {
    $patchScript = @"
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pt = '$PROJECT_TYPE';
const bd = '$($BASE_DIR -replace '\\\\', '/')';

if (pt === 'next') {
  if (pkg.scripts.dev && !pkg.scripts.dev.includes('--webpack')) {
    pkg.scripts.dev = pkg.scripts.dev.replace('next dev', 'next dev --webpack');
  }
  if (pkg.scripts.build && !pkg.scripts.build.includes('--webpack')) {
    pkg.scripts.build = pkg.scripts.build.replace('next build', 'next build --webpack');
  }
} else if (pt === 'ts') {
  const tsKeys = ['dev', 'start', 'serve', 'run'];
  let patched = false;
  for (const key of tsKeys) {
    if (pkg.scripts[key] && !pkg.scripts[key].includes('--import')) {
      const cmd = pkg.scripts[key];
      if (cmd.startsWith('tsx ')) {
        pkg.scripts[key] = cmd.replace(/^tsx\s+/, 'tsx --import ' + bd + 'instrumentation.node.ts ');
        patched = true; break;
      } else if (cmd.startsWith('node ')) {
        pkg.scripts[key] = cmd.replace(/^node\s+/, 'node --import ' + bd + 'instrumentation.node.ts ');
        patched = true; break;
      } else if (cmd.startsWith('ts-node ')) {
        pkg.scripts[key] = cmd.replace(/^ts-node\s+/, 'ts-node --require ' + bd + 'instrumentation.node.ts ');
        patched = true; break;
      }
    }
  }
  if (!patched) {
    const fbKey = pkg.scripts.dev !== undefined ? 'dev' : (pkg.scripts.start !== undefined ? 'start' : null);
    if (fbKey && !pkg.scripts[fbKey].includes('--import')) {
      pkg.scripts[fbKey] = 'tsx --import ' + bd + 'instrumentation.node.ts ' + pkg.scripts[fbKey];
    }
  }
} else if (pt === 'js') {
  const jsKeys = ['dev', 'start', 'serve', 'run'];
  let patched = false;
  for (const key of jsKeys) {
    if (pkg.scripts[key] && !pkg.scripts[key].includes('--require')) {
      const cmd = pkg.scripts[key];
      if (cmd.startsWith('node ')) {
        pkg.scripts[key] = cmd.replace(/^node\s+/, 'node --require ' + bd + 'instrumentation.node.js ');
        patched = true; break;
      }
    }
  }
  if (!patched) {
    const fbKey = pkg.scripts.dev !== undefined ? 'dev' : (pkg.scripts.start !== undefined ? 'start' : null);
    if (fbKey && !pkg.scripts[fbKey].includes('--require')) {
      pkg.scripts[fbKey] = 'node --require ' + bd + 'instrumentation.js ' + pkg.scripts[fbKey];
    }
  }
}
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('package.json scripts updated.');
"@
    $patchScript | node
}

Write-Success "Installation complete. Please verify files and run the app."
