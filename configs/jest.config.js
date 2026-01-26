module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
            babelConfig: {
                plugins: [
                    ['./babel-plugin-test-probe.js', {
                        runtimePath: './test-probe-runtime',
                        debug: false,
                        includeLocation: true,
                    }]
                ]
            }
        }],
        '^.+\\.(js|jsx)$': ['babel-jest', {
            plugins: [
                ['./babel-plugin-test-probe.js', {
                    runtimePath: './test-probe-runtime',
                    debug: false,
                    includeLocation: true,
                }]
            ]
        }]
    },
    setupFilesAfterEnv: ['./test-probe-runtime.js'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
