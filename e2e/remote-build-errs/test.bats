load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
  delete_package "test-remote-build-errs"
}

@test "deploy project with go source error" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --remote-build --include test-remote-build-errs/bad-src
  assert_success
  assert_line -p "Output of failed build"
  assert_line -p "undefined: k"  
}

@test "deploy project with improper generated .include" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --remote-build --include test-remote-build-errs/bad-include
  assert_success
  assert_line -p "Illegal use of '..' in an '.include' file"
}

@test "deploy project with misbehaving build script" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --remote-build --include test-remote-build-errs/bad-script
  assert_success
  assert_line -p "Output of failed build"
  assert_line -p "'../../illegal': No such file or directory"
}