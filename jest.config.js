module.exports = {
  "roots": [
    "<rootDir>/src"
  ],
  "testMatch": [
    "**/?(*.)+(spec|test).+(ts|js)"
  ],
  globals: {
    'ts-jest': {
      compiler: "typescript",
      tsconfig: "./tsconfig.json",
      diagnostics: false
    }
  },
  preset: 'ts-jest',
  testEnvironment: 'node',
}; 
