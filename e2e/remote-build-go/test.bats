load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
  delete_package "test-remote-build-go"
}

@test "deploy go projects with remote build" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --remote-build --verbose-build
	assert_success
	assert_line -p "Submitted function 'test-remote-build-go/default' for remote building and deployment in runtime go:default"
	assert_line -p "Submitted function 'test-remote-build-go/explicit' for remote building and deployment in runtime go:1.15"
#	assert_line -p "Submitted function 'test-remote-build-go/dependencies-1.15' for remote building and deployment in runtime go:1.15"
	assert_line -p "Submitted function 'test-remote-build-go/dependencies-1.17' for remote building and deployment in runtime go:1.17"
}

@test "invoke remotely built go lang actions" {
	test_binary_action test-remote-build-go/default "Hello, world! (go1.17."
	test_binary_action test-remote-build-go/explicit "Hello, world! (go1.15."
#	test_binary_action test-remote-build-go/dependencies-1.15 "Hello, stranger! (go1.15."
	test_binary_action test-remote-build-go/dependencies-1.17 "Hello, stranger! (go1.17."
}
