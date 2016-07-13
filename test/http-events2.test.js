'use strict';

var SENTINEL_SOCKET_DATA = 'data\n';
var SENTINEL_CLS_DATA = 0xabad1dea;

var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
chai.should();
chai.use(sinonChai);

describe('`http` connection - 2', function () {
    before(function () {
        require.cache = {};
        this.http = require('http');
        this.cls2 = require('../context');
    });

    after(function () {
        this.cls2.reset();
        delete this.cls2;
        delete this.http;
        require.cache = {};
    });

    describe('client server', function (done) {
        var self = this;
        var http = this.http;
        var namespace = this.cls2.createNamespace('http2');
        namespace.run(() => {
                namespace.set('test', SENTINEL_CLS_DATA);
                var dataSpy = sinon.spy();
                var req = http.get('http://127.0.0.2:8080', function (res) { // TIMEOUT
                    res.on('data', function (chunk) {
                      dataSpy(chunk);
                      it('should get data', () => {

                        expect(chunk).eqaul(SENTINEL_SOCKET_DATA);
                      })
                    });
                    res.on('end', function () {
                        expect(namespace.get('test')).equal(SENTINEL_CLS_DATA);
                    });
                });

                // namespace.bindEmitter(req);
                req.setTimeout(500, function () {
                    expect(namespace.get('test')).equal(SENTINEL_CLS_DATA);
                    req.abort();
                });

                req.on('error', function (e) {
                    expect(namespace.get('test')).equal(SENTINEL_CLS_DATA);
                    //expect(e).property(self.cls2.ERROR_SYMBOL).match(/ECONNRESET|ECONNREFUSED/);
                    done();
                });

                // write data to request body
                req.write(SENTINEL_SOCKET_DATA);
                req.end();
            }
        );
    });
});
