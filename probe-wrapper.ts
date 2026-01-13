/**
 * probe-wrapper.ts - Lightweight function wrapping utility
 * 
 * This module can be imported directly by user code without triggering probe initialization.
 * It uses the OpenTelemetry API to create spans for tracking function execution.
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
 * Convert the value to a string (used for span attributes)
 */
function toStr(val: any): string {
    if (val === undefined) return '';
    if (val === null) return 'null';
    if (typeof val === 'string') return val.length > 1000 ? val.slice(0, 1000) + '...' : val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return `Array(${val.length})`;
    if (typeof val === 'object') {
        try {
            const s = JSON.stringify(val);
            return s.length > 1000 ? s.slice(0, 1000) + '...' : s;
        } catch {
            return '[unserializable]';
        }
    }
    return String(val);
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

        // Record arguments (up to 10)
        const maxArgs = Math.min(args.length, 10);
        for (let i = 0; i < maxArgs; i++) {
            span.setAttribute(`function.args.${i}`, toStr(args[i]));
        }

        const ctx = trace.setSpan(context.active(), span);

        try {
            const res = context.with(ctx, () => fn.apply(this, args));

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

