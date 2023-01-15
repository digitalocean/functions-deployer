load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
  delete_package "test-script-types"
}

# Determine the OS, which in turn dictates what deployment cases should succeed and which fail.
# On windows, with a local build: cmd-only should work, sh-only should fail.
# On windows, with a remote build: cmd-only should fail, sh-only should work.
# On non-windows, regardless of local or remote build, cmd-only should fail, sh-only should work.
# On all systems for all build types, providing both should always work
# The test assumes that, when running on windows, we will run under the git bash shell (which 
# is what GitHub actions use when you specify shell: bash).
UOS=$(uname -s)
if [[ "$UOS" == *Linux* ]]; then
  WINDOWS=
elif [ "$UOS" == Darwin ]; then
  WINDOWS=
else
  # Assume otherwise windows
  WINDOWS=yes
fi

@test "local deploy with build.cmd but no build.sh" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --include test-script-types/cmd-only
  if [ -n "$WINDOWS" ]; then
    assert_line -p "Deployed functions"
  else
    assert_line -p "won't run on this platform"
  fi
}

@test "remote deploy with build.cmd but no build.sh" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --include test-script-types/cmd-only --remote-build
  assert_line -p "won't run on this platform"
}

@test "local deploy with build.sh but no build.cmd" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --include test-script-types/sh-only
  if [ -n "$WINDOWS" ]; then
    assert_line -p "won't run on this platform"
  else
    assert_line -p "Deployed functions"
  fi
}

@test "remote deploy with build.sh but no build.cmd" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --include test-script-types/sh-only --remote-build
  assert_line -p "Deployed functions"
}

@test "local deploy with both build.sh and build.cmd" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --include test-script-types/both
  assert_line -p "Deployed functions"
}

@test "remote deploy with both build.sh and build.cmd" {
  run $DOSLS deploy $BATS_TEST_DIRNAME --include test-script-types/both --remote-build
  assert_line -p "Deployed functions"
}