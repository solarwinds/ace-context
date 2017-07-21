'use strict';

const expect = require('chai').expect;
const cls = require('../index.js');

describe("cls simple async local context", function () {

    it("asynchronously propagating state with local-context", function (done) {
        var namespace = cls.createNamespace('namespace');
        expect(process.namespaces.namespace, "namespace has been created");

        namespace.run(function () {
            namespace.set('test', 1337);
            expect(namespace.get('test')).equal(1337, "namespace is working");
            done();
        });
    });
});
