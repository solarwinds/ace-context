'use strict';

var clsModule = require('./../context');
const superagent = require('superagent');
const assert = require('assert');

var http = require('http');

var keepAlive = process.env.KEEP_ALIVE !== '0';
var httpAgent = new http.Agent({
  keepAlive: keepAlive,
  maxSockets: 1,
  keepAliveMsecs: 30000
});

var namespace;

function httpGetRequest(cb) {
  var r = superagent['get']('http://www.google.com');

  if (keepAlive) {
    console.log('Keep alive ENABLED, setting http agent');
    r.agent(httpAgent);
  }

  r.end(function (err, res) {
    if (err) {
      cb(err);
    } else {
      console.log('http get status', res.status);
      cb(null, {status: res.status, statusText: res.text, obj: res.body});
    }
  });
}

function clsAction(action, cb) {
  namespace.run(function () {
    var xid = Math.floor(Math.random() * 1000);
    namespace.set('xid', xid);
    console.log('before calling nestedContext: xid value', namespace.get('xid'));
    action(function (e) {
      console.log('returned from action xid value', namespace.get('xid'), 'expected', xid);
      assert.equal(namespace.get('xid'), xid);
      cb(e);
    });
  });
}

function test() {
  namespace = clsModule.createNamespace('test');

  var firstDone = false;
  clsAction(httpGetRequest, function () {
    firstDone = true;
  });

  function secondFetch() {
    if (firstDone) {
      clsAction(httpGetRequest, function () {
        console.log('test done');
      });
    } else {
      setTimeout( secondFetch, 50 );
    }
  }

  secondFetch();
}

test();
