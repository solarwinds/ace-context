'use strict';

const expect = require('chai').expect;
//const util = require('util');

const cls = require('../index.js');

describe('multiple namespaces handles them correctly', () => {

  let test1Val;
  let test2Val;
  let test3Val;
  let test4Val;

  let ns1 = cls.createNamespace('ONE');
  let ns2 = cls.createNamespace('TWO');


  before((done) => {

    ns1.run(() => {
      ns2.run(() => {

        ns1.set('name', 'tom1');
        ns2.set('name', 'paul2');

        setTimeout(() => {

          ns1.run(() => {

            process.nextTick(() => {

              test1Val = ns1.get('name');
              //process._rawDebug(util.inspect(ns1), true);

              test2Val = ns2.get('name');
              //process._rawDebug(util.inspect(ns2), true);

              ns1.set('name', 'bob');
              ns2.set('name', 'alice');

              setTimeout(function() {
                test3Val = ns1.get('name');
                test4Val = ns2.get('name');
                done();
              });

            });

          });

        });

      });
    });

  });

  it('name tom1', () => {
    expect(test1Val).equal('tom1');
  });

  it('name paul2', () => {
    expect(test2Val).equal('paul2');
  });

  it('name bob', () => {
    expect(test3Val).equal('bob');
  });

  it('name alice', () => {
    expect(test4Val).equal('alice');
  });

});

