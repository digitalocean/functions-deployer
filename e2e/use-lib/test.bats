load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
	delete_package "test-use-lib"
}

@test "Test local deployment with a lib build" {
  rm -f "$BATS_TEST_DIRNAME/lib/hello.js"
  run $DOSLS deploy "$BATS_TEST_DIRNAME"
	assert_success
  assert_output --partial "Deployed functions"
	refute_output --partial "Error"
}

@test "Test that first deployment succeeded" {
  run $DOCTL sls fn invoke test-use-lib/hello1
	assert_output --partial "Hello stranger!"
  run $DOCTL sls fn invoke test-use-lib/hello2
	assert_output --partial "Hello stranger!"
  run $DOCTL sls fn invoke test-use-lib/hello3
	assert_output --partial "Hello stranger!"
}

@test "Test remote deployment with a lib build" {
  rm -f "$BATS_TEST_DIRNAME/lib/hello.js"
  delete_package "test-use-lib"
  run $DOCTL sbx deploy "$BATS_TEST_DIRNAME" --remote-build
	assert_success
  assert_output --partial "Deployed functions"
	refute_output --partial "Error"
}

@test "Test that second deployment succeeded" {
  run $DOCTL sbx fn invoke test-use-lib/hello1
	assert_output --partial "Hello stranger!"
  run $DOCTL sbx fn invoke test-use-lib/hello2
	assert_output --partial "Hello stranger!"
  run $DOCTL sbx fn invoke test-use-lib/hello3
	assert_output --partial "Hello stranger!"
}
