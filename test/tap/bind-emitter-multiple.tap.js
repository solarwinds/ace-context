'use strict';

var test = require('tap').test;
var EventEmitter = require('events').EventEmitter;
var cls = require('../../index.js');
const util = require('util');

test("event emitters bound to CLS context", function(t) {
  t.plan(1);

  t.test("emitter bound to multiple namespaces handles them correctly", function(t) {
    t.plan(6);

    var ee = new EventEmitter();
    var ns1 = cls.createNamespace('1');
    var ns2 = cls.createNamespace('2');

    // emulate an incoming data emitter
    setTimeout(function() {
      ee.emit('data', 'hi');
    }, 100);

    t.doesNotThrow(function() {
      ns1.bindEmitter(ee);
    });
    t.doesNotThrow(function() {
      ns2.bindEmitter(ee);
    });

    ns1.run(function() {
      ns2.run(function() {
        ns1.set('name', 'tom1');
        ns2.set('name', 'paul2');

        // Should do nothing as it wraps emitters only once
        //t.doesNotThrow(function () { ns1.bindEmitter(ee); });
        //t.doesNotThrow(function () { ns2.bindEmitter(ee); });

        ns1.run(function() {
          process.nextTick(function() {
            t.equal(ns1.get('name'), 'tom1', "ns1 value correct");
            //process._rawDebug(util.inspect(ns1), true);

            t.equal(ns2.get('name'), 'paul2', "ns2 value correct");
            //process._rawDebug(util.inspect(ns2), true);

            ns1.set('name', 'bob');
            ns2.set('name', 'alice');

            ee.on('data', function() {
              t.equal(ns1.get('name'), 'bob', "ns1 value bound onto emitter");
              t.equal(ns2.get('name'), 'alice', "ns2 value bound onto emitter");
            });
          });
        });
      });
    });
  });
});
