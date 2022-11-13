load ../test_helper.bash

setup_file() {
  init_namespace
	export ZIPFILE=$BATS_TEST_DIRNAME/packages/default/action/__deployer__.zip
}

@test "deploying project with empty zip file should fail" {
	if [ -e $ZIPFILE]; then
    echo "$ZIPFILE should not exist"
		exit 1
	fi
	run $DOSLS deploy $BATS_TEST_DIRNAME
	assert_success
	if [ -e $ZIPFILE]; then
    echo "$ZIPFILE should not exist"
		exit 1
	fi
	assert_output --partial "Action 'action' has no included files"
}
