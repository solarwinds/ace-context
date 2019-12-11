'use strict';

// stdlib
const tap = require('tap');
const test = tap.test;
const EventEmitter = require('events').EventEmitter;

// module under test
const context = require('../../index.js');

// this test was started as a copy of simple.tap.js. testing
// of the debug options was added.

function check () {
  return;
}

let contextCount = 0;
let setGetCount = 0;
let filterCount = 0;

const options1 = {
  debug: {
    showContext: true,
    output: (...args) => {
      check(...args);
    },
  },
  format: {
    context (_ctx) {
      contextCount += 1;
      return '';
    },
    setGetValues: {
      transaction (_value) {
        setGetCount += 1;
        return '';
      }
    },
    shortContextFilter (ctx) {
      filterCount += 1;
      return !!ctx;
    }
  }
};

// multiple contexts in use
const blitzen = context.createNamespace('blitzen', options1);

function Trace(namespace, harvester) {
  this.namespace = namespace;
  this.harvester = harvester;
}

Trace.prototype.runHandler = function (handler) {
  let trace = this.namespace.run(handler);
  this.harvester.emit('finished', trace.transaction);
};


test('debug output, long context, for simple blitzen', function (t) {
  t.plan(9);

  let harvester = new EventEmitter();
  let trace = new Trace(blitzen, harvester);

  harvester.on('finished', function (transaction) {
    t.ok(transaction, "transaction should have been passed in");
    t.equal(transaction.status, 'ok', "transaction should have finished OK");
    t.equal(Object.keys(process.namespaces).length, 1, "Should only have one namespace.");
  });

  trace.runHandler(function inScope() {
    t.ok(blitzen.active, "blitzen should have an active context");
    blitzen.set('transaction', {status : 'ok'});
    t.ok(blitzen.get('transaction'), "can retrieve newly-set value");
    t.equal(blitzen.get('transaction').status, 'ok', "value should be correct");

    // contextCount was determined by observation
    t.equal(contextCount, 16, 'there should be 16 calls to the context formatter');
    t.equal(setGetCount, 3, 'there should be 3 calls to the value formatter');
    t.equal(filterCount, 0, 'the filter function should not be called');
  });
});

// clean up
context.destroyNamespace('blitzen');

contextCount = setGetCount = filterCount = 0;

// and create a new namespace with new options
const options2 = {
  debug: {
    showContext: 'short',
    output: (...args) => {
      check(...args);
    },
  },
  format: {
    context (_ctx) {
      contextCount += 1;
      return '';
    },
    setGetValues: {
      transaction (_value) {
        setGetCount += 1;
        return '';
      }
    },
    shortContextFilter (ctx) {
      filterCount += 1;
      return !!ctx;
    }
  }
};

// use new set of options.
const donner = context.createNamespace('donner', options2);

test('debug output, short context, simple donner', function (t) {
  t.plan(9);

  let harvester = new EventEmitter();
  let trace = new Trace(donner, harvester);

  harvester.on('finished', function (transaction) {
    t.ok(transaction, "transaction should have been passed in");
    t.equal(transaction.status, 'ok', "transaction should have finished OK");
    t.equal(Object.keys(process.namespaces).length, 1, "Should only have one namespace.");
  });

  trace.runHandler(function inScope () {
    t.ok(donner.active, "donner should have an active context");
    donner.set('transaction', {status: 'ok'});
    t.ok(donner.get('transaction'), "can retrieve newly-set value");
    t.equal(donner.get('transaction').status, 'ok', "value should be correct");

    // contextCount was determined by observation
    t.equal(contextCount, 29, 'there should be 16 calls to the context formatter');
    t.equal(setGetCount, 3, 'there should be 3 calls to the value formatter');
    t.equal(filterCount, 3, 'the filter function should not be called');
  });
});
