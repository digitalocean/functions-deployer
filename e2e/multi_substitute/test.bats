load ../test_helper.bash

setup_file() {
  export A="this is A"
  export B="this is B"
  export C="this is C"
  init_namespace
	$DOSLS deploy $BATS_TEST_DIRNAME
}

teardown_file() {
	delete_package "test-multi-substitute"
  unset A B C
}

@test "deploy project with multi-level parameter substitution" {
	run $DOCTL sls fn invoke test-multi-substitute/hello
	assert_success
	assert_output --partial '"parameters": [
    {
      "key": "A",
      "value": "this is A"
    },
    {
      "key": "B",
      "value": "this is B"
    },
    {
      "key": "C",
      "value": "this is C"
    }
  ]'
}
