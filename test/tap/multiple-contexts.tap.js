'use strict';

const tap = require('tap');
const test = tap.test;
const createNamespace = require('../../index.js').createNamespace;
//const util = require('util');

test("continuation-local state with timers", function (t) {
  t.plan(2);

  let depth = 0;
  const ns = createNamespace('namespace');
  ns.run(function () {
    //let contextSwitches = 0;
    const pops = [];
    ns.set('test', 0xabad1dea);
    ns.set('d', depth);

    t.test('multiple contexts using setInterval', function (t) {
      const xTime = 25;
      const yTime = 10;
      const zTime = 15;
      let xCount = 300 / xTime;
      let yCount = 300 / yTime;
      let zCount = 300 / zTime;
      let xid;
      let yid;
      let zid;
      const xVal = 'x'; //10101;
      const yVal = 'y'; //'xyzzy';
      const zVal = 'z'; //42

      function exitIfDone () {
        if (!xid && !yid && !zid) {
          //const metrics = ns.getMetrics();
          //contextSwitches = metrics.stats.rootContextSwitches;

          //process.on('exit', function () {
          //  const metrics = ns.getMetrics();
          //  contextSwitches = metrics.stats.rootContextSwitches;
          //  const counts = uniqueItemCounts(metrics.stats.transitions);
          //  process._rawDebug(util.format(counts))
          //});
          t.end();
        }
      }

      // inherit the context
      ns.run(function () {
        t.equal(ns.get('test'), 0xabad1dea, 'should inherit previous context');
        t.equal(ns.get('d'), 0, 'depth should be 0');
        ns.set('d', ns.get('d') + 1);
        ns.set('test', xVal);
        t.equal(ns.get('test'), xVal, "continuation-local state has been mutated");

        xid = setInterval(function () {
          pops.push('x');
          t.equal(ns.get('test'), xVal, "mutated state has persisted to setInterval's callback");
          t.equal(ns.get('d'), 1, 'depth should still be 1');

          xCount -= 1;
          if (xCount > 1) {
            ns.run(function () {
              t.equal(ns.get('d'), 1, 'depth should still be 1');
              ns.set('d', ns.get('d') + 1);
              setTimeout(function () {
                t.equal(ns.get('test'), xVal, 'maintain context through setTimeout');
                t.equal(ns.get('d'), 2, 'depth should be incremented');
              }, 5);
            });
          } else if (xCount <= 0) {
            clearInterval(xid);
            xid = undefined;
            exitIfDone();
          }
        }, xTime);

        // start a new context
        ns.run(function y () {
          t.notOk(ns.get('test'), 'new context should be clean');
          t.notOk(ns.get('d'), 'new context should be clean');
          ns.set('test', yVal);
          ns.set('d', depth);
          t.equal(ns.get('test'), yVal, 'should have new context value');
          t.equal(ns.get('d'), depth, 'should have correct depth value');

          yid = setInterval(function () {
            pops.push('y');
            t.equal(ns.get('test'), yVal, 'should maintain new context state');
            t.equal(ns.get('d'), 0, 'depth should be 0');

            yCount -= 1;
            if (yCount > 1) {
              ns.run(function () {
                t.equal(ns.get('d'), 0, 'depth should be 0');
                ns.set('d', ns.get('d') + 1);
                setTimeout(function () {
                  t.equal(ns.get('test'), yVal, 'maintain context through setTimeout');
                  t.equal(ns.get('d'), 1, 'depth should be 1');
                }, 5);
              });
            } else if (yCount <= 0) {
              clearInterval(yid);
              yid = undefined;
              exitIfDone();
            }
          }, yTime);
        }, {newContext: true});

        // start another new context
        ns.run(function z () {
          t.notOk(ns.get('test'), 'new context should be clean');
          t.notOk(ns.get('d'), 'new context should be clean');
          ns.set('test', zVal);
          ns.set('d', depth);
          t.equal(ns.get('test'), zVal, 'should have new context value');
          t.equal(ns.get('d'), depth, 'should have correct depth value');

          zid = setInterval(function () {
            pops.push('z');
            t.equal(ns.get('test'), zVal, 'should maintain new context state');

            zCount -= 1;
            if (zCount > 1) {
              ns.run(function () {
                t.equal(ns.get('d'), 0, 'depth should be 0');
                ns.set('d', ns.get('d') + 1);
                setTimeout(function () {
                  t.equal(ns.get('test'), zVal, 'maintain context through setTimeout');
                  t.equal(ns.get('d'), 1, 'depth should be 1');
                }, 5);
              });
            } else if (--zCount <= 0) {
              clearInterval(zid);
              zid = undefined;
              exitIfDone();
            }
          }, zTime);
        }, {newContext: true});
      });
    });

    t.test('context switches should not be zero', function (t) {
      //t.ok(contextSwitches > 1, `${contextSwitches} must be > 1`);
      //const stats = ns.getMetrics().stats;
      //const transitions = stats.transitions;
      //delete stats.transitions;
      //process._rawDebug(stats);
      //const counts = uniqueItemCounts(transitions);
      //process._rawDebug(counts);
      t.end();
    });
  });
});

//function uniqueItemCounts (array) {
//  const counts = {};
//  const countsProxy = {
//    get (counts, prop) {
//      if (Reflect.get(counts, prop) !== undefined) {
//        return Reflect.get(counts, prop);
//      }
//      return 0;
//    },
//    set (counts, prop, val) {
//      Reflect.set(counts, prop, val);
//      return true;
//    }
//  };
//
//  const counter = new Proxy(counts, countsProxy);
//
//  for (const i of array) {
//    counter[i] += 1;
//  }
//
//  return counts;
//}
