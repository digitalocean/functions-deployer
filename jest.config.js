module.exports = {
  "roots": [
    "<rootDir>/src"
  ],
  "testMatch": [
    "**/?(*.)+(spec|test).+(ts|js)"
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        diagnostics: false
      },
    ],
  },

  preset: 'ts-jest',
  testEnvironment: 'node',
}; 
