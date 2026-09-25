/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup-env.cjs'],
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx', '**/tests/**/*.test.ts', '**/tests/**/*.test.tsx'],
  testPathIgnorePatterns: ['[/\\\\]e2e[/\\\\]', '[/\\\\]node_modules[/\\\\]', '[/\\\\]\\.next[/\\\\]', '[/\\\\]\\.next-dev[/\\\\]'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^marked$': '<rootDir>/tests/mocks/marked.cjs',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!marked|cheerio|domhandler|dom-serializer|domelementtype|domutils|entities|htmlparser2|parse5|parse5-htmlparser2-tree-adapter|css-select|css-what|boolbase|nth-check)/',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react', esModuleInterop: true, module: 'commonjs', target: 'es2020', moduleResolution: 'node' } }]
  },
};
