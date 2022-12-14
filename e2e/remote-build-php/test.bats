load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
	delete_package "test-remote-build-php"
}

@test "deploy php projects with remote build" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --remote-build
	assert_success
	assert_line -p "Submitted function 'test-remote-build-php/default' for remote building and deployment in runtime php:default"
}

@test "invoke remotely built php lang actions" {
	test_binary_action test-remote-build-php/default "nine thousand, nine hundred and ninety-nine"
}
