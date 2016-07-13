'use strict';

var cls = require('./../context');
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
  namespace.bindEmitter(superagent.Request.super_.super_.prototype);
  //namespace.bindEmitter(superagent.Request.prototype);
  var r = superagent['get']('http://www.google.com');
  //var r = superagent['get']('http://www.google.com/search?q='+ q);

  if (keepAlive) {
    process._rawDebug('Keep alive ENABLED, setting http agent');
    r.agent(httpAgent);
  }

  r.end(function(err, res) {
    if (err) {
      cb(err);
    } else {
      process._rawDebug('http get status', res.status);
      cb(null, { status: res.status, statusText: res.text, obj: res.body });
    }
  });
}

function doClsAction(id, cb) {
  namespace.run(function() {
    //var xid = Math.floor(Math.random() * 1000);
    var xid = id;
    namespace.set('xid', xid);
    process._rawDebug('before calling httpGetRequest: xid value', namespace.get('xid'));

    httpGetRequest(function(e) {
      process._rawDebug('returned from action xid value', namespace.get('xid'), 'expected', xid);
      assert.equal(namespace.get('xid'), xid);
      cb(e);
    });

  });
}

function test() {
  process._rawDebug('Starting http-agent-break test');
  namespace = cls.createNamespace('test');

  var firstDone = false;

  doClsAction(123, function() {
    firstDone = true;
  });

  function secondFetch() {

    if (firstDone) {

      doClsAction(456, function() {
        console.log('test done');
      });

    } else {
      setTimeout(secondFetch, 50);
    }

  }

  secondFetch();
}

test();
