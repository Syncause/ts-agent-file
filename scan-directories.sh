#!/bin/bash

# scan-directories.sh - Automatically scan project structure for webpack include paths
# 
# This script scans the project directory structure and outputs a list of directories
# that should be included in the Next.js webpack probe-loader configuration.
# 
# Usage:
#   bash scripts/scan-directories.sh
#   # or make it executable
#   chmod +x scripts/scan-directories.sh
#   ./scripts/scan-directories.sh

set -e

# Directories to always skip (case-insensitive)
SKIP_DIRS=(
    "node_modules"
    ".next"
    ".git"
    "public"
    "styles"
    "assets"
    "static"
    "dist"
    "build"
    "out"
    "coverage"
    "tests"
    "__tests__"
    ".vscode"
    ".idea"
    "instrumentation"
    "probe-wrapper"
    "loaders"
)

# Directories that are typically source code (prioritize these)
SOURCE_DIRS=(
    "app"
    "pages"
    "components"
    "lib"
    "utils"
    "services"
    "api"
    "hooks"
    "helpers"
    "models"
    "contexts"
    "store"
    "features"
    "modules"
    "views"
    "controllers"
)

# Check if a directory should be skipped
should_skip() {
    local dir_name="$1"
    local lower_name=$(echo "$dir_name" | tr '[:upper:]' '[:lower:]')
    
    # Skip hidden directories (except root)
    if [[ "$dir_name" =~ ^\. ]] && [[ "$dir_name" != "." ]]; then
        return 0
    fi
    
    # Skip test directories
    if [[ "$lower_name" =~ test ]] || [[ "$lower_name" =~ spec ]]; then
        return 0
    fi
    
    # Skip stylesheet directories
    if [[ "$lower_name" =~ style ]] || [[ "$lower_name" =~ css ]] || [[ "$lower_name" =~ sass ]]; then
        return 0
    fi
    
    # Check against skip list
    for skip_dir in "${SKIP_DIRS[@]}"; do
        if [[ "$lower_name" == "$skip_dir" ]]; then
            return 0
        fi
    done
    
    return 1
}

# Check if a directory is a known source directory
is_source_dir() {
    local dir_name="$1"
    local lower_name=$(echo "$dir_name" | tr '[:upper:]' '[:lower:]')
    
    for source_dir in "${SOURCE_DIRS[@]}"; do
        if [[ "$lower_name" == "$source_dir" ]]; then
            return 0
        fi
    done
    
    return 1
}

# Check if directory contains TypeScript/JavaScript files
contains_source_files() {
    local dir_path="$1"
    
    # Check for .ts, .tsx, .js, .jsx files
    if find "$dir_path" -maxdepth 1 -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) -print -quit 2>/dev/null | grep -q .; then
        return 0
    fi
    
    return 1
}

# Recursively scan directory
# Args: directory_path, max_depth, current_depth, base_dir
scan_directory() {
    local dir="$1"
    local max_depth="${2:-3}"
    local current_depth="${3:-0}"
    local base_dir="${4:-}"
    
    # Stop if max depth reached
    if [[ $current_depth -ge $max_depth ]]; then
        return
    fi
    
    # Read directory entries
    while IFS= read -r -d '' entry; do
        local dir_name=$(basename "$entry")
        
        # Skip unwanted directories
        if should_skip "$dir_name"; then
            continue
        fi
        
        # Build relative path
        local relative_path
        if [[ -n "$base_dir" ]]; then
            relative_path="$base_dir/$dir_name"
        else
            relative_path="$dir_name"
        fi
        
        # Check if this directory should be included
        local include=false
        if is_source_dir "$dir_name" || contains_source_files "$entry"; then
            include=true
        fi
        
        # Output if should include
        if [[ "$include" == "true" ]]; then
            echo "$relative_path"
        fi
        
        # Recursively scan subdirectories
        scan_directory "$entry" "$max_depth" $((current_depth + 1)) "$relative_path"
        
    done < <(find "$dir" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null | sort -z)
}

# Convert directory paths to webpack regex format
to_webpack_regex() {
    local dir="$1"
    # Escape forward slashes for regex
    local escaped=$(echo "$dir" | sed 's/\//\\\//g')
    echo "/$escaped/"
}

# Main function
main() {
    local project_root=$(pwd)
    local has_src=false
    
    # Check if src/ directory exists
    if [[ -d "$project_root/src" ]]; then
        has_src=true
    fi
    
    # Collect all directories
    local -a all_dirs=()
    
    if [[ "$has_src" == "true" ]]; then
        # Scan src/ directory
        while IFS= read -r dir; do
            all_dirs+=("$dir")
        done < <(scan_directory "$project_root/src" 3 0 "src")
    else
        # Scan root directory
        while IFS= read -r dir; do
            all_dirs+=("$dir")
        done < <(scan_directory "$project_root" 2 0 "")
    fi
    
    # Sort directories
    IFS=$'\n' sorted_dirs=($(sort <<<"${all_dirs[*]}"))
    unset IFS
    
    # Ensure at least one directory is included
    if [[ ${#sorted_dirs[@]} -eq 0 ]]; then
        if [[ "$has_src" == "true" ]]; then
            sorted_dirs=("src/app")
        else
            sorted_dirs=("app")
        fi
    fi
    
    # Output human-readable list
    echo "# Detected source directories:"
    for dir in "${sorted_dirs[@]}"; do
        echo "  - $dir"
    done
    echo
    
    # Output webpack include array
    echo "# Webpack include array (copy to next.config.ts):"
    echo -n "include: ["
    
    local first=true
    for dir in "${sorted_dirs[@]}"; do
        if [[ "$first" == "true" ]]; then
            first=false
        else
            echo -n ", "
        fi
        echo -n "$(to_webpack_regex "$dir")"
    done
    
    echo "]"
    echo
}

# Run main function
main

