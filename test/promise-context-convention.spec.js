'use strict';

require('mocha');
const chai = require('chai');
const should = chai.should();

const context = require('../index.js');

/**
 * See https://github.com/othiym23/node-continuation-local-storage/issues/64
 */
describe('Promise context convention', () => {

  let promise;
  let ns = context.createNamespace('PromiseConventionNS');
  let conventionId = 0;

  before((done) => {
    ns.run(() => {
      ns.set('test', 2);
      promise = new Promise((resolve) => {
        ns.run(() => {
          ns.set('test', 1);
          resolve();
        });
      });
    });

    ns.run(() => {
      ns.set('test', 3);
      promise.then(() => {
        //console.log('This Promise implementation follows convention ' + ns.get('test'));
        conventionId = ns.get('test');
        done();
      });
    });

  });

  it('convention should be 3', () => {
    should.equal(conventionId, 3);
  });

});
