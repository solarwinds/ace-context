'use strict';

var expect = require('chai').expect;

describe("edges and regression testing", function () {
    before(function () {
        require.cache = {};
        this.cls2 = require('../context');
    });

    after(function () {
        this.cls2.reset();
        delete this.cls2;
        require.cache = {};
    });


    it("minimized test case that caused #6011 patch to fail", function (done) {
        var n = this.cls2.createNamespace("test");
        console.log('+');
        // when the flaw was in the patch, commenting out this line would fix things:
        process.nextTick(function () { console.log('!'); });

        expect(!n.get('state'), "state should not yet be visible");

        n.run(function () {
            n.set('state', true);
            expect(n.get('state'), "state should be visible");

            process.nextTick(function () {
                expect(n.get('state'), "state should be visible");
                done();
            });
        });
    });
});
