'use strict';

var DATUM1 = 'Hello';
var DATUM2 = 'GoodBye';
var TEST_VALUE = 0x1337;
var PORT = 55667;

var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
chai.should();
chai.use(sinonChai);

describe('continuation-local state with http connection', function() {

  let http = require('http');
  let cls = require('../context');

  before(function() {
    require.cache = {};
  });

  after(function() {
    cls.reset();
    delete this.cls2;
    delete this.http;
    require.cache = {};
  });

  describe('client server', function(done) {

    var namespace = cls.createNamespace('http');

    var requestSpy = sinon.spy();
    var requestDataSpy = sinon.spy();

    namespace.run(function() {
      namespace.set('test', TEST_VALUE);
      var server = http.createServer();

      server.on('request', function OnServerConnection(req, res) {
        requestSpy(namespace.get('test'));

        req.on('data', function OnServerSocketData(data) {
          expect(data.toString('utf-8')).equal(DATUM1, 'should get DATUM1');
          expect(namespace.get('test')).equal(TEST_VALUE, 'state is still preserved');
          server.close();
          res.end(DATUM2);
        });
      });

      server.listen(PORT, function OnServerListen() {
        namespace.run(function() {
          namespace.set('test', 'MONKEY');
          var request = http.request({ host: 'localhost', port: PORT, method: 'POST' }, function OnClientConnect(res) {
            expect(namespace.get('test')).equal('MONKEY', 'state preserved for client connection');
            res.on('data', function OnClientSocketData(data) {
              expect(data.toString('utf-8')).equal(DATUM2, 'should get DATUM1');
              expect(namespace.get('test')).equal('MONKEY', 'state preserved for client data');
              done();
            });
          });
          request.write(DATUM1);
        });

      });

      expect(namespace.get('test')).equal(TEST_VALUE, 'state has been mutated');
    });

    it('server request event should be called', () =>{
      requestSpy.called.should.equal.true;
    });

    it('server request event should receive data', () =>{
      requestSpy.should.have.been.calledWith(TEST_VALUE); //, 'state has been mutated');
    });


  });
});
