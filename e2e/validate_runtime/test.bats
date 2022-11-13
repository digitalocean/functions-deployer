load ../test_helper.bash

setup_file() {
  init_namespace
}

@test "deploy project with invalid runtime" {
	run $DOSLS deploy $BATS_TEST_DIRNAME
	assert_success
	assert_output --partial "Error: Invalid project configuration file (project.yml): 'xyz' is not a"
	assert_output --partial "valid runtime value"
}
