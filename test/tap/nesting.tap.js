'use strict';

var tap = require('tap');
var test = tap.test;

var cls = require('../../index.js');

test('nested contexts on a single namespace', function (t) {
  t.plan(7);

  var namespace = cls.createNamespace('namespace');
  namespace.run(function () {
    namespace.set('value', 1);

    t.equal(namespace.get('value'), 1,
            'namespaces have associated data even without contexts.');

    namespace.run(function () {
      t.equal(namespace.get('value'), 1, 'lookup will check enclosing context');
      namespace.set('value', 2);
      t.equal(namespace.get('value'), 2, 'setting works on top-level context');

      namespace.run(function () {
        t.equal(namespace.get('value'), 2, 'lookup will check enclosing context');
        namespace.set('value', 3);
        t.equal(namespace.get('value'), 3, 'setting works on nested context');
      });

      t.equal(namespace.get('value'), 2,
              'should revert to value set in top-level context');
    });

    t.equal(namespace.get('value'), 1, 'namespace retains its outermost value.');
  });
});

test('the example from the docs', function (t) {
  var ns = cls.createNamespace('writer');
  ns.run(function () {
    ns.set('value', 0);

    t.equal(ns.get('value'), 0, 'outer hasn\'t been entered yet');

    function requestHandler() {
      ns.run(function (outer) {
        t.equal(ns.active, outer, 'writer.active == outer');

        ns.set('value', 1);
        t.equal(ns.get('value'), 1, 'value is 1');
        t.equal(outer.value, 1, 'outer is active');

        process.nextTick(function () {
          t.equal(ns.active, outer, 'writer.active == outer');
          t.equal(ns.get('value'), 1, 'inner has been entered');
          ns.run(function (inner) {
            t.equal(ns.active, inner, 'writer.active == inner');

            ns.set('value', 2);
            t.equal(outer.value, 1, 'outer is unchanged');
            t.equal(inner.value, 2, 'inner is active');
            t.equal(ns.get('value'), 2, 'writer.active == inner');
          });
        });
      });

      setTimeout(function () {
        t.equal(ns.get('value'), 0, 'writer.active == global');
        t.end();
      }, 100);
    }

    requestHandler();
  });
});
