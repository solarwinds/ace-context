'use strict';
var tap = require('tap');
var test = tap.test;
var util = require('util');

test('proper exit on uncaughtException', {skip: true}, function(t) {
  process.on('uncaughtException', function(err) {
    if (err.message === 'oops') {
      //console.log("ok got expected message: %s", err.message);
      t.pass(util.format("ok got expected message: %s", err.message));
    }
    else {
      throw err;
    }
  });

  var cls = require('../../index.js');
  var ns = cls.createNamespace('x');
  ns.run(function() {
    throw new Error('oops');
  });
});
