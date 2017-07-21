'use strict';

const test = require('tap').test;
const util = require('util');

const cls = require('./../../index.js');

test("multiple namespaces handles them correctly", function(t) {
  t.plan(4);

  var ns1 = cls.createNamespace('ONE');
  var ns2 = cls.createNamespace('TWO');

  ns1.run(function() {
    ns2.run(function() {
      ns1.set('name', 'tom1');
      ns2.set('name', 'paul2');

      setTimeout(function() {

        ns1.run(function() {

          process.nextTick(function() {
            t.equal(ns1.get('name'), 'tom1', "ns1 value correct");
            //process._rawDebug(util.inspect(ns1), true);

            t.equal(ns2.get('name'), 'paul2', "ns2 value correct");
            //process._rawDebug(util.inspect(ns2), true);

            ns1.set('name', 'bob');
            ns2.set('name', 'alice');

            setTimeout(function() {
              t.equal(ns1.get('name'), 'bob', "ns1 value bound onto emitter");
              t.equal(ns2.get('name'), 'alice', "ns2 value bound onto emitter");
            });

          });

        });

      });

    });
  });
});

