load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
	delete_package "test-remote-build-python"
}

@test "deploy python projects with remote build" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --remote-build
	assert_success
	assert_line -p "Submitted action 'test-remote-build-python/default' for remote building and deployment in runtime python:default"
}

@test "invoke remotely built python lang actions" {
	test_binary_action test-remote-build-python/default "When Chuck Norris throws exceptions, it's across the room."
}
