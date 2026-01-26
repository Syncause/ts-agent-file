const WRAPPED = Symbol('probe_wrapped');

let currentTraceId = null;
const callStack = [];
const spanRecords = [];
const MAX_SPANS = 10000;

function generateId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

function toStr(val) {
    if (val === undefined) return '';
    if (val === null) return 'null';
    if (typeof val === 'string') return val.length > 500 ? val.slice(0, 500) + '...' : val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
    if (Array.isArray(val)) return `Array(${val.length})`;
    if (typeof val === 'object') {
        try {
            const s = JSON.stringify(val);
            return s.length > 500 ? s.slice(0, 500) + '...' : s;
        } catch {
            return '[unserializable]';
        }
    }
    return String(val);
}

function isPromiseLike(val) {
    return val && typeof val === 'object' && typeof val.then === 'function';
}

function getCurrentParent() {
    return callStack.length > 0 ? callStack[callStack.length - 1] : undefined;
}

function recordSpan(entry, endTime, status, returnValue, errorMessage) {
    if (spanRecords.length >= MAX_SPANS) {
        spanRecords.splice(0, 1000);
    }
    
    const record = {
        traceId: currentTraceId || generateId(),
        spanId: entry.spanId,
        parentSpanId: entry.parentSpanId,
        name: entry.functionName,
        location: entry.location,
        startTime: entry.startTime,
        endTime: endTime,
        duration: endTime - entry.startTime,
        status: status,
        args: entry.args.slice(0, 10).map(toStr),
        callerName: entry.parentSpanId ? callStack.find(e => e.spanId === entry.parentSpanId)?.functionName : undefined,
    };
    
    if (returnValue !== undefined) {
        record.returnValue = toStr(returnValue);
    }
    
    if (errorMessage) {
        record.errorMessage = errorMessage;
    }
    
    spanRecords.push(record);
}

function __probe_wrap(fn, name, location) {
    if (fn[WRAPPED]) return fn;
    
    location = location || '';
    
    const wrapped = function(...args) {
        if (!currentTraceId) {
            currentTraceId = generateId();
        }
        
        const parent = getCurrentParent();
        const entry = {
            spanId: generateId(),
            functionName: name,
            location: location,
            startTime: Date.now(),
            args: args,
            parentSpanId: parent?.spanId,
        };
        
        callStack.push(entry);
        
        try {
            const result = fn.apply(this, args);
            
            if (isPromiseLike(result)) {
                return result
                    .then((val) => {
                        const endTime = Date.now();
                        callStack.pop();
                        recordSpan(entry, endTime, 'ok', val);
                        
                        if (callStack.length === 0) {
                            currentTraceId = null;
                        }
                        return val;
                    })
                    .catch((err) => {
                        const endTime = Date.now();
                        callStack.pop();
                        recordSpan(entry, endTime, 'error', undefined, String(err?.message || err));
                        
                        if (callStack.length === 0) {
                            currentTraceId = null;
                        }
                        throw err;
                    });
            }
            
            const endTime = Date.now();
            callStack.pop();
            recordSpan(entry, endTime, 'ok', result);
            
            if (callStack.length === 0) {
                currentTraceId = null;
            }
            
            return result;
        } catch (err) {
            const endTime = Date.now();
            callStack.pop();
            recordSpan(entry, endTime, 'error', undefined, String(err?.message || err));
            
            if (callStack.length === 0) {
                currentTraceId = null;
            }
            throw err;
        }
    };
    
    wrapped[WRAPPED] = true;
    Object.defineProperty(wrapped, 'name', { value: name, configurable: true });
    
    return wrapped;
}

function __probe_enter(name, location, args) {
    if (!currentTraceId) {
        currentTraceId = generateId();
    }
    
    const parent = getCurrentParent();
    const entry = {
        spanId: generateId(),
        functionName: name,
        location: location,
        startTime: Date.now(),
        args: args || [],
        parentSpanId: parent?.spanId,
    };
    
    callStack.push(entry);
    return { spanId: entry.spanId };
}

function __probe_exit(spanId, returnValue, error) {
    const entryIndex = callStack.findIndex(e => e.spanId === spanId);
    if (entryIndex === -1) return;
    
    const entry = callStack[entryIndex];
    const endTime = Date.now();
    
    callStack.splice(entryIndex, 1);
    
    if (error) {
        recordSpan(entry, endTime, 'error', undefined, String(error?.message || error));
    } else {
        recordSpan(entry, endTime, 'ok', returnValue);
    }
    
    if (callStack.length === 0) {
        currentTraceId = null;
    }
}

