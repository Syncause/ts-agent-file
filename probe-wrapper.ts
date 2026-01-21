/**
 * probe-wrapper.ts - Lightweight function wrapping utility
 * 
 * This module can be imported directly by user code without triggering probe initialization.
 * It uses the OpenTelemetry API to create spans for tracking function execution.
 * 
 * Compatible with:
 * - Next.js 15/16 (App Router, Server Components)
 * - Node.js / Express
 * - TypeScript / JavaScript projects
 */

import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('probe-wrapper');
const WRAPPED = Symbol('probe_wrapped');

/**
 * Check if the value is a Promise-like object
 */
function isPromiseLike(val: any): val is Promise<any> {
    return val && typeof val === 'object' && typeof val.then === 'function';
}

/**
 * Safely convert a value to a string for span attributes.
 * 
 * This function is designed to be safe for all environments:
 * - Avoids accessing properties on Proxy objects (Next.js headers(), cookies())
 * - Handles circular references gracefully
 * - Limits output size to prevent performance issues
 */
function toStr(val: any): string {
    if (val === undefined) return 'undefined';
    if (val === null) return 'null';
    if (typeof val === 'string') return val.length > 500 ? val.slice(0, 500) + '...' : val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`;
    if (typeof val === 'symbol') return val.toString();

    if (typeof val === 'object') {
        // Handle arrays - just return count, don't iterate
        if (Array.isArray(val)) return `[Array(${val.length})]`;

        // For objects, use constructor name to avoid triggering getters/proxies
        // This is safe for Next.js dynamic APIs like headers(), cookies()
        try {
            const typeName = val.constructor?.name || 'Object';

            // For plain objects, attempt safe JSON serialization
            // but catch any errors from proxy traps
            if (typeName === 'Object') {
                try {
                    const s = JSON.stringify(val);
                    return s && s.length > 500 ? s.slice(0, 500) + '...' : (s || '[Object]');
                } catch {
                    return '[Object]';
                }
            }

            // For class instances or special objects, just return type name
            return `[${typeName}]`;
        } catch {
            return '[Object]';
        }
    }

    return '[unknown]';
}

/**
 * Wrap a function for tracing
 */
function wrapFunction(fn: Function, spanName: string): Function {
    if ((fn as any)[WRAPPED]) return fn;

    const wrapped = function (this: any, ...args: any[]) {
        const span = tracer.startSpan(spanName);

        span.setAttribute('function.name', spanName);
        span.setAttribute('function.type', 'user_function');
        span.setAttribute('function.args.count', args.length);

        // Record arguments (up to 5 for balance between info and safety)
        const maxArgs = Math.min(args.length, 5);
        for (let i = 0; i < maxArgs; i++) {
            span.setAttribute(`function.args.${i}`, toStr(args[i]));
        }

        const ctx = trace.setSpan(context.active(), span);

        try {
            const res = context.with(ctx, () => fn.apply(this, args));

            // Handle async functions (Promise return)
            if (isPromiseLike(res)) {
                return res
                    .then((val) => {
                        span.setAttribute('function.return.value', toStr(val));
                        span.setStatus({ code: SpanStatusCode.OK });
                        span.end();
                        return val;
                    })
                    .catch((err) => {
                        span.recordException(err);
                        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err) });
                        span.end();
                        throw err;
                    });
            }

            // Handle sync functions
            span.setAttribute('function.return.value', toStr(res));
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return res;
        } catch (err: any) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err) });
            span.end();
            throw err;
        }
    };

    (wrapped as any)[WRAPPED] = true;
    // Preserve function name for debugging
    Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true });
    return wrapped;
}

/**
 * Manually wrap a function for tracing
 * @param fn - The function to wrap
 * @param name - Optional span name (defaults to function name)
 * @returns The wrapped function
 * 
 * @example
 * ```typescript
 * import { wrapUserFunction } from './probe-wrapper';
 * 
 * const tracedFunction = wrapUserFunction(function myFunction(a, b) {
 *     return a + b;
 * }, 'myFunction');
 * ```
 */
export function wrapUserFunction<T extends (...args: any[]) => any>(fn: T, name?: string): T {
    const spanName = name || fn.name || 'anonymous';
    return wrapFunction(fn, spanName) as T;
}

/**
 * Wrap all methods on an object
 * @param obj - The object to wrap
 * @param prefix - Span name prefix
 * @returns The wrapped object
 */
export function wrapUserModule<T extends object>(obj: T, prefix?: string): T {
    const moduleName = prefix || 'module';

    for (const key of Object.keys(obj)) {
        const val = (obj as any)[key];
        if (typeof val === 'function' && !(val as any)[WRAPPED]) {
            (obj as any)[key] = wrapFunction(val, `${moduleName}.${key}`);
        }
    }

    return obj;
}

/**
 * Create a traced async function
 * @param fn - The async function to trace
 * @param name - Span name
 */
export function traced<T extends (...args: any[]) => Promise<any>>(fn: T, name?: string): T {
    const spanName = name || fn.name || 'tracedAsync';
    return wrapFunction(fn, spanName) as T;
}
