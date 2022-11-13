load ../test_helper.bash

setup_file() {
  init_namespace
	$DOSLS deploy $BATS_TEST_DIRNAME
}

teardown_file() {
	delete_package "test-filtering"
}

@test "should not deploy filtered package resources" {
	ZIPFILE=packages/test-filtering/test/__deployer__.zip
	if [ -e $ZIPFILE]; then
    echo "$ZIPFILE should not exist"
		exit 1
	fi
}
