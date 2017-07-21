'use strict';

const chai = require('chai');
const should = chai.should();

const context = require('../index.js');

chai.config.includeStack = true;

describe('cls namespace management', () => {

  it('name is required', () => {
    should.Throw(() => {
      context.createNamespace();
    });
  });

  let namespaceTest;
  before(() => {
    namespaceTest = context.createNamespace('test');
  });

  it('namespace is returned upon creation', () => {
    should.exist(namespaceTest);
  });

  it('namespace lookup works', () => {
    should.exist(context.getNamespace('test'));
    context.getNamespace('test').should.be.equal(namespaceTest);
  });

  it('allows resetting namespaces', () => {
    should.not.Throw(() => {
      context.reset();
    });
  });

  it('namespaces have been reset', () => {
    Object.keys(process.namespaces).length.should.equal(0);
  });

  it('namespace is available from global', () => {
    context.createNamespace('another');
    should.exist(process.namespaces.another);
  });

  it('destroying works', () => {
    should.not.Throw(() => {
      context.destroyNamespace('another');
    });
  });

  it('namespace has been removed', () => {
    should.not.exist(process.namespaces.another);
  });

});
