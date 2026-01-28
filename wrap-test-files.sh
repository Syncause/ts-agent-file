#!/bin/bash

# Test File Wrapper Script v1.6.0 (Linux/Mac)
# This script automates the wrapping of test files with probe instrumentation.

set -e

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

# --- Configuration ---
TAG="${TAG:-v1.6.0}"
GITHUB_BASE="https://raw.githubusercontent.com/Syncause/ts-agent-file/${TAG}"
SOURCE_DIR="${1:-__tests__}"
OUTPUT_DIR="${2:-__tests_traced__}"

echo_step "Using version tag: $TAG"
echo_step "Source directory: $SOURCE_DIR"
echo_step "Output directory: $OUTPUT_DIR"

# --- Create directories ---
echo_step "Creating .syncause/scripts directory..."
mkdir -p .syncause/scripts

# --- Download components ---
echo_step "Downloading test probe components from GitHub..."

echo_step "Downloading test-probe-runtime.ts..."
if ! curl -fsSL -o .syncause/test-probe-runtime.ts "$GITHUB_BASE/test-probe-runtime.ts"; then
    echo_error "Failed to download test-probe-runtime.ts"
    exit 1
fi

echo_step "Downloading babel-plugin-test-probe.js..."
if ! curl -fsSL -o .syncause/scripts/babel-plugin-test-probe.js "$GITHUB_BASE/babel-plugin-test-probe.js"; then
    echo_error "Failed to download babel-plugin-test-probe.js"
    exit 1
fi

echo_step "Downloading wrap-test-files.js..."
if ! curl -fsSL -o .syncause/scripts/wrap-test-files.js "$GITHUB_BASE/wrap-test-files.js"; then
    echo_error "Failed to download wrap-test-files.js"
    exit 1
fi

echo_success "All components downloaded successfully"

# --- Install dependencies ---
echo_step "Installing Babel dependencies..."
npm install -D @babel/parser @babel/traverse @babel/generator @babel/types 2>/dev/null || {
    echo_error "Warning: Some dependencies may have failed to install"
}

# --- Wrap test files ---
echo_step "Wrapping test files from $SOURCE_DIR to $OUTPUT_DIR..."
if ! node .syncause/scripts/wrap-test-files.js "$SOURCE_DIR" "$OUTPUT_DIR"; then
    echo_error "Failed to wrap test files"
    exit 1
fi

echo_success "Test files wrapped successfully"

# --- Clean up old span log ---
echo_step "Cleaning up old span.log..."
rm -f .syncause/span.log

# --- Run tests ---
echo_step "Running tests..."
if npx jest "$OUTPUT_DIR" --forceExit 2>/dev/null; then
    echo_success "Tests completed with Jest"
elif npx vitest run "$OUTPUT_DIR" 2>/dev/null; then
    echo_success "Tests completed with Vitest"
elif npx mocha "$OUTPUT_DIR/**/*.test.ts" 2>/dev/null; then
    echo_success "Tests completed with Mocha"
else
    echo_error "No test runner found or tests failed"
    exit 1
fi

# --- Report results ---
if [ -f .syncause/span.log ]; then
    SPAN_COUNT=$(wc -l < .syncause/span.log | tr -d ' ')
    echo_success "Span records: $SPAN_COUNT"
    
    if [ "$SPAN_COUNT" -gt 0 ]; then
        echo_success "Test probe instrumentation is working correctly!"
    else
        echo_error "No spans recorded. Check your test setup."
    fi
else
    echo_error "span.log not found. Instrumentation may not be working."
fi
