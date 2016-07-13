'use strict';

var DATUM1 = "Hello";
var DATUM2 = "GoodBye";
var TEST_VALUE = 0x1337;
var TEST_VALUE2 = "MONKEY";

var expect = require('chai').expect;

describe("`net` connection", function () {
    before(function () {
        require.cache = {};
        this.net = require('net');
        this.cls2 = require('../context');
    });

    after(function () {
        this.cls2.reset();
        delete this.cls2;
        delete this.net;
        require.cache = {};
    });

    it("client server", function (done) {
        var net = this.net;
        var namespace = this.cls2.createNamespace('net');

        namespace.run(
            function namespace_run1(ctx) {
                namespace.set('test', TEST_VALUE);
                expect(namespace.get('test')).equal(ctx.test, "context should be the same");
                var server = net.createServer();

                server.on('connection', function OnServerConnection(socket) {
                        expect(namespace.get('test')).equal(TEST_VALUE, "state has been mutated");

                        socket.on("data", function OnServerSocketData(data) {
                            data = data.toString('utf-8');
                            expect(data).equal(DATUM1, "should get DATUM1");
                            expect(namespace.get('test')).equal(TEST_VALUE, "state is still preserved");

                            socket.end(DATUM2);
                            server.close();
                        });
                    }
                );

                server.listen(function OnServerListen() {
                    namespace.run(
                        function namespace_run2(ctx) {
                            namespace.set("test", TEST_VALUE2);
                            expect(namespace.get('test')).equal(ctx.test, "context should be the same");

                            var port = server.address().port;
                            var client = net.connect(port, function OnClientConnect() {
                                expect(namespace.get("test")).equal(TEST_VALUE2, "state preserved for client connection");
                                client.on("data", function OnClientSocketData(data) {
                                    data = data.toString('utf-8');
                                    expect(data).equal(DATUM2, "should get DATUM1");
                                    expect(namespace.get("test")).equal(TEST_VALUE2, "state preserved for client data");
                                });

                                client.on("close", function OnClientSocketClose() {
                                    done();
                                });

                                client.write(DATUM1);
                            });
                        }
                    );
                });
            }
        );
    });
});
