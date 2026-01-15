#!/usr/bin/env node
/**
 * wrap-test-files.js - Auto-wrap test files for trace generation
 * 
 * This script:
 * 1. Copies test files to a new directory
 * 2. Transforms imports to wrap business functions with wrapUserFunction
 * 3. Works with any test framework (Jest, Mocha, Vitest, etc.)
 * 
 * Usage:
 *   node scripts/wrap-test-files.js <source-dir> <output-dir>
 * 
 * Example:
 *   node scripts/wrap-test-files.js __tests__ __tests_traced__
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

// Configuration: paths to wrap (relative imports from src)
const WRAP_PATTERNS = [
    /^@\//,           // @/ alias
    /^\.\.?\/src\//,  // ../src/ or ./src/
    /^\.\.?\/lib\//,  // ../lib/ or ./lib/
    /^\.\.?\/utils\//, // ../utils/ or ./utils/
];

// Paths to exclude from wrapping
const EXCLUDE_PATTERNS = [
    /instrumentation/,
    /probe-wrapper/,
    /\.test\./,
    /\.spec\./,
];

function shouldWrapImport(importPath) {
    // Check if matches any wrap pattern
    const matchesWrap = WRAP_PATTERNS.some(p => p.test(importPath));
    if (!matchesWrap) return false;

    // Check if matches any exclude pattern
    const matchesExclude = EXCLUDE_PATTERNS.some(p => p.test(importPath));
    return !matchesExclude;
}

function transformTestFile(code, filePath) {
    let ast;
    try {
        ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
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
                    if (spec.type === 'ImportSpecifier' || spec.type === 'ImportDefaultSpecifier') {
                        const localName = spec.local.name;
                        const importedName = spec.type === 'ImportSpecifier'
                            ? (spec.imported.name || spec.imported.value)
                            : 'default';

                        importsToWrap.push({
                            localName,
                            importedName,
                            source: importSource,
                            isDefault: spec.type === 'ImportDefaultSpecifier',
                        });
                    }
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

    // Add wrapUserFunction import if not present
    if (!hasWrapImport) {
        const wrapImport = t.importDeclaration(
            [t.importSpecifier(t.identifier('wrapUserFunction'), t.identifier('wrapUserFunction'))],
            t.stringLiteral('@/probe-wrapper-test')
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
    // Check if @babel/generator is installed
    try {
        require('@babel/generator');
    } catch {
        console.error('Missing dependency: @babel/generator');
        console.log('Run: npm install -D @babel/generator');
        process.exit(1);
    }

    if (!fs.existsSync(sourceDir)) {
        console.error(`Source directory not found: ${sourceDir}`);
        process.exit(1);
    }

    // Create output directory
    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    // Process all test files
    const files = fs.readdirSync(sourceDir, { recursive: true });
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
        if (!/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) {
            // Copy non-test files as-is
            fs.copyFileSync(sourcePath, outputPath);
            continue;
        }

        const code = fs.readFileSync(sourcePath, 'utf8');
        const transformed = transformTestFile(code, sourcePath);

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
    console.log(`  npx jest ${outputDir}`);
    console.log(`  npx vitest run ${outputDir}`);
    console.log(`  npx mocha ${outputDir}/**/*.test.ts`);
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node scripts/wrap-test-files.js <source-dir> <output-dir>');
    console.log('Example: node scripts/wrap-test-files.js __tests__ __tests_traced__');
    process.exit(1);
}

const [sourceDir, outputDir] = args;
processDirectory(sourceDir, outputDir);
