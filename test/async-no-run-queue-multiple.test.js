'use strict';

const expect = require('chai').expect;
const cls = require('../index.js');

describe("cls edges and regression testing", function () {

    it("minimized test case that caused #6011 patch to fail", function (done) {
        var n = cls.createNamespace("test");
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
