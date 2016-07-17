'use strict';

const DATUM1 = 'Hello';
const DATUM2 = 'GoodBye';
const TEST_VALUE = 0x1337;
const TEST_VALUE2 = 'MONKEY';

const expect = require('chai').expect;

const net = require('net');
const cls = require('../context.js');

describe('cls with net connection 2', function() {

  let keyName = 'netTest2';

  it('client server', function(done) {
    var namespace = cls.createNamespace('net2');

    namespace.run(
      function namespace_run1(ctx) {
        namespace.set(keyName, TEST_VALUE);
        expect(namespace.get(keyName)).equal(ctx.netTest2, 'context should be the same');
        var server = net.createServer();

        server.on('connection', function OnServerConnection(socket) {
            expect(namespace.get(keyName)).equal(TEST_VALUE, 'state has been mutated');

            socket.on('data', function OnServerSocketData(data) {
              data = data.toString('utf-8');
              expect(data).equal(DATUM1, 'should get DATUM1');
              expect(namespace.get(keyName)).equal(TEST_VALUE, 'state is still preserved');

              socket.end(DATUM2);
              server.close();
            });
          }
        );

        server.listen(function OnServerListen() {
          namespace.run(
            function namespace_run2(ctx) {
              namespace.set(keyName, TEST_VALUE2);
              expect(namespace.get(keyName)).equal(ctx.netTest2, 'context should be the same');

              var port = server.address().port;
              var client = net.connect(port, function OnClientConnect() {
                expect(namespace.get(keyName)).equal(TEST_VALUE2, 'state preserved for client connection');
                client.on('data', function OnClientSocketData(data) {
                  data = data.toString('utf-8');
                  expect(data).equal(DATUM2, 'should get DATUM1');
                  expect(namespace.get(keyName)).equal(TEST_VALUE2, 'state preserved for client data');
                });

                client.on('close', function OnClientSocketClose() {
                  done();
                });

                client.write(DATUM1);
              });
            }
          );
        });
      }
    );
  });
});
