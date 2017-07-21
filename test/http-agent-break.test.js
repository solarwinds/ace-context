'use strict';

const chai = require('chai');
const should = chai.should();

const superagent = require('superagent');

const cls = require('./../index');
const http = require('http');

const keepAlive = process.env.KEEP_ALIVE !== '0';

describe('cls with http Agent', () => {

  let httpAgent;
  let namespace = cls.createNamespace('httpAgent');

  before(() => {
    httpAgent = new http.Agent({
      keepAlive: keepAlive,
      maxSockets: 1,
      keepAliveMsecs: 30000
    });
  });


  describe('when making two http requests', ()=> {

    let innerRequestContextValue;

    it('should retain context during first', (done)=> {
      doClsAction(123, () => {
        should.exist(innerRequestContextValue)
        innerRequestContextValue.should.equal(123);
        done();
      });
    });


    it('should retain context during second', (done)=> {
      doClsAction(456, () => {
        should.exist(innerRequestContextValue)
        innerRequestContextValue.should.equal(456);
        done();
      });
    });


    function doClsAction(id, cb) {
      namespace.run(function () {
        //var xid = Math.floor(Math.random() * 1000);
        var xid = id;
        namespace.set('xid', xid);
        //process._rawDebug('before calling httpGetRequest: xid value', namespace.get('xid'));

        httpGetRequest(function (e) {
          //process._rawDebug('returned from action xid value', namespace.get('xid'), 'expected', xid);
          innerRequestContextValue = namespace.get('xid');
          //assert.equal(namespace.get('xid'), xid);
          cb(e);
        });

      });
    }


    function httpGetRequest(cb) {

      //https://github.com/othiym23/node-continuation-local-storage/issues/71
      namespace.bindEmitter(superagent.Request.super_.super_.prototype);

      var req = superagent['get']('http://www.google.com');

      if (keepAlive) {
        //process._rawDebug('Keep alive ENABLED, setting http agent');
        req.agent(httpAgent);
      }

      req.end(function (err, res) {
        if (err) {
          cb(err);
        } else {
          //process._rawDebug('http get status', res.status);
          cb(null, {status: res.status, statusText: res.text, obj: res.body});
        }
      });
    }

  });

});
