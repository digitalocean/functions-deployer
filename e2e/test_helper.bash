load ../node_modules/bats-support/load.bash
load ../node_modules/bats-assert/load.bash

## loads values from .env.test file and validates that required
## envs have been provided
if [ -f ../.env.test ]; then
  export $(echo $(cat ../.env.test | sed 's/#.*//g' | xargs) | envsubst)
fi

if [ -z "$DO_API_KEY" ]; then
  kill $PPID
  echo "Missing DO_API_KEY"
elif [ -z "$TEST_NAMESPACE" ]; then
  kill $PPID
  echo "Missing TEST_NAMESPACE"
fi

DOSLS=../bin/run
if [ -z "$DOCTL" ]; then
  DOCTL=../bin/doctl
fi

delete_package() {
  $DOCTL sls undeploy $1 --packages
}

init_namespace() {
  $DOCTL auth init $DO_API_KEY
  $DOCTL sls connect $TEST_NAMESPACE
}
