module.exports = {
  // You can temporarily modify this file during local development to add `spec` (and
  // even `grep`) in order to be able to call `DIALECT=some-dialect yarn mocha` from a
  // terminal and execute only a one (or a few) tests (such as new tests you are
  // creating, for example).
  // Recall that if you want to `grep` over all tests, you need to specify `spec` as
  // `"test/**/*.test.js"`. Not specifying `spec` and calling `yarn mocha` will not
  // execute any test.
  // "spec": ["test/**/bulk-create.test.js", "test/**/upsert.test.js", "test/**/insert.test.js", "test/**/query-generator.test.js"],
  // "grep": ["some test title here"],
  exit: true,
  'check-leaks': true,
  timeout: 30000,
  reporter: 'spec',
};
