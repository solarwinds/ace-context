'use strict';

const expect = require('chai').expect;
const net = require('net');
const cls = require('../index.js');

describe('cls with net connection', () => {

  let namespace = cls.createNamespace('net');
  let testValue1;
  let testValue2;
  let testValue3;
  let testValue4;

  before(function(done) {

    let serverDone = false;
    let clientDone = false;

    namespace.run(() => {
      namespace.set('test', 'originalValue');

      let server;
      namespace.run(() => {
        namespace.set('test', 'newContextValue');

        server = net.createServer((socket) => {
          namespace.bindEmitter(socket);

          testValue1 = namespace.get('test');

          socket.on('data', () => {
            testValue2 = namespace.get('test');
            server.close();
            socket.end('GoodBye');

            serverDone = true;
            checkDone();
          });

        });

        server.listen(() => {
          const address = server.address();
          namespace.run(() => {
            namespace.set('test', 'MONKEY');

            const client = net.connect(address.port, () => {
              //namespace.bindEmitter(client);
              testValue3 = namespace.get('test');
              client.write('Hello');

              client.on('data', () => {
                testValue4 = namespace.get('test');
                clientDone = true;
                checkDone();
              });

            });
          });
        });
      });
    });

    function checkDone() {
      if (serverDone && clientDone) {
        done();
      }
    }

  });

  it('value newContextValue', () => {
    expect(testValue1).equal('newContextValue');
  });

  it('value newContextValue 2', () => {
    expect(testValue2).equal('newContextValue');
  });

  it('value MONKEY', () => {
    expect(testValue3).equal('MONKEY');
  });

  it('value MONKEY 2', () => {
    expect(testValue4).equal('MONKEY');
  });

});
