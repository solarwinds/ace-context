'use strict';

const chai = require('chai');
const expect = chai.expect;

const context = require('../index.js');
chai.config.includeStack = true;


describe('cls namespace management', () => {

  it('name is required', () => {
    expect(() => context.createNamespace()).throws;
  });

  let namespaceTest;
  before(() => {
    namespaceTest = context.createNamespace('test');
  });

  it('namespace is returned upon creation', () => {
    expect(namespaceTest).exist;
  });

  it('namespace lookup works', () => {
    const ns = context.getNamespace('test');
    expect(ns).equal(namespaceTest);
  });

  it('allows resetting namespaces', () => {
    expect(() => context.reset()).not.throw();
  });

  it('namespaces have been reset', () => {
    const n = Object.keys(process.namespaces).length;
    expect(n).equal(0, `process.namespaces.length is ${n}, not 0`);
  });

  it('namespace is available from global', () => {
    context.createNamespace('another');
    expect(process.namespaces.another).exist;
  });

  it('destroying works', () => {
    expect(() => context.destroyNamespace('another')).not.throw();
  });

  it('namespace has been removed', () => {
    expect(process.namespaces.another).not.exist;
  });

  it('process.namespaces should have the correct count', () => {
    expect(Object.keys(process.namespaces).length).equal(0);
  })

});
