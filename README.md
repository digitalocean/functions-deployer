# Nimbella platform deployer library (Node.js)

This repository contains an internal Node.js library for deploying Nimbella applications using the Platform API. It is used by the [Nimbella CLI](https://github.com/nimbella/nimbella-cli) and [other tools](https://github.com/nimbella/nimbella-cli).

### Development

#### Building the library

`npm run build`

#### Testing the library

Use the Nimbella CLI tests located here: https://github.com/nimbella/nimbella-cli/tree/master/tests with this library as a local dependency in that project using [npm link](https://docs.npmjs.com/cli/v7/commands/npm-link).

#### Releasing library versions

This is handed by Github Actions. Once a new release is tagged in the Github UI - that version is pushed to the NPM package.