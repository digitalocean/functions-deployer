module.exports = {
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        diagnostics: false
      }
    ]
  },

  preset: 'ts-jest',
  testEnvironment: 'node'
};
