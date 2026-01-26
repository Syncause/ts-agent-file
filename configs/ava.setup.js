require('./test-probe-runtime');
require('@babel/register')({
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        '@babel/preset-typescript',
    ],
    plugins: [
        ['./babel-plugin-test-probe.js', {
            runtimePath: './test-probe-runtime',
            debug: false,
            includeLocation: true,
        }]
    ],
});
