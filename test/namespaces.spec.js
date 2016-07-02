'use strict';

require('mocha');
const chai = require('chai');
const should = chai.should();

const context = require('../context.js');

chai.config.includeStack = true; // turn on stack trace

describe('namespace management', function () {

  it('name is required', function () {
    should.Throw(function(){
      context.createNamespace();
    });
  });

  let namespaceTest;
  before(function(){
    namespaceTest = context.createNamespace('test');
  });

  it('namespace is returned upon creation', function () {
    should.exist(namespaceTest);
  });

  it('namespace lookup works', function () {
    should.exist(context.getNamespace('test'));
    context.getNamespace('test').should.be.equal(namespaceTest);
  });

  it('allows resetting namespaces', function () {
    should.not.Throw(function(){
      context.reset();
    });
  });

  it('namespaces have been reset', function () {
    Object.keys(process.namespaces).length.should.equal(0);
  });

  it('namespace is available from global', function () {
    context.createNamespace('another');
    should.exist(process.namespaces.another);
  });

  it('destroying works', function () {
    should.not.Throw(function () {
      context.destroyNamespace('another');
    });
  });

  it('namespace has been removed', function () {
    should.not.exist(process.namespaces.another);
  });

});
