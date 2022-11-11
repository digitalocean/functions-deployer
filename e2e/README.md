# Deployer E2E Tests

## Setup
A version of `doctl` is required to run all tests. Use the command `./scripts/getDoctl.sh` to download the latest release of `doctl` to the `<root>/bin` directory. 
Optionally you can use the environment variable `DOCTL` to specify the path to the `doctl` binary. This can be useful to test changes while developing `doclt sls` features. 

Modify the `.env.test` file to include the required env variables. These values are used to authenticate both doctl and the deployer

```
DO_API_KEY=""
TEST_NAMESPACE=""
```

>NOTE: Currently we must use the `nim auth login --auth <uuid:key> --apihost=<host>` to authenticate the deployer. This is currently the only way to save the credentials to `NIMBELLA_DIR` path.

## Run tests
```bash
npm run test:e2e
```