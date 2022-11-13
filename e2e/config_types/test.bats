## TODO Discuss with Josh, dosls will "never" return an error so we should always assert_success
load ../test_helper.bash

setup_file() {
  init_namespace
}

@test "cannot deploy project with invalid annotations" {
	run $DOSLS deploy $BATS_TEST_DIRNAME/test-cases/invalid-annotations
	assert_success
	assert_output --partial "Error: Invalid project configuration file (project.yml): annotations must"
	assert_output --partial "be a dictionary"
}

@test "cannot deploy project with invalid env" {
	run $DOSLS deploy $BATS_TEST_DIRNAME/test-cases/invalid-env
	assert_success
	assert_output --partial "Error: Invalid project configuration file (project.yml): the environment"
	assert_output --partial "clause must be a dictionary"
}

@test "cannot deploy project with invalid parameters" {
	run $DOSLS deploy $BATS_TEST_DIRNAME/test-cases/invalid-parameters
	assert_success
	assert_output --partial "Error: Invalid project configuration file (project.yml): parameters must"
	assert_output --partial "be a dictionary"
}

@test "cannot deploy project with invalid top-level parameter " {
	run $DOSLS deploy $BATS_TEST_DIRNAME/test-cases/invalid-parameters-toplevel
	assert_success
	assert_output --partial "Error: Invalid project configuration file (project.yml): parameters member"
	assert_output --partial "must be a dictionary"
}
