#!/usr/bin/env node
/**
 * wrap-test-files.js - Auto-wrap test files for trace generation
 * 
 * Universal version - works with any Node.js/TypeScript project
 * 
 * Features:
 * - Auto-detects tsconfig.json path aliases
 * - Wraps all relative imports (./xxx, ../xxx)
 * - Wraps all alias imports (@/, ~/, #/)
 * - Uses relative path for probe-wrapper-test import
 * 
 * Usage:
 *   node wrap-test-files.js <source-dir> <output-dir> [probe-wrapper-path]
 * 
 * Example:
 *   node wrap-test-files.js __tests__ __tests_traced__
 *   node wrap-test-files.js test test_traced ../.syncause/probe-wrapper-test
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

// Default probe-wrapper-test location (relative to output directory)
let PROBE_WRAPPER_PATH = '../.syncause/probe-wrapper-test';

// Detected path aliases from tsconfig.json
let PATH_ALIASES = [];

// Paths to exclude from wrapping
const EXCLUDE_PATTERNS = [
    /node_modules/,
    /instrumentation/,
    /probe-wrapper/,
    /\.test\./,
    /\.spec\./,
    /\.d\.ts$/,
    /__mocks__/,
    /__fixtures__/,
];

/**
 * Read and parse tsconfig.json to detect path aliases
 */
function detectPathAliases() {
    const tsconfigPaths = [
        'tsconfig.json',
        'tsconfig.base.json',
        'jsconfig.json',
    ];

    for (const configFile of tsconfigPaths) {
        if (fs.existsSync(configFile)) {
            try {
                const content = fs.readFileSync(configFile, 'utf8');
                // Remove comments (simple approach)
                const cleaned = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
                const config = JSON.parse(cleaned);

                const paths = config?.compilerOptions?.paths || {};
                PATH_ALIASES = Object.keys(paths).map(alias => {
                    // Convert "@/*" to regex "^@/"
                    const pattern = alias.replace('/*', '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    return new RegExp(`^${pattern}`);
                });

                if (PATH_ALIASES.length > 0) {
                    console.log(`[INFO] Detected path aliases from ${configFile}: ${Object.keys(paths).join(', ')}`);
                }
                return;
            } catch (err) {
                console.warn(`[WARN] Failed to parse ${configFile}:`, err.message);
            }
        }
    }

    // Default aliases if no tsconfig found
    PATH_ALIASES = [/^@\//, /^~\//, /^#\//];
    console.log('[INFO] No tsconfig found, using default aliases: @/, ~/, #/');
}

/**
 * Check if an import path should be wrapped
 */
function shouldWrapImport(importPath) {
    // Exclude node_modules and internal patterns
    if (EXCLUDE_PATTERNS.some(p => p.test(importPath))) {
        return false;
    }

    // Wrap all relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
        return true;
    }

    // Wrap all path alias imports
    if (PATH_ALIASES.some(p => p.test(importPath))) {
        return true;
    }

    return false;
}

/**
 * Calculate relative path from test file to probe-wrapper
 */
function getProbeWrapperImport(testFilePath, outputDir) {
    const testDir = path.dirname(testFilePath);
    const relativeToOutput = path.relative(path.join(outputDir, testDir), '.');
    return path.join(relativeToOutput, '.syncause', 'probe-wrapper-test').replace(/\\/g, '/');
}

function transformTestFile(code, filePath, outputDir) {
    let ast;
    try {
        ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx', 'decorators-legacy'],
        });
    } catch (err) {
        console.warn(`[WARN] Failed to parse ${filePath}:`, err.message);
        return code;
    }

    const importsToWrap = [];
    let hasWrapImport = false;

    // First pass: collect imports to wrap
    traverse(ast, {
        ImportDeclaration(nodePath) {
            const importSource = nodePath.node.source.value;

            // Check if already importing wrapUserFunction
            if (importSource.includes('probe-wrapper') || importSource.includes('wrapUserFunction')) {
                hasWrapImport = true;
                return;
            }

            if (shouldWrapImport(importSource)) {
                const specifiers = nodePath.node.specifiers;
                specifiers.forEach(spec => {
                    if (spec.type === 'ImportSpecifier') {
                        const localName = spec.local.name;
                        const importedName = spec.imported.name || spec.imported.value;

                        importsToWrap.push({
                            localName,
                            importedName,
                            source: importSource,
                            isDefault: false,
                        });
                    } else if (spec.type === 'ImportDefaultSpecifier') {
                        const localName = spec.local.name;

                        importsToWrap.push({
                            localName,
                            importedName: 'default',
                            source: importSource,
                            isDefault: true,
                        });
                    }
                    // Skip ImportNamespaceSpecifier (import * as xxx)
                });
            }
        },
    });

    if (importsToWrap.length === 0) {
        console.log(`[SKIP] ${filePath}: No wrappable imports found`);
        return code;
    }

    // Second pass: transform the AST
    traverse(ast, {
        ImportDeclaration(nodePath) {
            const importSource = nodePath.node.source.value;

            if (shouldWrapImport(importSource)) {
                // Rename imported bindings to _unwrapped_xxx
                nodePath.node.specifiers.forEach(spec => {
                    if (spec.type === 'ImportSpecifier' || spec.type === 'ImportDefaultSpecifier') {
                        const originalName = spec.local.name;
                        spec.local.name = `_unwrapped_${originalName}`;
                    }
                });
            }
        },
    });

    // Generate wrapped variable declarations
    const wrapStatements = importsToWrap.map(imp => {
        return t.variableDeclaration('const', [
            t.variableDeclarator(
                t.identifier(imp.localName),
                t.callExpression(
                    t.identifier('wrapUserFunction'),
                    [
                        t.identifier(`_unwrapped_${imp.localName}`),
                        t.stringLiteral(imp.localName),
                    ]
                )
            ),
        ]);
    });

    // Calculate relative path to probe-wrapper-test
    const probeWrapperPath = getProbeWrapperImport(filePath, outputDir);

    // Add wrapUserFunction import if not present
    if (!hasWrapImport) {
        const wrapImport = t.importDeclaration(
            [t.importSpecifier(t.identifier('wrapUserFunction'), t.identifier('wrapUserFunction'))],
            t.stringLiteral(probeWrapperPath)
        );
        ast.program.body.unshift(wrapImport);
    }

    // Insert wrap statements after imports
    let lastImportIndex = -1;
    for (let i = 0; i < ast.program.body.length; i++) {
        if (ast.program.body[i].type === 'ImportDeclaration') {
            lastImportIndex = i;
        }
    }

    if (lastImportIndex >= 0) {
        ast.program.body.splice(lastImportIndex + 1, 0, ...wrapStatements);
    }

    // Generate output code
    const output = generate(ast, { retainLines: true }, code);

    console.log(`[WRAP] ${filePath}: Wrapped ${importsToWrap.length} functions: ${importsToWrap.map(i => i.localName).join(', ')}`);

    return output.code;
}

