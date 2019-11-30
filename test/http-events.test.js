'use strict';

var DATUM1 = 'Hello';
var DATUM2 = 'GoodBye';
var TEST_VALUE = 0x1337;
var PORT = 55667;

var chai = require('chai');
const expect = chai.expect;

var sinon = require('sinon');
var sinonChai = require('sinon-chai');
chai.use(sinonChai);

describe('cls with http connections', function () {

  this.timeout(1000);

  let http = require('http');
  let cls = require('../index');

  describe('client server', function clientServerTest() {

    var namespace = cls.createNamespace('http');

    var requestSpy = sinon.spy();
    var requestDataSpy = sinon.spy();
    var responseSpy = sinon.spy();
    var responseDataSpy = sinon.spy();
    var finalContextValue;

    before((done) => {

      namespace.run(() => {
        namespace.set('test', TEST_VALUE);
        var server = http.createServer();

        server.on('request', function OnServerConnection(req, res) {
          requestSpy(namespace.get('test'));

          req.on('data', function OnServerSocketData(data) {
            requestDataSpy(data.toString('utf-8'), namespace.get('test'));
            server.close();
            res.end(DATUM2);
          });
        });

        server.listen(PORT, function OnServerListen() {

          namespace.run(() => {

            namespace.set('test', 'MONKEY');

            var request = http.request({host: 'localhost', port: PORT, method: 'POST'}, function OnClientConnect(res) {

              responseSpy(namespace.get('test'));

              res.on('data', function OnClientSocketData(reponseData) {
                responseDataSpy(reponseData.toString('utf-8'), namespace.get('test'));
                done();
              });
            });

            request.write(DATUM1);
          });

        });

        finalContextValue = namespace.get('test');
      });


    });

    it('server request event should be called', () => {
      expect(requestSpy.called).true;
    });

    it('server request event should receive data', () => {
      expect(requestSpy).calledWith(TEST_VALUE);
    });

    it('server request data event should be called', () => {
      expect(requestDataSpy.called).true;
    });

    it('server request data event should receive data', () => {
      expect(requestDataSpy).calledWith(DATUM1, TEST_VALUE);
    });

    it('client data event should be called', () => {
      expect(responseSpy.called).true;
    });

    it('client data event should receive data', () => {
      expect(responseDataSpy).calledWith(DATUM2, 'MONKEY');
    });

    it('final context value should be ' + TEST_VALUE, () => {
      expect(finalContextValue).equal(TEST_VALUE);
    });

  });
});
