load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
  delete_package "test-build-env"
}

@test "deploy projects with build environment (local build)" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --build-env $BATS_TEST_DIRNAME/build.env 
  assert_success
  assert_output --partial "Deployed functions"
  assert_output --partial "- test-build-env/test"
}

@test "invoke function built with build environment (local build)" {
  run $DOCTL sls fn invoke test-build-env/test
  assert_output --partial "Hello sammy!"
}

## This will not do the right thing on apigcp because the remote support is not there
@test "deploy projects with build environment (remote build)" {
  run rm $BATS_TEST_DIRNAME/packages/test-build-env/test/__deployer__.zip
  run rm $BATS_TEST_DIRNAME/packages/test-build-env/test/config.json
  delete_package "test-build-env"

  run $DOSLS deploy $BATS_TEST_DIRNAME --build-env $BATS_TEST_DIRNAME/build.env --remote-build 
  assert_success
  assert_output --partial "Deployed functions"
  assert_output --partial "- test-build-env/test"
}

## This will not do the right thing on apigcp because the remote support is not there
@test "invoke function built with build environment (remote build)" {
  run $DOCTL sls fn invoke test-build-env/test
  assert_output --partial "Hello sammy!"
}
