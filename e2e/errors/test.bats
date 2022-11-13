load ../test_helper.bash

setup_file() {
  init_namespace
	$DOSLS deploy $BATS_TEST_DIRNAME/existing-project
}

teardown_file() {
	$DOCTL sls fn delete test-errors
}

@test "deploying project using clashing resource identifiers" {
	run $DOSLS deploy $BATS_TEST_DIRNAME/resource-clash-error
	assert_success
	assert_output --partial "While deploying action 'test-errors/verifier'"
	assert_output --partial "While deploying package 'test-errors'"
}

@test "deploying project using misspelled actions" {
	run $DOSLS deploy $BATS_TEST_DIRNAME/misspelled-config
	assert_success
	assert_output --partial "Error: While deploying action 'emayl/verifier'"
	assert_output --partial "does not exist in the project"
}
