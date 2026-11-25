load ../../node_modules/bats-support/load.bash
load ../../node_modules/bats-assert/load.bash

## loads values from .env.test file and validates that required
## envs have been provided
if [ -f ../.env.test ]; then
  export $(echo $(cat ../.env.test | sed 's/#.*//g' | xargs) | envsubst)
fi

# Fork PRs don't get org secrets. Skip instead of killing the suite so the
# e2e job still runs; with secrets present the full suite executes.
MISSING_DO_CREDS=0
if [ -z "$DO_API_KEY" ] || [ -z "$TEST_NAMESPACE" ]; then
  MISSING_DO_CREDS=1
fi

if [ -z "$DOSLS" ]; then
  DOSLS=../bin/run
fi

if [ -z "$DOCTL" ]; then
  DOCTL=../bin/doctl
fi

delete_package() {
  $DOCTL sls undeploy $1 --packages
}

init_namespace() {
  $DOCTL auth init --access-token  $DO_API_KEY
  $DOCTL sls install
  $DOCTL sls connect $TEST_NAMESPACE

  CREDS=$($DOCTL sls status --credentials)
  export API_HOST=$(echo "$CREDS" | jq -r .apihost)
  export AUTH=$(echo "$CREDS" | jq -r .auth)
  export NIMBELLA_DIR=$(echo $CREDS | jq -r .path)
}

# setup_file still runs teardown_file after skips; no-op CLIs/curl when creds missing
# (package-binding teardown calls curl with $AUTH/$API_HOST).
if [ "$MISSING_DO_CREDS" -eq 1 ]; then
  DOSLS=true
  DOCTL=true
  curl() { return 0; }
  init_namespace() { :; }
  setup() {
    skip "DO_API_KEY/TEST_NAMESPACE not available"
  }
fi

test_binary_action() {
	run $DOCTL sls fn invoke $1 -f
	assert_success
	assert_output --partial '"status": "success"'
	assert_output --partial $2

	run $DOCTL sls fn get $1
	assert_success
	assert_output --partial '"binary": true'
}
