load ../test_helper.bash

get_action_kind () {
	$DOCTL sls fn get test_environ/variable | jq -r .exec.kind
}

setup_file() {
  init_namespace
	export ZIPFILE=$BATS_TEST_DIRNAME/packages/default/action/__deployer__.zip
}

teardown_file() {
	delete_package "test_environ"
}

@test "deploying project using '.env' default" {
	run $DOSLS deploy $BATS_TEST_DIRNAME
	assert_success
	run get_action_kind
	assert_output "nodejs:14"
}

@test "deploying project using alternative file 'test.env'" {
	unset RUNTIME
	run $DOSLS deploy $BATS_TEST_DIRNAME --env $BATS_TEST_DIRNAME/test.env
	assert_success
	run get_action_kind
	assert_output "nodejs-lambda:14"
}

@test "deploying project using an environment variable" {
	export RUNTIME='python:3.9'
	run $DOSLS deploy $BATS_TEST_DIRNAME
	assert_success
	run get_action_kind
	assert_output "python:3.9"
}
