"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sdk = void 0;
exports.getSpanCache = getSpanCache;
exports.getSpans = getSpans;
exports.getSpansByTraceId = getSpansByTraceId;
exports.getSpansByFunctionName = getSpansByFunctionName;
exports.getSpansByTimeRange = getSpansByTimeRange;
exports.getTraceIds = getTraceIds;
exports.getSpanStats = getSpanStats;
exports.clearSpans = clearSpans;
exports.getTracesWithSpans = getTracesWithSpans;
exports.wrapUserFunction = wrapUserFunction;
exports.init = init;
const sdk_node_1 = require("@opentelemetry/sdk-node");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const core_1 = require("@opentelemetry/core");
const auto_instrumentations_node_1 = require("@opentelemetry/auto-instrumentations-node");
const api_1 = require("@opentelemetry/api");
const Module = __importStar(require("module"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const util_1 = require("util");
const ws_1 = __importDefault(require("ws"));
const express_1 = __importDefault(require("express"));
// Hardcoded API_KEY
const API_KEY = 'your_api_key';
// Identifier Configuration
const APP_ID = 'ts-6';
const APP_NAME = 'te-demo2';
const PROJECT_ID = 'your-project-id';
// ===== Configuration Switches =====
// Set to false to disable all debug log output in instrumentation.ts file
const ENABLE_DEBUG_LOG = true;
// Set to true to enable CachedSpanExporter console output (disabled by default)
const ENABLE_CONSOLE_EXPORTER = false;
// ===================================
class CachedSpanExporter extends sdk_trace_node_1.ConsoleSpanExporter {
    constructor() {
        super();
        this.enabled = ENABLE_CONSOLE_EXPORTER; // Controlled by global switch
    }
    // Check if span is from instrumentation's own requests (should be filtered out)
    isInstrumentationSpan(span) {
        const attrs = span.attributes;
        const httpUrl = attrs['http.url'];
        const httpHost = attrs['http.host'];
        const netPeerName = attrs['net.peer.name'];
        const httpTarget = attrs['http.target'];
        // Filter out proxy server connection
        if (httpUrl?.includes('api.syn-cause.com') ||
            httpHost?.includes('api.syn-cause.com') ||
            netPeerName?.includes('api.syn-cause.com')) {
            return true;
        }
        // Filter out local instrumentation server requests
        if (httpUrl?.includes('localhost:43210') ||
            httpUrl?.includes('127.0.0.1:43210') ||
            httpHost?.includes('localhost:43210') ||
            httpHost?.includes('127.0.0.1:43210') ||
            httpTarget?.includes('/remote-debug/')) {
            return true;
        }
        return false;
    }
    export(spans, resultCallback) {
        try {
            // Filter out instrumentation's own spans
            const filteredSpans = spans.filter(s => !this.isInstrumentationSpan(s));
            for (const s of filteredSpans)
                spanCache.addSpan(s);
            // Only call parent class export method (console output) when enabled
            if (this.enabled) {
                super.export(filteredSpans, resultCallback);
            }
            else {
                // If not enabled, call callback directly without console output
                if (resultCallback)
                    resultCallback({ code: core_1.ExportResultCode.SUCCESS });
                return;
            }
            if (resultCallback)
                resultCallback({ code: core_1.ExportResultCode.SUCCESS });
        }
        catch {
            if (resultCallback)
                resultCallback({ code: core_1.ExportResultCode.FAILED });
        }
    }
}
class SpanCache {
    constructor() {
        this.spans = new Map();
        this.maxSpans = 10000;
        this.cleanupThreshold = 0.85;
    }
    addSpan(span) {
        const start = span.startTime[0] * 1000000 + span.startTime[1] / 1000;
        const end = span.endTime[0] * 1000000 + span.endTime[1] / 1000;
        const rec = {
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind: String(span.kind),
            startTime: start,
            endTime: end,
            duration: end - start,
            status: { code: span.status.code, message: span.status.message },
            attributes: { ...span.attributes },
            events: (span.events || []).map(e => ({
                name: e.name,
                timestamp: e.time[0] * 1000000 + e.time[1] / 1000,
                attributes: { ...e.attributes },
            })),
            links: (span.links || []).map(l => ({
                traceId: l.context.traceId,
                spanId: l.context.spanId,
                attributes: { ...l.attributes },
            })),
        };
        this.spans.set(rec.spanId, rec);
        if (this.spans.size > this.maxSpans * this.cleanupThreshold)
            this.cleanup();
    }
    getAllSpans(limit) {
        const arr = Array.from(this.spans.values()).sort((a, b) => a.startTime - b.startTime);
        return typeof limit === 'number' ? arr.slice(-limit) : arr;
    }
    getSpansByTraceId(traceId) {
        return this.getAllSpans().filter(s => s.traceId === traceId);
    }
    getSpansByFunctionName(name) {
        return this.getAllSpans().filter(s => s.attributes['function.name'] === name);
    }
    getSpansByTimeRange(startTime, endTime) {
        return this.getAllSpans().filter(s => s.startTime >= startTime && s.endTime <= endTime);
    }
    getTraceIds(startTime, endTime, limit) {
        const spans = this.getAllSpans();
        let filteredSpans = spans;
        if (typeof startTime === 'number' && typeof endTime === 'number') {
            filteredSpans = spans.filter(s => s.startTime >= startTime && s.endTime <= endTime);
        }
        // Extract unique trace IDs, sorted by time
        const traceIds = Array.from(new Set(filteredSpans.map(s => s.traceId)))
            .sort((a, b) => {
            const aTime = Math.min(...spans.filter(s => s.traceId === a).map(s => s.startTime));
            const bTime = Math.min(...spans.filter(s => s.traceId === b).map(s => s.startTime));
            return bTime - aTime; // Newest first
        });
        return typeof limit === 'number' ? traceIds.slice(0, limit) : traceIds;
    }
    clear() { this.spans.clear(); }
    getStatistics() {
        const spans = Array.from(this.spans.values());
        const traceIds = new Set(spans.map(s => s.traceId));
        const fnNames = new Set(spans.map(s => s.attributes['function.name']).filter(Boolean));
        const durations = spans.map(s => s.duration);
        return {
            totalSpans: spans.length,
            totalTraces: traceIds.size,
            totalFunctions: fnNames.size,
            oldestSpan: spans.length ? Math.min(...spans.map(s => s.startTime)) : 0,
            newestSpan: spans.length ? Math.max(...spans.map(s => s.startTime)) : 0,
            averageDuration: spans.length ? durations.reduce((a, b) => a + b, 0) / spans.length : 0,
        };
    }
    cleanup() {
        const arr = this.getAllSpans();
        const drop = Math.floor(arr.length * 0.2);
        for (let i = 0; i < drop; i++)
            this.spans.delete(arr[i].spanId);
    }
}
const spanCache = new SpanCache();
function getSpanCache() { return spanCache; }
function getSpans(limit) { return spanCache.getAllSpans(limit); }
function getSpansByTraceId(traceId) { return spanCache.getSpansByTraceId(traceId); }
function getSpansByFunctionName(name) { return spanCache.getSpansByFunctionName(name); }
function getSpansByTimeRange(startTime, endTime) { return spanCache.getSpansByTimeRange(startTime, endTime); }
function getTraceIds(startTime, endTime, limit) { return spanCache.getTraceIds(startTime, endTime, limit); }
function getSpanStats() { return spanCache.getStatistics(); }
function clearSpans() { spanCache.clear(); }
// Get traces with full span data grouped by traceId
function getTracesWithSpans(startTime, endTime, limit) {
    const allSpans = spanCache.getAllSpans();
    let filteredSpans = allSpans;
    // Filter by time range if provided
    if (startTime !== undefined || endTime !== undefined) {
        filteredSpans = allSpans.filter(span => {
            const spanTime = span.startTime;
            return (startTime === undefined || spanTime >= startTime) &&
                (endTime === undefined || spanTime <= endTime);
        });
    }
    // Group spans by traceId
    const traceGroups = new Map();
    filteredSpans.forEach(span => {
        const traceId = span.traceId;
        if (!traceGroups.has(traceId)) {
            traceGroups.set(traceId, []);
        }
        traceGroups.get(traceId).push(span);
    });
    // Convert to the desired format
    const traces = Array.from(traceGroups.entries()).map(([traceId, spans]) => {
        const startTimeMilli = Math.min(...spans.map(s => s.startTime)) / 1000;
        // Convert spans to the expected format and filter out those without function.name
        const formattedSpans = spans
            .filter(span => !!span.attributes['function.name'])
            .map(span => {
            const spanData = {
                attributes: span.attributes,
                name: span.name,
                endEpochNanos: span.endTime,
                startEpochNanos: span.startTime,
                traceId: span.traceId,
                spanId: span.spanId
            };
            // Only include parentSpanId if it exists
            if (span.parentSpanId) {
                spanData.parentSpanId = span.parentSpanId;
            }
            // 添加显式的调用者信息字段（从 attributes 中提取）
            if (span.attributes['function.caller.name']) {
                spanData.callerName = span.attributes['function.caller.name'];
            }
            if (span.attributes['function.caller.spanId']) {
                spanData.callerSpanId = span.attributes['function.caller.spanId'];
            }
            return spanData;
        });
        return {
            traceId,
            type: 'ts',
            spans: formattedSpans,
            startTimeMilli: Math.floor(startTimeMilli)
        };
    });
    // Sort by startTimeMilli (newest first) and apply limit
    traces.sort((a, b) => b.startTimeMilli - a.startTimeMilli);
    return typeof limit === 'number' ? traces.slice(0, limit) : traces;
}
// In development, disable auto instrumentations to avoid HMR conflicts
const isDevelopment = process.env.NODE_ENV === 'development';
const sdk = new sdk_node_1.NodeSDK({
    traceExporter: new CachedSpanExporter(),
    // Disabled to reduce console noise
    // metricReader: new PeriodicExportingMetricReader({
    //     exporter: new ConsoleMetricExporter(),
    // }),
    // Only enable auto instrumentations in production
    instrumentations: isDevelopment ? [] : [(0, auto_instrumentations_node_1.getNodeAutoInstrumentations)()],
});
exports.sdk = sdk;
const tracer = api_1.trace.getTracer('app');
const WRAPPED = Symbol('otel_wrapped');
const wrappedModules = new Set();
// SpanId -> FunctionName mapping table for tracking callers
const spanNameMap = new Map();
const SPAN_NAME_MAP_MAX_SIZE = 10000;
function recordSpanName(spanId, functionName) {
    spanNameMap.set(spanId, functionName);
    // Clean up expired mappings to prevent memory leaks
    if (spanNameMap.size > SPAN_NAME_MAP_MAX_SIZE) {
        const keysToDelete = Array.from(spanNameMap.keys()).slice(0, 1000);
        keysToDelete.forEach(k => spanNameMap.delete(k));
    }
}
function getCallerName(parentSpanId) {
    return parentSpanId ? spanNameMap.get(parentSpanId) : undefined;
}
function cleanupSpanName(spanId) {
    // Delayed cleanup to allow time for async operations
    setTimeout(() => spanNameMap.delete(spanId), 5000);
}
// Intercept console.log and other console methods
const consoleMethods = ['log', 'error', 'warn', 'info', 'debug'];
const originalConsole = {};
// Save original console methods first
consoleMethods.forEach(method => {
    originalConsole[method] = console[method];
});
// Log file path
const LOG_DIR = path.join(process.cwd(), '.syncause');
const LOG_FILE = path.join(LOG_DIR, 'ts_agent.log');
// Ensure log directory exists
function ensureLogDir() {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
    }
    catch (e) {
        // Ignore directory creation errors
    }
}
// Write log to file
function writeToLogFile(level, ...args) {
    if (!ENABLE_DEBUG_LOG)
        return;
    try {
        ensureLogDir();
        const timestamp = new Date().toISOString();
        const message = args.map(arg => {
            if (typeof arg === 'string')
                return arg;
            try {
                return JSON.stringify(arg);
            }
            catch {
                return String(arg);
            }
        }).join(' ');
        const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
        fs.appendFileSync(LOG_FILE, logLine);
    }
    catch (e) {
        // Ignore write errors
    }
}
// Wrap log methods to write to file instead of console
const debugLog = {
    log: (...args) => writeToLogFile('log', ...args),
    error: (...args) => writeToLogFile('error', ...args),
    warn: (...args) => writeToLogFile('warn', ...args),
    info: (...args) => writeToLogFile('info', ...args),
    debug: (...args) => writeToLogFile('debug', ...args),
};
function isPromiseLike(x) {
    return x && typeof x.then === 'function';
}
function toStr(v) {
    try {
        if (v === undefined)
            return '';
        if (v === null)
            return 'null';
        if (typeof v === 'string')
            return v;
        if (typeof v === 'number' || typeof v === 'boolean')
            return String(v);
        const seen = new WeakSet();
        const replacer = (_key, value) => {
            if (typeof value === 'bigint')
                return value.toString();
            if (typeof value === 'function')
                return `[Function ${value.name || 'anonymous'}]`;
            if (typeof value === 'symbol')
                return value.toString();
            if (value instanceof Date)
                return value.toISOString();
            if (value instanceof Map)
                return { __type: 'Map', value: Array.from(value.entries()) };
            if (value instanceof Set)
                return { __type: 'Set', value: Array.from(value.values()) };
            if (value instanceof Error)
                return { name: value.name, message: value.message, stack: value.stack };
            if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) {
                return { __type: 'Buffer', length: value.length };
            }
            if (value && typeof value === 'object') {
                if (seen.has(value))
                    return '[Circular]';
                seen.add(value);
            }
            return value;
        };
        let s = JSON.stringify(v, replacer);
        if (typeof s !== 'string')
            s = String(s);
        if (s.length > 4000)
            s = s.slice(0, 4000) + '...';
        return s;
    }
    catch {
        try {
            const s = (0, util_1.inspect)(v, { depth: 2, maxArrayLength: 50, breakLength: 120 });
            return s.length > 4000 ? s.slice(0, 4000) + '...' : s;
        }
        catch {
            return '[unserializable]';
        }
    }
}
function wrapFunction(fn, spanName, type = 'user_function') {
    if (fn[WRAPPED])
        return fn;
    const wrapped = function (...args) {
        // Get parent span information
        const parentSpan = api_1.trace.getSpan(api_1.context.active());
        const parentSpanContext = parentSpan?.spanContext();
        const parentSpanId = parentSpanContext?.spanId;
        const callerName = getCallerName(parentSpanId);
        const span = tracer.startSpan(spanName);
        const spanId = span.spanContext().spanId;
        // Record current span's function name to mapping table
        recordSpanName(spanId, spanName);
        span.setAttribute('function.name', spanName);
        span.setAttribute('function.type', type);
        span.setAttribute('function.args.count', args.length);
        // Record caller information
        if (callerName) {
            span.setAttribute('function.caller.name', callerName);
        }
        if (parentSpanId) {
            span.setAttribute('function.caller.spanId', parentSpanId);
        }
        const maxArgs = Math.min(args.length, 10);
        for (let i = 0; i < maxArgs; i++) {
            span.setAttribute(`function.args.${i}`, toStr(args[i]));
        }
        const ctx = api_1.trace.setSpan(api_1.context.active(), span);
        try {
            const res = api_1.context.with(ctx, () => fn.apply(this, args));
            if (isPromiseLike(res)) {
                return res
                    .then((val) => {
                    span.setAttribute('function.return.value', toStr(val));
                    span.setStatus({ code: api_1.SpanStatusCode.OK });
                    span.end();
                    cleanupSpanName(spanId);
                    return val;
                })
                    .catch((err) => {
                    span.recordException(err);
                    span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: String(err?.message || err) });
                    span.end();
                    cleanupSpanName(spanId);
                    throw err;
                });
            }
            span.setAttribute('function.return.value', toStr(res));
            span.setStatus({ code: api_1.SpanStatusCode.OK });
            span.end();
            cleanupSpanName(spanId);
            return res;
        }
        catch (err) {
            span.recordException(err);
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: String(err?.message || err) });
            span.end();
            cleanupSpanName(spanId);
            throw err;
        }
    };
    wrapped[WRAPPED] = true;
    return wrapped;
}
/**
 * Manually wrap a function for tracing - exported for user code
 * @param fn - The function to wrap
 * @param name - Optional span name (defaults to function name)
 * @returns The wrapped function
 */
