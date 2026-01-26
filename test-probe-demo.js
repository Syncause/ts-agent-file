const { __probe_wrap, getSpans, getTraces, clearSpans, formatCallTree } = require('./test-probe-runtime');

function outerFunction(x) {
    console.log('outerFunction called with:', x);
    return middleFunction(x * 2);
}

function middleFunction(y) {
    console.log('middleFunction called with:', y);
    return innerFunction(y + 1);
}

function innerFunction(z) {
    console.log('innerFunction called with:', z);
    return z * z;
}

const wrappedOuter = __probe_wrap(outerFunction, 'outerFunction', 'test-probe-demo.js:3');
const wrappedMiddle = __probe_wrap(middleFunction, 'middleFunction', 'test-probe-demo.js:8');
const wrappedInner = __probe_wrap(innerFunction, 'innerFunction', 'test-probe-demo.js:13');

function outerWrapped(x) {
    console.log('outerFunction called with:', x);
    return wrappedMiddle(x * 2);
}

function middleWrapped(y) {
    console.log('middleFunction called with:', y);
    return wrappedInner(y + 1);
}

const tracedOuter = __probe_wrap(outerWrapped, 'outerFunction', 'test-probe-demo.js:3');

clearSpans();

console.log('\n=== Running traced function chain ===\n');
const result = tracedOuter(5);
console.log('\nResult:', result);

console.log('\n=== Spans Generated ===\n');
const spans = getSpans();
console.log(JSON.stringify(spans, null, 2));

console.log('\n=== Traces ===\n');
const traces = getTraces();
if (traces.length > 0) {
    console.log('Trace ID:', traces[0].traceId);
    console.log('\n=== Call Tree ===\n');
    console.log(formatCallTree(traces[0].traceId));
}

const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '.syncause');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const spanLogPath = path.join(logDir, 'span.log');
const logContent = {
    timestamp: new Date().toISOString(),
    spans: spans,
    traces: traces.map(t => ({
        traceId: t.traceId,
        spanCount: t.spans.length,
        startTime: t.startTime,
        callTree: formatCallTree(t.traceId)
    }))
};

fs.writeFileSync(spanLogPath, JSON.stringify(logContent, null, 2));
console.log('\n=== Span log written to:', spanLogPath, '===\n');
