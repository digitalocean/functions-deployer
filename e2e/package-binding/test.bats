load ../test_helper.bash

setup_file() {
  init_namespace
}

teardown_file() {
  # This is non-standard because of a controller bug that prevents a GET on a bound package.
  # DELETE on a bound package works fine but the standard doctl command for deleting a package
  # always does a GET first to detect the presence of functions in the package.  Here we know there
  # will be no functions so we can bypass the issue.
  curl -s -u "$AUTH" -X DELETE "$API_HOST/api/v1/namespaces/_/packages/test-package-binding"   
}

@test "creating a package binding" {
  run $DOSLS deploy $BATS_TEST_DIRNAME
  assert_success
  # validation
  # Notes (1) we need to use curl here because doctl sls doesn't have a package list or get.
  # (2) Getting a bound package explicitly by name appears to be forbidden by the controller, so we
  # fetch the list of packages and parse it.
  PKG=$(curl -s -u "$AUTH" "$API_HOST/api/v1/namespaces/_/packages" | jq -r 'map(select(.name=="test-package-binding"))[0]')
  NAME=$(echo "$PKG" | jq -r .binding.name)
  NAMESPACE=$(echo "$PKG" | jq -r .binding.namespace)
  assert_equal "$NAME" builder
  assert_equal "$NAMESPACE" nimbella
}
