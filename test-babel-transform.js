const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');

const sourceCode = fs.readFileSync(path.join(__dirname, 'test-source.js'), 'utf-8');

console.log('=== Original Source Code ===\n');
console.log(sourceCode);

const result = babel.transformSync(sourceCode, {
    filename: 'test-source.js',
    plugins: [
        [path.join(__dirname, 'babel-plugin-test-probe.js'), {
            runtimePath: './test-probe-runtime',
            debug: true,
            includeLocation: true,
            wrapAnonymous: true,
        }]
    ],
});

console.log('\n=== Transformed Code ===\n');
console.log(result.code);

const transformedPath = path.join(__dirname, 'test-source-transformed.js');
fs.writeFileSync(transformedPath, result.code);
console.log('\n=== Transformed code saved to:', transformedPath, '===\n');
