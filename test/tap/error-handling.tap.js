'use strict';

const test = require('tap').test;
const cls = require('../../index.js');

// node-tap's changelog removed support for domains in version 13 and
// recommend async-hook-domain. https://node-tap.org/changelog/
const Domain = require('async-hook-domain');

test("continuation-local storage glue with a throw in the continuation chain",
     function (t) {
  var namespace = cls.createNamespace('test');
  namespace.run(function () {
    const d = new Domain(errorHandler); // eslint-disable-line no-unused-vars
    namespace.set('outer', true);

    function errorHandler (err, type) { // eslint-disable-line no-unused-vars
      t.equal(err.message, "explicitly nonlocal exit", "got the expected exception");
      t.ok(namespace.get('outer'), "outer context is still active");
      t.notOk(namespace.get('inner'), "inner context should have been exited by throw");
      t.equal(namespace._set.length, 1, "should be back to outer state");

      cls.destroyNamespace('test');
      t.end();
    };

    // tap is only trying to help
    process.nextTick(function () {
      t.ok(namespace.get('outer'), "outer mutation worked");
      t.notOk(namespace.get('inner'), "inner mutation hasn't happened yet");

      namespace.run(function () {
        namespace.set('inner', true);
        throw new Error("explicitly nonlocal exit");
      });
    });
  });
});

test("synchronous throw attaches the context", function (t) {
  t.plan(3);

  var namespace = cls.createNamespace('cls@synchronous');
  namespace.run(function () {
    namespace.set('value', 'transaction clear');
    try {
      namespace.run(function () {
        namespace.set('value', 'transaction set');
        throw new Error('cls@synchronous explosion');
      });
    }
    catch (e) {
      t.ok(namespace.fromException(e), "context was attached to error");
      t.equal(namespace.fromException(e)['value'], 'transaction set',
              "found the inner value");
    }

    t.equal(namespace.get('value'), 'transaction clear', "everything was reset");
  });

  cls.destroyNamespace('cls@synchronous');
});

test("synchronous throw checks if error exists", function (t) {
  t.plan(2);

  var namespace = cls.createNamespace('cls@synchronous-null-error');
  namespace.run(function () {
    namespace.set('value', 'transaction clear');
    try {
      namespace.run(function () {
        namespace.set('value', 'transaction set');
        throw null;
      });
    }
    catch (e) {
      // as we had a null error, cls couldn't set the new inner value
      t.equal(namespace.get('value'), 'transaction clear', 'from outer value');
    }

    t.equal(namespace.get('value'), 'transaction clear', "everything was reset");
  });

  cls.destroyNamespace('cls@synchronous-null-error');
});

test("throw in process.nextTick attaches the context", function (t) {
  t.plan(3);

  var namespace = cls.createNamespace('cls@nexttick2');

  const d = new Domain(errorHandler); // eslint-disable-line no-unused-vars
  function errorHandler (e) {
    t.ok(namespace.fromException(e), "context was attached to error");
    t.equal(namespace.fromException(e)['value'], 'transaction set',
            "found the inner value");

    cls.destroyNamespace('cls@nexttick2');
  }

  namespace.run(function () {
    namespace.set('value', 'transaction clear');

    // tap is only trying to help
    process.nextTick(function () {
      namespace.run(function () {
        namespace.set('value', 'transaction set');
        throw new Error("cls@nexttick2 explosion");
      });
    });

    t.equal(namespace.get('value'), 'transaction clear', "everything was reset");
  });
});

test("throw in setTimeout attaches the context", function (t) {
  t.plan(3);

  var namespace = cls.createNamespace('cls@nexttick3');
  const d = new Domain(errorHandler); // eslint-disable-line no-unused-vars

  function errorHandler (e) {
    t.ok(namespace.fromException(e), "context was attached to error");
    t.equal(namespace.fromException(e)['value'], 'transaction set',
            "found the inner value");

    cls.destroyNamespace('cls@nexttick3');
  }

  namespace.run(function () {
    namespace.set('value', 'transaction clear');

    // tap is only trying to help
    setTimeout(function () {
      namespace.run(function () {
        namespace.set('value', 'transaction set');
        throw new Error("cls@nexttick3 explosion");
      });
    });

    t.equal(namespace.get('value'), 'transaction clear', "everything was reset");
  });
});
