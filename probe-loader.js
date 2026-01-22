/**
 * probe-loader.js - Webpack Loader for auto-wrapping user functions (HMR compatible)
 * 
 * Key Optimizations:
 * 1. Enable Webpack caching via this.cacheable()
 * 2. Preserve React component identity (displayName and reference stability)
 * 3. Use magic-string to generate correct Source Maps
 */

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const MagicString = require('magic-string');
const path = require('path');

// Excluded function names (do not wrap these)
const EXCLUDE_FUNCTIONS = new Set([
    // Next.js specific functions
    'generateMetadata', 'generateStaticParams', 'generateViewport',
    // Next.js async APIs (these return Promises and should not be wrapped)
    'headers', 'cookies', 'draftMode', 'redirect', 'notFound', 'permanentRedirect',
    'revalidatePath', 'revalidateTag', 'unstable_cache', 'unstable_noStore',
    // Next.js Server Actions internals
    'useFormState', 'useFormStatus',
    // Clerk authentication functions
    'auth', 'currentUser', 'getAuth', 'clerkClient',
    // React component lifecycle
    'render', 'componentDidMount', 'componentWillUnmount',
    // React hooks (should not be wrapped)
    'use', 'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
    'useMemo', 'useRef', 'useImperativeHandle', 'useLayoutEffect', 'useDebugValue',
    'useDeferredValue', 'useTransition', 'useId', 'useSyncExternalStore',
    'useOptimistic', 'useActionState',
    // Special functions
    'constructor', 'init', 'register',
    // Common utility functions (too generic, skip)
    'toString', 'valueOf', 'toJSON',
    // Fetch and HTTP related
    'fetch', 'fetchAPI', 'request', 'response',
]);

// API Route handlers (exported functions that need special handling)
const API_HANDLERS = new Set([
    'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
]);

// Determine if the function should be wrapped, returns { wrap: boolean, isApiHandler: boolean }
function shouldWrap(name, isExported) {
    if (!name) return { wrap: false, isApiHandler: false };
    if (EXCLUDE_FUNCTIONS.has(name)) return { wrap: false, isApiHandler: false };

    // API handlers need special handling (preserve export)
    if (API_HANDLERS.has(name) && isExported) {
        return { wrap: true, isApiHandler: true };
    }

    // Skip other exported functions (likely React components)
    if (isExported && /^[A-Z]/.test(name)) return { wrap: false, isApiHandler: false };

    // Skip React components (starting with uppercase)
    if (/^[A-Z]/.test(name)) return { wrap: false, isApiHandler: false };

    return { wrap: true, isApiHandler: false };
}

