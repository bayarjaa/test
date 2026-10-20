/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: false }],
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  testEnvironment: 'node',
  testTimeout: 60000,
};
