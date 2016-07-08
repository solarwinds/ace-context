'use strict';

require('mocha');
const chai = require('chai');
const util = require('util');
const should = chai.should();

const net = require('net');
const cls = require('../context.js');

describe('continuation-local state with net connection', () => {

  let namespace = cls.createNamespace('net');
  let testValue1;
  let testValue2;
  let testValue3;
  let testValue4;

  before((done) => {

    let serverDone = false;
    let clientDone = false;

    namespace.run(() => {
      namespace.set('test', 'originalValue');

      var server;
      namespace.run(() => {
        namespace.set('test', 'newContextValue');

        server = net.createServer((socket) => {
          //namespace.bindEmitter(socket);
          //t.equal(namespace.get('test'), 'newContextValue', 'state has been mutated');
          testValue1 = namespace.get('test');

          socket.on('data', () => {
            //t.equal(namespace.get('test'), 'newContextValue', 'state is still preserved');
            testValue2 = namespace.get('test');
            server.close();
            socket.end('GoodBye');

            serverDone = true;
            checkDone();
          });

        });

        server.listen(() => {
          var address = server.address();
          namespace.run(() => {
            namespace.set('test', 'MONKEY');

            var client = net.connect(address.port, () => {
              //namespace.bindEmitter(client);
              //t.equal(namespace.get('test'), 'MONKEY', 'state preserved for client connection');
              testValue3 = namespace.get('test');
              client.write('Hello');
              client.on('data', () => {
                //t.equal(namespace.get('test'), 'MONKEY', 'state preserved for client data');
                //t.end();
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
    should.exist(testValue1);
    testValue1.should.equal('newContextValue');
  });

  it('value newContextValue 2', () => {
    should.exist(testValue2);
    testValue2.should.equal('newContextValue');
  });

  it('value MONKEY', () => {
    should.exist(testValue3);
    testValue3.should.equal('MONKEY');
  });

  it('value MONKEY 2', () => {
    should.exist(testValue4);
    testValue4.should.equal('MONKEY');
  });

});
