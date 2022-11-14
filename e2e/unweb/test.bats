load ../test_helper.bash

setup_file() {
  init_namespace
	$DOSLS deploy $BATS_TEST_DIRNAME
}

teardown_file() {
	delete_package "test-unweb"
}

@test "deploy project with default web values" {
	run $DOCTL sls fn get test-unweb/notify
	assert_success
	assert_output --partial '{
      "key": "web-export",
      "value": true
    },'
	assert_output --partial '{
      "key": "require-whisk-auth",
      "value": false
    },'
	$DOSLS deploy $BATS_TEST_DIRNAME/unweb-with-config
  run $DOCTL sls fn get test-unweb/notify
	assert_success
	assert_output --partial '{
      "key": "web-export",
      "value": false
    },'
	assert_output --partial '{
      "key": "require-whisk-auth",
      "value": "xyzzy"
    },'
}
