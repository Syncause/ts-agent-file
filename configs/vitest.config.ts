module.exports = {
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./test-probe-runtime.js'],
    },
    esbuild: {
        target: 'node18',
    },
    plugins: [
        {
            name: 'test-probe',
            enforce: 'pre',
            transform(code: string, id: string) {
                if (id.includes('node_modules')) return;
                if (!/\.(ts|tsx|js|jsx)$/.test(id)) return;
                
                const babel = require('@babel/core');
                const result = babel.transformSync(code, {
                    filename: id,
                    plugins: [
                        ['./babel-plugin-test-probe.js', {
                            runtimePath: './test-probe-runtime',
                            debug: false,
                        }]
                    ],
                    parserOpts: {
                        plugins: ['typescript', 'jsx'],
                    },
                });
                
                return result ? { code: result.code, map: result.map } : undefined;
            },
        },
    ],
};
