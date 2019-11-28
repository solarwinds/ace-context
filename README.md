[![NPM](https://nodei.co/npm/cls-hooked.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/cls-hooked/)

[![Build Status](https://travis-ci.org/Jeff-Lewis/cls-hooked.svg?branch=master)](https://travis-ci.org/Jeff-Lewis/cls-hooked)

# ace-context

`ace-context` provides context across asynchronous execution chains. It is analogous to the thread-local-storage in a threaded environment in that it provides storage for each "thread" of execution.

This is derived from [cls-hooked](https://github.com/jeff-lewis/cls-hooked) which is a fork of [CLS](https://github.com/othiym23/node-continuation-local-storage). cls-hooked uses [async_hooks](https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md) OR, for node prior to v8.1.1, [AsyncWrap](https://github.com/nodejs/node-eps/blob/async-wrap-ep/XXX-asyncwrap-api.md) instead of [async-listener](https://github.com/othiym23/async-listener) which CLS uses.

### Warnings

When running Nodejs version < 8.2.1, this module uses [AsyncWrap](https://github.com/nodejs/node-eps/blob/async-wrap-ep/XXX-asyncwrap-api.md) which is an unsupported Nodejs API, so please consider the risk before using it.

When running Nodejs version >= 8.2.1, this module uses the newer [async_hooks](https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md) API which is considered `Experimental` by Nodejs.

### Shout out

Thanks to [@trevnorris](https://github.com/trevnorris) for [AsyncWrap](https://github.com/nodejs/node-eps/blob/async-wrap-ep/XXX-asyncwrap-api.md), [async_hooks](https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md) and all the async work in Node and [@AndreasMadsen](https://github.com/AndreasMadsen) for [async-hook](https://github.com/AndreasMadsen/async-hook)

### A little history of "AsyncWrap/async_hooks" and its incarnations

1. The first implementation was called **[AsyncListener](https://github.com/nodejs/node-v0.x-archive/pull/6011)** in node v0.11 but was [removed from core](https://github.com/nodejs/node-v0.x-archive/pull/8110) prior to Nodejs v0.12
2. The second implementation was called **[AsyncWrap, async-wrap or async_wrap](https://github.com/nodejs/node-eps/blob/async-wrap-ep/XXX-asyncwrap-api.md)** and was included with Nodejs v0.12.
    - `AsyncWrap` is unofficial and undocumented but is currently in Nodejs versions 6 & 7
    - `ace-context` uses `AsyncWrap` when run in Node < 8.2.1
3. The third implementation and [offically Node-eps accepted](https://github.com/nodejs/node-eps/blob/master/006-asynchooks-api.md) is called **AsyncHooks ([async_hooks](https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md)) API** and was included in Nodejs v8. :);


`ace-context` uses the [async_hooks](https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md) API when run with Node >= 8.2.1

### A Quick Introduction to Asynchronously Chained Execution Context

Asynchronously Chained Execution Context (ace-context) works like thread-local storage
in threaded programming but it based on chains of callbacks and promise-resolutions instead
of threads.

The original module that this is derived from was named `continuation-local-storage`
because it is similar to ["continuation passing style"][cps] in functional programming. The
name `ace-context` encapsulates refers the target need that this module addresses - it
provides a way to set and get values that are scoped to the lifetime of the chain of
asynchronous functions being executed.

#### An example

Suppose you're writing a module that fetches a user and adds it to a session
before calling a function passed in by a user to continue execution:

```javascript
// setup.js

var createNamespace = require('ace-context').createNamespace;
var session = createNamespace('my session');

var db = require('./lib/db.js');

function start(options, next) {
  db.fetchUserById(options.id, function (error, user) {
    if (error) return next(error);

    session.set('user', user);

    next();
  });
}
```

Later on in the process of turning that user's data into an HTML page, you call
another function (maybe defined in another module entirely) that wants to fetch
the value you set earlier:

```javascript
// send_response.js

var getNamespace = require('ace-context').getNamespace;
var session = getNamespace('my session');

var render = require('./lib/render.js')

function finish(response) {
  var user = session.get('user');
  render({user: user}).pipe(response);
}
```

When you set values in ace-context, those values are accessible until all
functions called from the original function – synchronously or asynchronously –
have finished executing. This includes callbacks passed to `process.nextTick`,
the [timer functions][] ([setImmediate][], [setTimeout][], and [setInterval][]),
as well as callbacks passed to asynchronous functions such as those exported from
the `fs`, `dns`, `zlib` and `crypto` modules, as well as native Promises.

A simple rule of thumb is anywhere where you set a property on the `request`
or `response` objects in an HTTP handler in order to maintain context, you
can, and probably should, now use ace-context. This API is designed to allow
you to maintain context of your choosing across a sequence of function calls,
with values specific to each sequence of calls.

Contexts are grouped into namespaces, created with `createNamespace()`. Each
namespace can hold multiple contexts each representing an asynchronous chain
of execution (ace). An ace context is created by calling `.run()` on a namespace
object. Calls to `.run()` can be nested and each nested context holds its own
copy of any values set by the parent context. This allows each child call to
get and set its own values without overwriting the parent's.


An annotated example of how this nesting behaves:

```javascript
var createNamespace = require('ace-context').createNamespace;

var example = createNamespace('example');

// this creates an ace context
example.run(function () {
  example.set('value', 0);

  requestHandler();
});

// namespace.run's callback function is passed its context
// when it is run.
function requestHandler () {

  // create a nested context within the current ace.
  example.run(function (outer) {
    // example.get('value') returns 0
    // outer.value is 0
    example.set('value', 1);
    // example.get('value') returns 1
    // outer.value is 1

    // invoke a function asynchronously
    process.nextTick(function () {
      // example.get('value') returns 1
      // outer.value is 1

      // create another nested context within the current ace.
      example.run(function (inner) {
        // example.get('value') returns 1
        // outer.value is 1
        // inner.value is 1
        example.set('value', 2);
        // example.get('value') returns 2
        // outer.value is 1
        // inner.value is 2
      });
    });
  });

  setTimeout(function () {
    // runs with the default context, because it is not in the scope of
    // the nested contexts.
    console.log(example.get('value')); // prints 0
  }, 1000);
}
```

# API

## ace.createNamespace(name)

* return: {Namespace}

Each application using ace-context should create its own namespace. Reading from
or, more worrisome, writing to, namespaces that don't belong to you is a faux pas.

## ace.getNamespace(name)

* return: {Namespace}

Look up an existing namespace. This can be used to verify that the name you plan
to use is not already in use.

## ace.destroyNamespace(name)

Dispose of an existing namespace. WARNING: be sure to dispose of any references
to destroyed namespaces in your old code, as contexts associated with them will
no longer be propagated.

## ace.reset()

Completely reset all ace-context namespaces. WARNING: while this
will stop the propagation of values in any existing namespaces, if there are
remaining references to those namespaces in code, the associated storage will
still be reachable, even though the associated state is no longer being updated.
Make sure you clean up any references to destroyed namespaces yourself.

## process.namespaces

* return: dictionary of {Namespace} objects

ace-context has a performance cost, so it isn't enabled
until the module is loaded for the first time. Once the module is loaded, the
current set of namespaces is available in `process.namespaces`, so library code
that wants to use ace-context only when it's active should test
for the existence of `process.namespaces`.

## Class: Namespace

A namespace is container for an application's ace-contexts. Each ace-context holds
values specific to a single chain of execution. Each ace-context is originated by a
call to one of the ace-context originators: `namespace.run()`, `namespace.runAndReturn()`,
or `namespace.bind()`.

### namespace.active

* return: the currently active context for a namespace

### namespace.set(key, value)

* return: `value`

Set a value on the current ace-context. Must be set within an active
continuation chain started with an ace-context originator. If there is
no context an error will be thrown.

### namespace.get(key)

* return: the requested value, or `undefined`

Look up a value on the current ace-context. Recursively searches from
the innermost to outermost nested ace-context for a value associated
with a given key. Must be set within an active ace started with an
ace-context originator.

### namespace.run(callback [, contextOptions])

* return: the context associated with that callback

Create a new ace-context on which values can be set or read (or descend from an
existing context). Run the callback and all the functions that are called either
directly or indirectly through asynchronous functions and promises within that
ace-context. The context is passed as an argument to the callback.

### namespace.runAndReturn(callback [, contextOptions])

* return: the return value of the callback

Same as `namespace.run()` but returns the return value of the callback rather
than the context.

### namespace.bind(callback, [context])

* return: a callback wrapped up in a context closure

Bind a function to the specified namespace. Works analogously to
`Function.bind()`. If context is omitted, it will use the namespace's currently
active context or create a new context if no context is active.

### namespace.bindEmitter(emitter)

Bind an EventEmitter to a namespace. Operates similarly to `domain.add`, with a
less generic name and the additional caveat that unlike domains, namespaces
never implicitly bind EventEmitters to themselves when they're created within
the context of an active namespace.

You might want to use this when you need to maintain ace-context across your own
or other software's event handlers.

```javascript
http.createServer(function (req, res) {
  writer.bindEmitter(req);
  writer.bindEmitter(res);

  // do other stuff, some of which is asynchronous
});
```

### namespace.createContext([contextOptions])

* return: a context cloned from the currently active context

Use this with `namespace.bind()`, if you want to have a fresh context at invocation time,
as opposed to binding time:

```javascript
function doSomething(p) {
  console.log("%s = %s", p, ns.get(p));
}

function bindLater(callback) {
  return writer.bind(callback, writer.createContext());
}

setInterval(function () {
  var bound = bindLater(doSomething);
  bound('test');
}, 100);
```

### contextOptions

`contextOptions.newContext` is a boolean. If truthy a new, empty ace-context
is created. The context will not descend from any currently active context.
This is useful when ignoring any existing context is required.

## context

A context is a plain object created using the enclosing context as its prototype.

# copyright & license

See [LICENSE](https://github.com/appoptics/ace-context/blob/master/LICENSE)
for the details of the BSD 2-clause "simplified" license used by
`continuation-local-storage` which was developed in 2012-2013 (and is
maintained now) by Forrest L Norvell, [@othiym23](https://github.com/othiym23),
with considerable help from Timothy Caswell,
[@creationix](https://github.com/creationix), working for The Node Firm.

[timer functions]: https://nodejs.org/api/timers.html
[setImmediate]:    https://nodejs.org/api/timers.html#timers_setimmediate_callback_arg
[setTimeout]:      https://nodejs.org/api/timers.html#timers_settimeout_callback_delay_arg
[setInterval]:     https://nodejs.org/api/timers.html#timers_setinterval_callback_delay_arg
[cps]:             http://en.wikipedia.org/wiki/Continuation-passing_style
