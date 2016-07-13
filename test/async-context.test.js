'use strict';

var expect = require('chai').expect;

describe("local-context", function () {
    before(function () {
        require.cache = {};
        this.cls2 = require('../context');
    });

    after(function () {
        this.cls2.reset();
        delete this.cls2;
        require.cache = {};
    });


    it("asynchronously propagating state with local-context", function (done) {
        var namespace = this.cls2.createNamespace('namespace');
        expect(process.namespaces.namespace, "namespace has been created");

        namespace.run(function () {
            namespace.set('test', 1337);
            expect(namespace.get('test')).equal(1337, "namespace is working");
            done();
        });
    });
});
