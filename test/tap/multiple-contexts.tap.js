'use strict';

const tap = require('tap');
const test = tap.test;
const createNamespace = require('../../index.js').createNamespace;

test("continuation-local state with timers", function (t) {
  t.plan(1);

  var ns = createNamespace('namespace');
  ns.run(function () {
    ns.set('test', 0xabad1dea);

    t.test("multiple contexts using setInterval", function (t) {
      const xTime = 20;
      const yTime = 15;
      const zTime = 25;
      let xCount = 300 / xTime;
      let yCount = 300 / yTime;
      let zCount = 300 / zTime;
      let xid;
      let yid;
      let zid;

      ns.run(function () {
        t.equal(ns.get('test'), 0xabad1dea, 'should inherit previous context');
        ns.set('test', 10101);
        t.equal(ns.get('test'), 10101, "continuation-local state has been mutated");

        xid = setInterval(function () {
          t.equal(ns.get('test'), 10101, "mutated state has persisted to setInterval's callback");

          if (--xCount <= 0) {
            clearInterval(xid);
            xid = undefined;
            if (!xid && !yid && !zid) {
              t.end();
            }
          }
        }, xTime);
        // start a new context
        ns.run(function y () {
          t.notOk(ns.get('test'), 'new context should be clean');
          ns.set('test', 'xyzzy');
          t.equal(ns.get('test'), 'xyzzy', 'should have new context value');

          yid = setInterval(function () {
            t.equal(ns.get('test'), 'xyzzy', 'should maintain new context state');
            if (--yCount <= 0) {
              clearInterval(yid);
              yid = undefined;
              if (!xid && !yid && !zid) {
                t.end();
              }
            }
          }, yTime);
        }, {newContext: true});
        // start another new context
        ns.run(function z () {
          ns.set('test', 42);
          t.equal(ns.get('test'), 42, 'context should be mutated');

          zid = setInterval(function () {
            t.equal(ns.get('test'), 42, 'should maintain new context state');
            if (--zCount <= 0) {
              clearInterval(zid);
              zid = undefined;
              if (!xid && !yid && !zid) {
                t.end();
              }
            }
          }, zTime);
        }, {newContext: true});
      });
    });
  });
});
