load ../test_helper.bash

setup_file() {
  init_namespace
  run $DOSLS deploy $BATS_TEST_DIRNAME
}

teardown_file() {
	delete_package "test-multi-line"
}

@test "deploy project with a multi-line environment substitution value" {
	run bash -c "$DOCTL sls fn invoke test-multi-line/hello | jq -r .multi"
	assert_success
	assert_output --partial "Multiple lines line 1\nMultiple lines line 2\nMultiple"
}
