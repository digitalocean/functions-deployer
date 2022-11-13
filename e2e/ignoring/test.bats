load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
	delete_package "test-ignoring"
}

@test "deploy project whilst ignoring local files" {
	run $DOSLS deploy $BATS_TEST_DIRNAME
	assert_success
	refute_output --partial '.gitignore'
	refute_output --partial '.DS_Store'
}