function processDirectory(sourceDir, outputDir) {
    // Check dependencies
    try {
        require('@babel/generator');
    } catch {
        console.error('Missing dependency: @babel/generator');
        console.log('Run: npm install -D @babel/parser @babel/traverse @babel/generator @babel/types');
        process.exit(1);
    }

    if (!fs.existsSync(sourceDir)) {
        console.error(`Source directory not found: ${sourceDir}`);
        process.exit(1);
    }

    // Detect path aliases
    detectPathAliases();

    // Create output directory
    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    // Process all test files
    let files;
    try {
        files = fs.readdirSync(sourceDir, { recursive: true });
    } catch {
        // Fallback for older Node.js versions
        files = [];
        const walk = (dir, prefix = '') => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const relativePath = prefix ? path.join(prefix, item) : item;
                if (fs.statSync(fullPath).isDirectory()) {
                    walk(fullPath, relativePath);
                } else {
                    files.push(relativePath);
                }
            }
        };
        walk(sourceDir);
    }

    let processedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
        const sourcePath = path.join(sourceDir, file);
        const outputPath = path.join(outputDir, file);

        const stat = fs.statSync(sourcePath);

        if (stat.isDirectory()) {
            fs.mkdirSync(outputPath, { recursive: true });
            continue;
        }

        // Only process test files
        if (!/\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(file)) {
            // Copy non-test files as-is
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.copyFileSync(sourcePath, outputPath);
            continue;
        }

        const code = fs.readFileSync(sourcePath, 'utf8');
        const transformed = transformTestFile(code, file, outputDir);

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, transformed);

        if (transformed !== code) {
            processedCount++;
        } else {
            skippedCount++;
        }
    }

    console.log('\n========================================');
    console.log(`[DONE] Processed: ${processedCount} files`);
    console.log(`[DONE] Skipped: ${skippedCount} files`);
    console.log(`[DONE] Output: ${outputDir}`);
    console.log('\nRun tests with:');
    console.log(`  npx jest ${outputDir} --forceExit`);
    console.log(`  npx vitest run ${outputDir}`);
    console.log(`  npx mocha "${outputDir}/**/*.test.ts"`);
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node wrap-test-files.js <source-dir> <output-dir>');
    console.log('');
    console.log('Arguments:');
    console.log('  source-dir   Directory containing test files');
    console.log('  output-dir   Output directory for wrapped test files');
    console.log('');
    console.log('Examples:');
    console.log('  node wrap-test-files.js __tests__ __tests_traced__');
    console.log('  node wrap-test-files.js test test_traced');
    console.log('  node wrap-test-files.js tests tests_traced');
    process.exit(1);
}

const [sourceDir, outputDir] = args;
processDirectory(sourceDir, outputDir);