module.exports = function probeLoader(source) {
    // ✅ Key Optimization 1: Enable Webpack caching
    // If source remains unchanged, output remains unchanged
    this.cacheable && this.cacheable();

    const resourcePath = this.resourcePath;
    const relativePath = path.relative(process.cwd(), resourcePath);

    // Skip node_modules, probe-wrapper, instrumentation files
    // Also skip directories that commonly use Next.js async APIs (headers, cookies, auth)
    // which can break when wrapped due to async context issues
    if (resourcePath.includes('node_modules') ||
        resourcePath.includes('probe-wrapper') ||
        resourcePath.includes('instrumentation') ||
        resourcePath.includes('/actions/') ||     // Server Actions use async context
        resourcePath.includes('/api/')) {         // API routes use server context
        return source;
    }

    // Skip Next.js App Router special files (they use async context for headers/cookies)
    const fileName = path.basename(resourcePath, path.extname(resourcePath));
    const NEXTJS_SPECIAL_FILES = ['page', 'layout', 'loading', 'error', 'not-found', 'template', 'default', 'route', 'middleware', 'global-error'];
    if (NEXTJS_SPECIAL_FILES.includes(fileName)) {
        return source;
    }

    console.log(`[probe-loader] Processing: ${relativePath}`);

    let ast;
    try {
        ast = parser.parse(source, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
        });
    } catch (err) {
        // Parse failed, return original code
        console.warn(`[probe-loader] Failed to parse ${relativePath}:`, err.message);
        return source;
    }

    // ✅ Key Optimization 3: Use MagicString for code transformation (preserve Source Maps)
    const s = new MagicString(source);
    let hasWrappedFunctions = false;
    const wrappedFunctions = [];

    // Collect exported function names
    const exportedFunctions = new Set();
    traverse(ast, {
        ExportNamedDeclaration(path) {
            if (path.node.declaration) {
                if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
                    exportedFunctions.add(path.node.declaration.id.name);
                }
            }
            if (path.node.specifiers) {
                path.node.specifiers.forEach(spec => {
                    if (spec.type === 'ExportSpecifier' && spec.local) {
                        exportedFunctions.add(spec.local.name);
                    }
                });
            }
        },
        ExportDefaultDeclaration(path) {
            if (path.node.declaration && path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
                exportedFunctions.add(path.node.declaration.id.name);
            }
        }
    });

    // Collect locations of functions to be wrapped
    const functionsToWrap = [];
    traverse(ast, {
        FunctionDeclaration(path) {
            const name = path.node.id?.name;
            if (!name) return;

            const isExported = exportedFunctions.has(name);
            const { wrap, isApiHandler } = shouldWrap(name, isExported);
            if (!wrap) return;

            // Check if parent node is ExportNamedDeclaration
            const parentIsExport = path.parent && path.parent.type === 'ExportNamedDeclaration';

            functionsToWrap.push({
                name,
                start: parentIsExport ? path.parent.start : path.node.start,
                end: parentIsExport ? path.parent.end : path.node.end,
                funcStart: path.node.start,
                funcEnd: path.node.end,
                isAsync: path.node.async,
                isGenerator: path.node.generator,
                isApiHandler,
                isExported: isExported || parentIsExport,
            });
        }
    });

    // ✅ Key Optimization 2: Preserve function identity (do not use anonymous functions)
    // Use magic-string for code replacement, maintain line numbering
    for (const func of functionsToWrap) {
        const originalFuncCode = source.slice(func.funcStart, func.funcEnd);

        // Generate internal function name (keep original name, add prefix to avoid conflicts)
        const internalName = `_unwrapped_${func.name}`;

        // Preserve original function signature, just rename
        // function foo() {} -> function _unwrapped_foo() {}
        const prefix = func.isAsync ? 'async function ' : (func.isGenerator ? 'function* ' : 'function ');
        const newFunctionCode = originalFuncCode.replace(
            new RegExp(`^${prefix.replace('*', '\\*')}${func.name}`),
            `${prefix}${internalName}`
        );

        // Create wrapped code
        let wrappedCode;
        if (func.isApiHandler || func.isExported) {
            // API handlers and other exported functions need to preserve export
            wrappedCode = `${newFunctionCode}
export const ${func.name} = wrapUserFunction(${internalName}, '${func.name}');`;
        } else {
            // Normal functions
            wrappedCode = `${newFunctionCode}
const ${func.name} = wrapUserFunction(${internalName}, '${func.name}');`;
        }

        s.overwrite(func.start, func.end, wrappedCode);
        hasWrappedFunctions = true;
        wrappedFunctions.push(func.name);
    }

    // If functions are wrapped, add an import statement
    if (hasWrappedFunctions) {
        // Use fixed @/ alias path (configured in tsconfig)
        const importPath = '@/probe-wrapper';

        // Check if import already exists
        let hasImport = false;
        traverse(ast, {
            ImportDeclaration(path) {
                const importSource = path.node.source.value;
                if (importSource.includes('probe-wrapper') || importSource.includes('wrapUserFunction')) {
                    hasImport = true;
                    path.stop();
                }
            }
        });

        // Add import at the beginning of file (keep 'use client'/'use server' directives at the top)
        if (!hasImport) {
            // Check for 'use client' or 'use server' directives
            let insertPosition = 0;

            // 1. Check ast.program.directives (Babel specific)
            if (ast.program.directives && ast.program.directives.length > 0) {
                // Find the last directive
                const lastDirective = ast.program.directives[ast.program.directives.length - 1];
                insertPosition = lastDirective.end;
            }
            // 2. Fallback: check first statement in body (ExpressionStatement with Literal)
            else {
                const firstStatement = ast.program.body[0];
                if (firstStatement &&
                    firstStatement.type === 'ExpressionStatement' &&
                    (firstStatement.expression.type === 'Literal' || firstStatement.expression.type === 'StringLiteral') &&
                    (firstStatement.expression.value === 'use client' ||
                        firstStatement.expression.value === 'use server')) {
                    insertPosition = firstStatement.end;
                }
            }

            if (insertPosition > 0) {
                // Insert after the directive (ensure semicolon and newline)
                s.appendLeft(insertPosition, `\nimport { wrapUserFunction } from '${importPath}';`);
            } else {
                // Insert at the beginning of the file
                s.prepend(`import { wrapUserFunction } from '${importPath}';\n`);
            }
        }

        console.log(`[probe-loader] Wrapped functions in ${relativePath}: ${wrappedFunctions.join(', ')}`);
    }

    // ✅ Key Optimization 3: Generate high-resolution Source Map
    const map = s.generateMap({
        source: resourcePath,
        file: resourcePath,
        includeContent: true,
        hires: true, // High-resolution map
    });

    // Return code and Source Map to Webpack
    this.callback(null, s.toString(), map);
};
