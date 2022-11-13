load ../test_helper.bash

setup_file() {
  init_namespace
}

@test "deploying project with nothing to deploy" {
	run $DOSLS deploy $BATS_TEST_DIRNAME
	assert_success
	assert_output --partial "Nothing deployed"
}
