/**
 * babel-plugin-probe.js - Babel Plugin for auto-wrapping user functions (Replica of probe-loader)
 *
 * Replicates logic from probe-loader.js:
 * 1. Exclude specific functions and files (configurable)
 * 2. Wrap functions with wrapUserFunction (FunctionDeclaration only, matching loader)
 * 3. Handle API handlers and exports
 * 4. Inject import statement respecting directives
 */

const nodePath = require('path');

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

    // Prevent double wrapping (Babel specific: avoid wrapping already wrapped/internal functions)
    if (name.startsWith('_unwrapped_')) return { wrap: false, isApiHandler: false };

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

function matches(pattern, path) {
    if (pattern instanceof RegExp) return pattern.test(path);
    if (typeof pattern === 'string') return path.includes(pattern);
    return false;
}

function hasMatch(patterns, path) {
    if (!patterns || patterns.length === 0) return false;
    const patternArr = Array.isArray(patterns) ? patterns : [patterns];
    return patternArr.some(p => matches(p, path));
}

module.exports = function (api, options = {}) {
    const t = api.types;

    // ----------------------------------------------------
    // 1. Direct API access & Caching
    // ----------------------------------------------------

    // Determine environment from caller
    const isServer = api.caller((caller) => {
        // Default to true if caller is not provided (e.g. debug scripts),
        // matching the original default behavior
        return caller?.isServer ?? true;
    });

    // Configure caching: invalidate if isServer changes
    api.cache.using(() => isServer);

    // Replicate defaults from Webpack config
    const {
        // isServer is now derived from API, but we allow options to override it if strictly provided
        // (options.isServer defaults to undefined, so we use the derived value)

        // Match Webpack `test: /\.(ts|tsx|js|jsx)$/`
        test = /\.(ts|tsx|js|jsx)$/,

        // Match Webpack `include: [/app/]`
        include = ['/app/'],

        // Match Webpack `exclude: [/node_modules/, /\.next/, /instrumentation/, /probe-wrapper/]`
        exclude = ['/node_modules/', '/.next/', '/instrumentation/', '/probe-wrapper/']
    } = options;

    const finalIsServer = options.isServer !== undefined ? options.isServer : isServer;

    function shouldProcess(filename) {
        if (!filename) return false;

        // Normalize filename to use forward slashes for consistent matching
        const normalizedFilename = filename.replace(/\\/g, '/');

        // If explicitly disabled (e.g. client-side), skip
        if (finalIsServer === false) return false;

        // 1. Test (Extension)
        if (test && !matches(test, normalizedFilename)) return false;

        // 2. Exclude (Block)
        if (exclude && hasMatch(exclude, normalizedFilename)) return false;

        // 3. Include (Allow)
        if (include && include.length > 0) {
            if (!hasMatch(include, normalizedFilename)) return false;
        }

        return true;
    }

    return {
        visitor: {
            Program: {
                enter(path, state) {
                    const resourcePath = state.filename || (state.file && state.file.opts.filename);

                    // Logic to exclude Next.js special files
                    // const fileName = nodePath.basename(resourcePath, nodePath.extname(resourcePath));
                    // const NEXTJS_SPECIAL_FILES = ['page', 'layout', 'loading', 'error', 'not-found', 'template', 'default', 'route', 'middleware', 'global-error'];
                    // if (NEXTJS_SPECIAL_FILES.includes(fileName)) {
                    //     state.skipProcessing = true;
                    //     return;
                    // }

                    if (!shouldProcess(resourcePath)) {
                        state.skipProcessing = true;
                        return;
                    }

                    const relativePath = nodePath.relative(process.cwd(), resourcePath).replace(/\\/g, '/');
                    console.log(`[babel-plugin-probe] Processing: ${relativePath}`);

                    state.wrappedFunctions = [];
                    state.exportedFunctions = new Set();

                    // Pre-pass to collect exported functions
                    path.traverse({
                        ExportNamedDeclaration(p) {
                            if (p.node.declaration) {
                                if (p.node.declaration.type === 'FunctionDeclaration' && p.node.declaration.id) {
                                    state.exportedFunctions.add(p.node.declaration.id.name);
                                }
                                else if (p.node.declaration.type === 'VariableDeclaration') {
                                    p.node.declaration.declarations.forEach(declarator => {
                                        if (declarator.id.type === 'Identifier') {
                                            state.exportedFunctions.add(declarator.id.name);
                                        }
                                    });
                                }
                            }
                            if (p.node.specifiers) {
                                p.node.specifiers.forEach(spec => {
                                    if (spec.type === 'ExportSpecifier' && spec.local) {
                                        state.exportedFunctions.add(spec.local.name);
                                    }
                                });
                            }
                        },
                        ExportDefaultDeclaration(p) {
                            if (p.node.declaration && (p.node.declaration.type === 'FunctionDeclaration' || p.node.declaration.type === 'FunctionExpression') && p.node.declaration.id) {
                                state.exportedFunctions.add(p.node.declaration.id.name);
                            }
                        }
                    });
                },
                exit(path, state) {
                    if (state.skipProcessing) return;

                    if (state.wrappedFunctions.length > 0) {
                        const importPath = '@/probe-wrapper';
                        let hasImport = false;

                        path.traverse({
                            ImportDeclaration(p) {
                                const importSource = p.node.source.value;
                                if (importSource.includes('probe-wrapper') || importSource.includes('wrapUserFunction')) {
                                    hasImport = true;
                                    p.stop();
                                }
                            }
                        });

                        if (!hasImport) {
                            const importDecl = t.importDeclaration(
                                [t.importSpecifier(t.identifier('wrapUserFunction'), t.identifier('wrapUserFunction'))],
                                t.stringLiteral(importPath)
                            );

                            const body = path.get('body');
                            const firstNode = body[0];
                            if (body.length > 0 &&
                                firstNode.isExpressionStatement() &&
                                firstNode.get('expression').isStringLiteral() &&
                                (firstNode.node.expression.value === 'use client' || firstNode.node.expression.value === 'use server')) {
                                firstNode.insertAfter(importDecl);
                            } else {
                                path.unshiftContainer('body', importDecl);
                            }
                        }

                        const resourcePath = state.filename || (state.file && state.file.opts.filename);
                        const relativePath = resourcePath ? nodePath.relative(process.cwd(), resourcePath).replace(/\\/g, '/') : 'unknown';
                        console.log(`[babel-plugin-probe] Wrapped functions in ${relativePath}: ${state.wrappedFunctions.join(', ')}`);
                    }
                }
            },
            FunctionDeclaration(path, state) {
                if (state.skipProcessing) return;

                const name = path.node.id?.name;
                if (!name) return;

                const isExported = state.exportedFunctions.has(name);
                const { wrap, isApiHandler } = shouldWrap(name, isExported);

                if (!wrap) return;

                const internalName = `_unwrapped_${name}`;

                path.node.id.name = internalName;

                const wrapperDeclarator = t.variableDeclarator(
                    t.identifier(name),
                    t.callExpression(
                        t.identifier('wrapUserFunction'),
                        [t.identifier(internalName), t.stringLiteral(name)]
                    )
                );

                let wrapperNode;
                if (isApiHandler || isExported) {
                    wrapperNode = t.exportNamedDeclaration(
                        t.variableDeclaration('const', [wrapperDeclarator])
                    );
                } else {
                    wrapperNode = t.variableDeclaration('const', [wrapperDeclarator]);
                }

                if (path.parent.type === 'ExportDefaultDeclaration') {
                    path.parentPath.insertAfter(wrapperNode);
                } else if (path.parent.type === 'ExportNamedDeclaration') {
                    path.parentPath.replaceWithMultiple([
                        path.node,
                        wrapperNode
                    ]);
                } else {
                    path.insertAfter(wrapperNode);
                }

                state.wrappedFunctions.push(name);
            }
        }
    };
};
