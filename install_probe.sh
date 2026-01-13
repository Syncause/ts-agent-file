#!/bin/bash

# Probe Installation Script v1.0
# This script automates the installation of the OpenTelemetry-based TS/JS Probe.

set -e

# --- Configuration ---
GITHUB_BASE="https://raw.githubusercontent.com/Syncause/ts-agent-file/v1.0.0"
CORE_DEPS=(
    "@opentelemetry/sdk-node"
    "@opentelemetry/api"
    "@opentelemetry/auto-instrumentations-node"
    "@opentelemetry/sdk-metrics"
    "@opentelemetry/sdk-trace-node"
    "@opentelemetry/core"
    "express"
    "ws"
)
TS_DEPS=(
    "@types/express"
    "@types/ws"
    "@types/node"
    "tsx"
)
NEXT_DEPS=(
    "@babel/parser"
    "@babel/traverse"
    "magic-string"
)

# --- Helper Functions ---
echo_step() {
    echo -e "\033[1;34m==>\033[0m $1"
}

echo_success() {
    echo -e "\033[1;32mSUCCESS:\033[0m $1"
}

echo_error() {
    echo -e "\033[1;31mERROR:\033[0m $1"
}

# 1. Detect Package Manager
if [ -f "pnpm-lock.yaml" ]; then
    PKG_MANAGER="pnpm"
    INSTALL_CMD="pnpm add"
    DEV_INSTALL_CMD="pnpm add -D"
elif [ -f "yarn.lock" ]; then
    PKG_MANAGER="yarn"
    INSTALL_CMD="yarn add"
    DEV_INSTALL_CMD="yarn add -D"
else
    PKG_MANAGER="npm"
    INSTALL_CMD="npm install"
    DEV_INSTALL_CMD="npm install -D"
fi
echo_step "Using package manager: $PKG_MANAGER"

# 2. Detect Project Type
PROJECT_TYPE="js"
if [ -f "next.config.js" ] || [ -f "next.config.mjs" ] || [ -f "next.config.ts" ]; then
    PROJECT_TYPE="next"
elif [ -f "tsconfig.json" ] || grep -q '"typescript"' package.json || [ -n "$(find src -name "*.ts" 2>/dev/null | head -n 1)" ]; then
    PROJECT_TYPE="ts"
fi
echo_step "Detected project type: $PROJECT_TYPE"

# 3. Detect Target Directory
if [ -d "src" ]; then
    TARGET_DIR="src"
else
    TARGET_DIR="."
fi
echo_step "Target directory for probe files: $TARGET_DIR"

case $PROJECT_TYPE in
    "next")
        echo_step "Downloading Next.js instrumentation files..."
        curl -sL "$GITHUB_BASE/instrumentation.ts" -o "$TARGET_DIR/instrumentation.ts"
        curl -sL "$GITHUB_BASE/instrumentation.node.next.ts" -o "$TARGET_DIR/instrumentation.node.ts"
        curl -sL "$GITHUB_BASE/probe-wrapper.ts" -o "$TARGET_DIR/probe-wrapper.ts"
        mkdir -p loaders && curl -sL "$GITHUB_BASE/probe-loader.js" -o loaders/probe-loader.js
        ;;
    "ts")
        echo_step "Downloading TypeScript instrumentation files..."
        curl -sL "$GITHUB_BASE/instrumentation.ts" -o "$TARGET_DIR/instrumentation.ts"
        curl -sL "$GITHUB_BASE/instrumentation.node.ts" -o "$TARGET_DIR/instrumentation.node.ts"
        ;;
    "js")
        echo_step "Downloading JavaScript instrumentation files..."
        curl -sL "$GITHUB_BASE/instrumentation.js" -o "$TARGET_DIR/instrumentation.js"
        curl -sL "$GITHUB_BASE/instrumentation.node.js" -o "$TARGET_DIR/instrumentation.node.js"
        ;;
esac

# 4. Install Dependencies
echo_step "Installing core dependencies..."
$INSTALL_CMD "${CORE_DEPS[@]}"

if [ "$PROJECT_TYPE" == "ts" ] || [ "$PROJECT_TYPE" == "next" ]; then
    echo_step "Installing TypeScript dependencies..."
    $DEV_INSTALL_CMD "${TS_DEPS[@]}"
fi

if [ "$PROJECT_TYPE" == "next" ]; then
    echo_step "Installing Next.js specific dependencies..."
    $DEV_INSTALL_CMD "${NEXT_DEPS[@]}"
fi

# 5. Modify package.json (Basic attempt)
echo_step "Updating package.json scripts (manual double-check required)..."
# Use node script to safely modify package.json
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const projectType = "'$PROJECT_TYPE'";
const targetDir = "'$TARGET_DIR'";
const baseDir = targetDir === "." ? "./" : "./" + targetDir + "/";

if (projectType === "next") {
    if (pkg.scripts.dev && !pkg.scripts.dev.includes("--webpack")) {
        pkg.scripts.dev = pkg.scripts.dev.replace("next dev", "next dev --webpack");
    }
} else if (projectType === "ts") {
    if (pkg.scripts.dev && !pkg.scripts.dev.includes("--import")) {
         pkg.scripts.dev = "tsx --import " + baseDir + "instrumentation.node.ts " + (pkg.scripts.dev.includes("src/index.ts") ? "src/index.ts" : pkg.main || "");
    }
} else if (projectType === "js") {
     if (pkg.scripts.dev && !pkg.scripts.dev.includes("--require")) {
         pkg.scripts.dev = "node --require " + baseDir + "instrumentation.js " + (pkg.main || "index.js");
     }
}
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));
'

echo_success "Installation complete. Please verify files and run the app."