function getSpans(limit) {
    const sorted = [...spanRecords].sort((a, b) => a.startTime - b.startTime);
    return limit ? sorted.slice(-limit) : sorted;
}

function getSpansByTraceId(traceId) {
    return spanRecords.filter(s => s.traceId === traceId);
}

function getTraces(limit) {
    const traceMap = new Map();
    
    for (const span of spanRecords) {
        const existing = traceMap.get(span.traceId) || [];
        existing.push(span);
        traceMap.set(span.traceId, existing);
    }
    
    const traces = Array.from(traceMap.entries()).map(([traceId, spans]) => ({
        traceId,
        spans: spans.sort((a, b) => a.startTime - b.startTime),
        startTime: Math.min(...spans.map(s => s.startTime)),
    }));
    
    traces.sort((a, b) => b.startTime - a.startTime);
    
    return limit ? traces.slice(0, limit) : traces;
}

function getCallTree(traceId) {
    const spans = getSpansByTraceId(traceId);
    if (spans.length === 0) return null;
    
    const spanMap = new Map();
    const roots = [];
    
    for (const span of spans) {
        spanMap.set(span.spanId, { ...span, children: [] });
    }
    
    for (const span of spans) {
        const node = spanMap.get(span.spanId);
        if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
            spanMap.get(span.parentSpanId).children.push(node);
        } else {
            roots.push(node);
        }
    }
    
    return roots.length === 1 ? roots[0] : roots;
}

function clearSpans() {
    spanRecords.length = 0;
    callStack.length = 0;
    currentTraceId = null;
}

function getStats() {
    const traceIds = new Set(spanRecords.map(s => s.traceId));
    const durations = spanRecords.map(s => s.duration);
    
    return {
        totalSpans: spanRecords.length,
        totalTraces: traceIds.size,
        averageDuration: durations.length > 0 
            ? durations.reduce((a, b) => a + b, 0) / durations.length 
            : 0,
    };
}

function formatCallTree(traceId, indent) {
    indent = indent || '';
    const tree = getCallTree(traceId);
    if (!tree) return 'No trace found';
    
    function formatNode(node, prefix) {
        const status = node.status === 'error' ? ' [ERROR]' : '';
        const duration = `${node.duration}ms`;
        let line = `${prefix}${node.name} (${duration})${status}`;
        
        if (node.args && node.args.length > 0) {
            line += ` args: [${node.args.join(', ')}]`;
        }
        
        if (node.returnValue) {
            line += ` => ${node.returnValue}`;
        }
        
        const lines = [line];
        
        if (node.children && node.children.length > 0) {
            for (let i = 0; i < node.children.length; i++) {
                const isLast = i === node.children.length - 1;
                const childPrefix = prefix + (isLast ? '  ' : '| ');
                const connector = isLast ? '`-' : '|-';
                lines.push(formatNode(node.children[i], prefix + connector));
            }
        }
        
        return lines.join('\n');
    }
    
    if (Array.isArray(tree)) {
        return tree.map(t => formatNode(t, '')).join('\n\n');
    }
    
    return formatNode(tree, '');
}

if (typeof global !== 'undefined') {
    global.__probe_wrap = __probe_wrap;
    global.__probe_enter = __probe_enter;
    global.__probe_exit = __probe_exit;
    global.__probe_getSpans = getSpans;
    global.__probe_getTraces = getTraces;
    global.__probe_clearSpans = clearSpans;
    global.__probe_formatCallTree = formatCallTree;
}

if (typeof window !== 'undefined') {
    window.__probe_wrap = __probe_wrap;
    window.__probe_enter = __probe_enter;
    window.__probe_exit = __probe_exit;
    window.__probe_getSpans = getSpans;
    window.__probe_getTraces = getTraces;
    window.__probe_clearSpans = clearSpans;
    window.__probe_formatCallTree = formatCallTree;
}

module.exports = {
    __probe_wrap,
    __probe_enter,
    __probe_exit,
    getSpans,
    getSpansByTraceId,
    getTraces,
    getCallTree,
    clearSpans,
    getStats,
    formatCallTree,
};