function wrapUserFunction(fn, name) {
    const spanName = name || fn.name || 'anonymous';
    return wrapFunction(fn, spanName, 'user_function');
}
function wrapClassPrototype(cls, className) {
    if (!cls || !cls.prototype) {
        debugLog.log(`[DEBUG] wrapClassPrototype: No class or prototype for ${className}`);
        return;
    }
    const names = Object.getOwnPropertyNames(cls.prototype);
    // Skip built-in prototypes
    const builtinPrototypes = ['Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Error', 'Buffer'];
    if (builtinPrototypes.includes(className) || builtinPrototypes.includes(cls.name)) {
        debugLog.log(`[DEBUG] wrapClassPrototype: Skipping built-in prototype ${className}`);
        return;
    }
    // Logger public methods whitelist - only wrap these methods, skip internal helper methods like formatMessage
    const loggerPublicMethods = ['info', 'warn', 'error', 'debug', 'log', 'trace', 'fatal', 'verbose', 'silly'];
    const isLoggerClass = className.toLowerCase().includes('logger') ||
        loggerPublicMethods.some(m => names.includes(m));
    for (const name of names) {
        if (name === 'constructor')
            continue;
        // Skip built-in method names that might cause issues
        if (['toString', 'toJSON', 'valueOf', 'inspect'].includes(name))
            continue;
        // If it's a Logger class, only wrap public log methods
        if (isLoggerClass && !loggerPublicMethods.includes(name)) {
            debugLog.log(`[DEBUG] wrapClassPrototype: Skipping internal method ${className}.${name}`);
            continue;
        }
        const desc = Object.getOwnPropertyDescriptor(cls.prototype, name);
        if (!desc)
            continue;
        const fn = desc.value;
        if (typeof fn !== 'function')
            continue;
        const spanName = `${className}.${name}`;
        debugLog.log(`[DEBUG] wrapClassPrototype: Wrapping method ${name} -> ${spanName}`);
        const newFn = wrapFunction(fn, spanName, 'class_method');
        if (newFn !== fn) {
            Object.defineProperty(cls.prototype, name, { ...desc, value: newFn });
            debugLog.log(`[DEBUG] wrapClassPrototype: Successfully wrapped ${name}`);
        }
    }
}
function wrapExports(mod, modulePath) {
    if (!mod)
        return mod;
    if (wrappedModules.has(modulePath))
        return mod;
    const base = path.basename(modulePath, path.extname(modulePath));
    // Add wrapping logs
    debugLog.log(`[DEBUG] wrapExports called for module: ${modulePath}, base: ${base}`);
    debugLog.log(`[DEBUG] Module exports type: ${typeof mod}, keys: ${typeof mod === 'object' ? Object.keys(mod) : 'N/A'}`);
    if (typeof mod === 'function') {
        const isClass = !!(mod.prototype && Object.getOwnPropertyNames(mod.prototype).length > 1);
        if (isClass) {
            wrapClassPrototype(mod, mod.name || base);
            wrappedModules.add(modulePath);
            return mod;
        }
        else {
            const wrapped = wrapFunction(mod, `${base}.${mod.name || 'default'}`, 'user_function');
            wrappedModules.add(modulePath);
            return wrapped;
        }
    }
    if (typeof mod === 'object') {
        debugLog.log(`[DEBUG] Processing object module with ${Object.keys(mod).length} properties`);
        for (const key of Object.keys(mod)) {
            const val = mod[key];
            if (typeof val === 'function') {
                debugLog.log(`[DEBUG] Found function: ${key}, type: ${val.name || 'anonymous'}, has prototype: ${!!val.prototype}`);
                if (val.prototype && Object.getOwnPropertyNames(val.prototype).length > 1) {
                    debugLog.log(`[DEBUG] Wrapping class prototype for: ${key}`);
                    wrapClassPrototype(val, val.name || `${base}.${key}`);
                }
                else {
                    debugLog.log(`[DEBUG] Wrapping function: ${key} -> ${base}.${key}`);
                    mod[key] = wrapFunction(val, `${base}.${key}`, 'user_function');
                }
            }
            else if (typeof val === 'object' && val !== null) {
                debugLog.log(`[DEBUG] Found object: ${key}, checking for methods...`);
                // Check object instance (e.g. logger instance)
                // Logger public methods whitelist - only wrap these methods, skip internal helper methods like formatMessage
                const loggerPublicMethods = ['info', 'warn', 'error', 'debug', 'log', 'trace', 'fatal', 'verbose', 'silly'];
                const isLoggerLike = loggerPublicMethods.some(m => typeof val[m] === 'function');
                // Check direct properties
                for (const objKey of Object.keys(val)) {
                    const objVal = val[objKey];
                    if (typeof objVal === 'function') {
                        // If it's a Logger-like object, only wrap public log methods
                        if (isLoggerLike) {
                            if (!loggerPublicMethods.includes(objKey)) {
                                debugLog.log(`[DEBUG] Skipping internal method on ${key}: ${objKey}`);
                                continue;
                            }
                        }
                        debugLog.log(`[DEBUG] Found method on ${key}: ${objKey}, type: ${objVal.name || 'anonymous'}`);
                        if (objVal.prototype && Object.getOwnPropertyNames(objVal.prototype).length > 1) {
                            debugLog.log(`[DEBUG] Wrapping class prototype for method: ${key}.${objKey}`);
                            wrapClassPrototype(objVal, objVal.name || `${key}.${objKey}`);
                        }
                        else {
                            debugLog.log(`[DEBUG] Wrapping method: ${key}.${objKey} -> ${key}.${objKey}`);
                            val[objKey] = wrapFunction(objVal, `${key}.${objKey}`, 'user_function');
                        }
                    }
                }
                // Check methods on prototype chain - also apply whitelist for Logger classes
                const proto = Object.getPrototypeOf(val);
                if (proto && proto !== Object.prototype) {
                    debugLog.log(`[DEBUG] Checking prototype for ${key}:`, proto.constructor.name);
                    // Skip prototype wrapping for Logger classes since we already handled public methods above
                    if (!isLoggerLike) {
                        wrapClassPrototype(val.constructor, `${key}_class`);
                    }
                }
            }
        }
    }
    wrappedModules.add(modulePath);
    return mod;
}
function shouldWrap(resolvedPath) {
    if (!resolvedPath)
        return false;
    if (Module.builtinModules.includes(resolvedPath))
        return false;
    if (resolvedPath.includes(`${path.sep}node_modules${path.sep}`))
        return false;
    // Don't trace the instrumentation files themselves
    if (resolvedPath.includes('instrumentation.ts') ||
        resolvedPath.includes('instrumentation.js') ||
        resolvedPath.includes('instrumentation.node.ts') ||
        resolvedPath.includes('probe-wrapper'))
        return false;
    const cwd = process.cwd();
    return resolvedPath.startsWith(cwd);
}
function wrapRequireCache() {
    const cache = Module._cache || {};
    debugLog.log(`[DEBUG] wrapRequireCache: Found ${Object.keys(cache).length} modules in cache`);
    let wrappedCount = 0;
    for (const p of Object.keys(cache)) {
        try {
            if (shouldWrap(p)) {
                debugLog.log(`[DEBUG] wrapRequireCache: Should wrap module: ${p}`);
                const entry = cache[p];
                if (entry && entry.exports) {
                    entry.exports = wrapExports(entry.exports, p);
                    wrappedCount++;
                }
            }
        }
        catch (err) {
            debugLog.log(`[DEBUG] wrapRequireCache: Error wrapping ${p}:`, err);
        }
    }
    debugLog.log(`[DEBUG] wrapRequireCache: Wrapped ${wrappedCount} modules`);
}
// Intercept console.log and other console methods
// Only in production to avoid HMR conflicts in development
const isInstrumenting = Symbol('is_instrumenting');
if (!isDevelopment) {
    consoleMethods.forEach(method => {
        const originalFn = console[method];
        if (typeof originalFn === 'function') {
            originalConsole[method] = originalFn;
            console[method] = function (...args) {
                // If currently in instrumentation, call original function directly to avoid recursion
                if (console[isInstrumenting]) {
                    return originalFn.apply(console, args);
                }
                console[isInstrumenting] = true;
                try {
                    // Get parent span information
                    const parentSpan = api_1.trace.getSpan(api_1.context.active());
                    const parentSpanContext = parentSpan?.spanContext();
                    const parentSpanId = parentSpanContext?.spanId;
                    const callerName = getCallerName(parentSpanId);
                    const spanName = `console.${method}`;
                    const span = tracer.startSpan(spanName);
                    const spanId = span.spanContext().spanId;
                    // Record current span's function name to mapping table
                    recordSpanName(spanId, spanName);
                    span.setAttribute('function.name', spanName);
                    span.setAttribute('function.type', 'log');
                    span.setAttribute('function.args.count', args.length);
                    // Record caller information
                    if (callerName) {
                        span.setAttribute('function.caller.name', callerName);
                    }
                    if (parentSpanId) {
                        span.setAttribute('function.caller.spanId', parentSpanId);
                    }
                    // Record arguments
                    const maxArgs = Math.min(args.length, 10);
                    for (let i = 0; i < maxArgs; i++) {
                        span.setAttribute(`function.args.${i}`, toStr(args[i]));
                    }
                    const ctx = api_1.trace.setSpan(api_1.context.active(), span);
                    try {
                        // Call original function directly without context.with to avoid possible recursion
                        const result = originalFn.apply(console, args);
                        span.setAttribute('function.return.value', toStr(result));
                        span.setStatus({ code: api_1.SpanStatusCode.OK });
                        span.end();
                        cleanupSpanName(spanId);
                        return result;
                    }
                    catch (err) {
                        span.recordException(err);
                        span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: String(err?.message || err) });
                        span.end();
                        cleanupSpanName(spanId);
                        throw err;
                    }
                }
                finally {
                    console[isInstrumenting] = false;
                }
            };
        }
    });
    // Use debugLog to output debug information, avoid recursion
    debugLog.log(`[DEBUG] Intercepted ${consoleMethods.length} console methods: ${consoleMethods.join(', ')}`);
}
else {
    debugLog.log('[DEBUG] Console interception skipped in development mode');
}
let wsConnection = null;
let instrumentationConnected = false;
let heartbeatInterval = null;
function startHeartbeatLoop() {
    if (heartbeatInterval)
        clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (wsConnection && wsConnection.readyState === ws_1.default.OPEN) {
            const heartbeatMessage = {
                type: 'heartbeat',
                app_id: APP_ID, // Required at top level
                data: {
                    app_id: APP_ID,
                    status: 'active',
                    timestamp: new Date().toISOString(),
                    metadata: {
                        span_count: spanCache.getStatistics().totalSpans,
                        trace_count: spanCache.getStatistics().totalTraces
                    }
                }
            };
            wsConnection.send(JSON.stringify(heartbeatMessage));
            debugLog.log('[DEBUG] Sent heartbeat to proxy');
        }
    }, 30000); // Send heartbeat every 30 seconds
}
function connectToProxyServer() {
    if (instrumentationConnected && wsConnection && wsConnection.readyState === ws_1.default.OPEN) {
        return;
    }
    const wsUrl = process.env.PROXY_WS_URL || 'wss://api.syn-cause.com/codeproxy/ws';
    const apiKey = API_KEY;
    try {
        const urlWithAuth = apiKey
            ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}api_key=${apiKey}`
            : wsUrl;
        wsConnection = new ws_1.default(urlWithAuth);
        wsConnection.on('open', () => {
            instrumentationConnected = true;
            debugLog.log(`[DEBUG] Connected to proxy server at ${wsUrl}`);
            // Register as an instrumentation application
            const registerMessage = {
                type: 'register',
                app_id: APP_ID,
                data: {
                    app_id: APP_ID,
                    app_name: APP_NAME,
                    project_id: PROJECT_ID,
                    version: '1.0.0',
                    description: 'OpenTelemetry instrumentation service',
                    metadata: {
                        language: 'typescript',
                        type: 'instrumentation',
                        capabilities: ['spans', 'traces', 'metrics']
                    }
                }
            };
            wsConnection.send(JSON.stringify(registerMessage));
            // Start sending heartbeats
            startHeartbeatLoop();
        });
        wsConnection.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                handleProxyMessage(message);
            }
            catch (error) {
                debugLog.error('[DEBUG] Failed to parse proxy message:', error);
            }
        });
        wsConnection.on('close', (code, reason) => {
            instrumentationConnected = false;
            debugLog.log(`[DEBUG] Disconnected from proxy server (${wsUrl}): ${code} - ${reason.toString()}`);
            // Attempt to reconnect after 5 seconds
            setTimeout(() => {
                if (!instrumentationConnected) {
                    connectToProxyServer();
                }
            }, 5000);
        });
        wsConnection.on('error', (error) => {
            const errorInfo = {
                message: error?.message || String(error),
                code: error?.code,
                errno: error?.errno,
                syscall: error?.syscall,
                address: error?.address,
                port: error?.port,
            };
            debugLog.error(`[DEBUG] WebSocket error (${wsUrl}):`, JSON.stringify(errorInfo));
            instrumentationConnected = false;
        });
    }
    catch (error) {
        debugLog.error(`[DEBUG] Failed to connect to proxy server (${wsUrl}):`, error);
        // Retry connection after 5 seconds
        setTimeout(() => {
            connectToProxyServer();
        }, 5000);
    }
}
function handleProxyMessage(message) {
    try {
        switch (message.type) {
            case 'response':
                debugLog.log('[DEBUG] Received response from server:', JSON.stringify(message.data));
                break;
            case 'heartbeat':
                // Server heartbeat received (if any)
                // We don't need to respond if we are the ones initiating heartbeats,
                // but we can log it or just ignore it.
                debugLog.log('[DEBUG] Received heartbeat from server');
                break;
            case 'data':
                // Handle data requests
                handleDataRequest(message.data);
                break;
            default:
                debugLog.log(`[DEBUG] Unknown message type: ${message.type}`);
        }
    }
    catch (error) {
        debugLog.error('[DEBUG] Error handling proxy message:', error);
    }
}
function handleDataRequest(incomingData) {
    if (!wsConnection || wsConnection.readyState !== ws_1.default.OPEN) {
        debugLog.log('[DEBUG] handleDataRequest: WebSocket not open');
        return;
    }
    try {
        debugLog.log('[DEBUG] Raw incoming data:', JSON.stringify(incomingData));
        // Unwrap DataTransferData if present
        // The proxy sends DataTransferData { source, target, data }. 
        // If source is empty string, it's falsy, so we check for existence of 'data' property
        // and absence of 'action' property at the top level to distinguish from unwrapped payload.
        const requestData = (incomingData.data && !incomingData.action) ? incomingData.data : incomingData;
        debugLog.log('[DEBUG] Unwrapped request data:', JSON.stringify(requestData));
        const { action, params = {} } = requestData;
        if (!requestData.request_id) {
            debugLog.warn('[DEBUG] Warning: request_id missing in requestData');
        }
        const response = {
            type: 'data_response',
            data: {
                request_id: requestData.request_id,
                app_id: APP_ID,
                success: true
            }
        };
        switch (action) {
            case 'get_spans':
                const startTime = params.startTime ? parseInt(params.startTime) : undefined;
                const endTime = params.endTime ? parseInt(params.endTime) : undefined;
                const traceId = params.traceId;
                const functionName = params.functionName;
                const limit = params.limit ? parseInt(params.limit) : undefined;
                let spans;
                if (typeof startTime === 'number' && typeof endTime === 'number') {
                    spans = getSpansByTimeRange(startTime, endTime);
                }
                else if (traceId) {
                    spans = getSpansByTraceId(traceId);
                }
                else if (functionName) {
                    spans = getSpansByFunctionName(functionName);
                }
                else {
                    spans = getSpans(limit);
                }
                response.data.spans = spans.map(s => ({
                    traceId: s.traceId,
                    spanId: s.spanId,
                    parentSpanId: s.parentSpanId,
                    name: s.name,
                    kind: s.kind,
                    startTime: new Date(s.startTime / 1000000).toISOString(),
                    endTime: new Date(s.endTime / 1000000).toISOString(),
                    durationMs: s.duration / 1000000,
                    status: s.status,
                    attributes: s.attributes,
                    events: s.events,
                    links: s.links,
                }));
                response.data.total = spans.length;
                response.data.query = { startTime, endTime, traceId, functionName, limit };
                break;
            case 'get_traces':
                const tracesStartTime = params?.startTime ? parseInt(params.startTime) : undefined;
                const tracesEndTime = params?.endTime ? parseInt(params.endTime) : undefined;
                const tracesLimit = params?.limit ? parseInt(params.limit) : undefined;
                const traces = getTracesWithSpans(tracesStartTime, tracesEndTime, tracesLimit);
                response.data.traces = traces;
                response.data.total = traces.length;
                response.data.query = { startTime: tracesStartTime, endTime: tracesEndTime, limit: tracesLimit };
                break;
            case 'get_stats':
                const stats = getSpanStats();
                response.data.stats = {
                    ...stats,
                    oldestSpan: stats.oldestSpan ? new Date(stats.oldestSpan / 1000000).toISOString() : null,
                    newestSpan: stats.newestSpan ? new Date(stats.newestSpan / 1000000).toISOString() : null,
                    averageDurationMs: stats.averageDuration / 1000000,
                };
                break;
            case 'clear_spans':
                clearSpans();
                response.data.message = 'Span cache cleared';
                break;
            default:
                response.data.success = false;
                response.data.error = `Unknown action: ${action}`;
        }
        response.data.timestamp = new Date().toISOString();
        wsConnection.send(JSON.stringify(response));
    }
    catch (error) {
        // Try to extract request_id from incomingData
        const reqData = (incomingData.data && !incomingData.action) ? incomingData.data : incomingData;
        const requestId = reqData ? reqData.request_id : 'unknown';
        const errorResponse = {
            type: 'data_response',
            data: {
                request_id: requestId,
                app_id: APP_ID,
                success: false,
                error: error?.message || String(error),
                timestamp: new Date().toISOString()
            }
        };
        wsConnection.send(JSON.stringify(errorResponse));
    }
}
let instrumentationServerStarted = false;
function startInstrumentationServer() {
    if (instrumentationServerStarted)
        return;
    const port = process.env.INSTRUMENTATION_PORT ? parseInt(process.env.INSTRUMENTATION_PORT, 10) : 43210;
    const app = (0, express_1.default)();
    app.get('/remote-debug/spans', (req, res) => {
        try {
            const startTime = req.query.startTime ? parseInt(String(req.query.startTime)) : undefined;
            const endTime = req.query.endTime ? parseInt(String(req.query.endTime)) : undefined;
            const traceId = req.query.traceId ? String(req.query.traceId) : undefined;
            const functionName = req.query.functionName ? String(req.query.functionName) : undefined;
            const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
            let spans;
            if (typeof startTime === 'number' && typeof endTime === 'number') {
                spans = getSpansByTimeRange(startTime, endTime);
            }
            else if (traceId) {
                spans = getSpansByTraceId(traceId);
            }
            else if (functionName) {
                spans = getSpansByFunctionName(functionName);
            }
            else {
                spans = getSpans(limit);
            }
            res.json({
                success: true,
                data: {
                    spans: spans.map(s => ({
                        traceId: s.traceId,
                        spanId: s.spanId,
                        parentSpanId: s.parentSpanId,
                        name: s.name,
                        kind: s.kind,
                        startTime: new Date(s.startTime / 1000000).toISOString(),
                        endTime: new Date(s.endTime / 1000000).toISOString(),
                        durationMs: s.duration / 1000000,
                        status: s.status,
                        attributes: s.attributes,
                        events: s.events,
                        links: s.links,
                    })),
                    total: spans.length,
                    query: { startTime, endTime, traceId, functionName, limit }
                },
                metadata: { timestamp: new Date().toISOString(), endpoint: '/remote-debug/spans' },
            });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message || String(error), timestamp: new Date().toISOString() });
        }
    });
    app.get('/remote-debug/traces', (req, res) => {
        try {
            const startTime = req.query.startTime ? parseInt(String(req.query.startTime)) : undefined;
            const endTime = req.query.endTime ? parseInt(String(req.query.endTime)) : undefined;
            const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
            const traces = getTracesWithSpans(startTime, endTime, limit);
            res.json(traces);
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message || String(error), timestamp: new Date().toISOString() });
        }
    });
    app.get('/remote-debug/spans/stats', (_req, res) => {
        try {
            const stats = getSpanStats();
            res.json({
                success: true,
                data: {
                    ...stats,
                    oldestSpan: stats.oldestSpan ? new Date(stats.oldestSpan / 1000000).toISOString() : null,
                    newestSpan: stats.newestSpan ? new Date(stats.newestSpan / 1000000).toISOString() : null,
                    averageDurationMs: stats.averageDuration / 1000000,
                },
                metadata: { timestamp: new Date().toISOString(), endpoint: '/remote-debug/spans/stats' },
            });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message || String(error), timestamp: new Date().toISOString() });
        }
    });
    app.delete('/remote-debug/spans', (_req, res) => {
        try {
            clearSpans();
            res.json({ success: true, message: 'Span cache cleared', metadata: { timestamp: new Date().toISOString(), endpoint: '/remote-debug/spans' } });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message || String(error), timestamp: new Date().toISOString() });
        }
    });
    app.listen(port, () => {
        debugLog.log(`[DEBUG] HTTP instrumentation server started on port ${port}`);
        instrumentationServerStarted = true;
    });
}
let sdkInitialized = false;
function init() {
    if (sdkInitialized) {
        debugLog.log('[DEBUG] OpenTelemetry SDK already initialized, skipping...');
        return;
    }
    sdkInitialized = true;
    sdk.start();
    debugLog.log('[DEBUG] OpenTelemetry SDK started');
    // Start connection to proxy server
    connectToProxyServer();
    // Start instrumentation HTTP server
    startInstrumentationServer();
    // NOTE: wrapRequireCache() and Module.prototype.require hook are disabled
    // because they cause:
    // - HMR loop in development (Webpack conflict)
    // - TypeError: b.C is not a function in production (minification conflict)
    // 
    // Use the Webpack Loader (probe-loader.js) for function wrapping instead.
    // The Loader only runs in production builds (configured in next.config.ts).
    debugLog.log('[DEBUG] Instrumentation initialized (Loader-based wrapping in production)');
}
// Auto initialize: automatically start when file is loaded via --require or --import
init();
