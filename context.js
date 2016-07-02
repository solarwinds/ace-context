'use strict';

const util = require('util');
const assert = require('assert');
const wrapEmitter = require('emitter-listener');
const asyncHook = require('async-hook');

/*
 *
 * CONSTANTS
 *
 */
const CONTEXTS_SYMBOL = 'cls@contexts';
const ERROR_SYMBOL = 'error@context';

// load polyfill if native support is unavailable
//if (!process.addAsyncListener) require('async-listener');

const contexts = new Map();
const trace = [];
let currentUid = null;
let currentParentUid = null;
//let currentNamespace = null;

const invertedProviders = [];
for (let key in asyncHook.providers){
  invertedProviders[asyncHook.providers[key]] = key;
}


function Namespace(name) {
  this.name = name;
  // changed in 2.7: no default context
  this.active = null;
  this._set = [];
  this.id = null;
  this.parentId = null;
}

Namespace.prototype.set = function set(key, value) {
  if (!this.active) {
    throw new Error('No context available. ns.run() or ns.bind() must be called first.');
  }

  this.active[key] = value;
  return value;
};

Namespace.prototype.get = function get(key) {
  if (!this.active) {
    return undefined;
  }

  return this.active[key];
};

Namespace.prototype.createContext = function createContext() {
  let context = Object.create(this.active);
  context.NS_NAME = this.name;
  return context;
};

Namespace.prototype.run = function run(fn) {
  let context = this.createContext();
  this.enter(context);
  try {
    fn(context);
    return context;
  }
  catch (exception) {
    if (exception) {
      exception[ERROR_SYMBOL] = context;
    }
    throw exception;
  }
  finally {
    this.exit(context);
  }
};

Namespace.prototype.bind = function bind(fn, context) {
  if (!context) {
    if (!this.active) {
      context = Object.create(this.active);
    }
    else {
      context = this.active;
    }
  }

  let self = this;
  return function() {
    self.enter(context);
    try {
      return fn.apply(this, arguments);
    }
    catch (exception) {
      if (exception) {
        exception[ERROR_SYMBOL] = context;
      }
      throw exception;
    }
    finally {
      self.exit(context);
    }
  };
};

Namespace.prototype.enter = function enter(context) {
  assert.ok(context, 'context must be provided for entering');

  this._set.push(this.active);
  this.active = context;
};

Namespace.prototype.exit = function exit(context) {
  assert.ok(context, 'context must be provided for exiting');

  // Fast path for most exits that are at the top of the stack
  if (this.active === context) {
    assert.ok(this._set.length, 'can\'t remove top context');
    this.active = this._set.pop();
    return;
  }

  // Fast search in the stack using lastIndexOf
  let index = this._set.lastIndexOf(context);

  if (index < 0) {
    let len = trace.length;
    for (let i = 0; i < len; i++) {
      console.log(trace[i]);
    }
  }

  assert.ok(index >= 0, 'context not currently entered; can\'t exit. \n' + util.inspect(this) + '\n' + util.inspect(context));
  assert.ok(index, 'can\'t remove top context');

  this._set.splice(index, 1);
};

Namespace.prototype.bindEmitter = function bindEmitter(emitter) {
  assert.ok(emitter.on && emitter.addListener && emitter.emit, 'can only bind real EEs');

  let namespace = this;
  let thisSymbol = 'context@' + this.name;

  // Capture the context active at the time the emitter is bound.
  function attach(listener) {
    if (!listener) {
      return;
    }
    if (!listener[CONTEXTS_SYMBOL]) {
      listener[CONTEXTS_SYMBOL] = Object.create(null);
    }

    listener[CONTEXTS_SYMBOL][thisSymbol] = {
      namespace: namespace,
      context: namespace.active
    };
  }

  // At emit time, bind the listener within the correct context.
  function bind(unwrapped) {
    if (!(unwrapped && unwrapped[CONTEXTS_SYMBOL])) {
      return unwrapped;
    }

    let wrapped = unwrapped;
    let contexts = unwrapped[CONTEXTS_SYMBOL];
    Object.keys(contexts).forEach(function(name) {
      let thunk = contexts[name];
      wrapped = thunk.namespace.bind(wrapped, thunk.context);
    });
    return wrapped;
  }

  wrapEmitter(emitter, attach, bind);
};

/**
 * If an error comes out of a namespace, it will have a context attached to it.
 * This function knows how to find it.
 *
 * @param {Error} exception Possibly annotated error.
 */
Namespace.prototype.fromException = function fromException(exception) {
  return exception[ERROR_SYMBOL];
};

function getNamespace(name) {
  return process.namespaces[name];
}

function createNamespace(name) {
  assert.ok(name, 'namespace must be given a name!');

  let namespace = new Namespace(name);
  namespace.id = currentUid;
  namespace.parentId = currentParentUid;

  asyncHook.addHooks({
    init(uid, handle, provider, parentUid, parentHandle) {
      currentUid = uid;
      currentParentUid = parentUid;
      contexts.set(uid, namespace.active);
      trace.push('init ' + name + ' uid:' + uid + ' parent:' + parentUid + ' provider:' + invertedProviders[provider]);
      //trace.push('init args: ' + util.inspect(arguments));
      if (parentHandle){
        trace.push('PARENTID: ' + name + ' uid:' + uid + ' parent:' + parentUid + ' provider:' + provider);
      }

    },
    pre(uid, entryPoint) {
      currentUid = uid;
      let context = contexts.get(uid);
      if (context) {
        namespace.enter(context);
      }
      trace.push('pre ' + name + ' uid:' + uid + ' entryPoint:' + util.inspect(entryPoint));
    },
    post(uid, didThrow) {
      currentUid = uid;
      let context = contexts.get(uid);
      if (context) {
        namespace.exit(context);
      }
      trace.push('post ' + name + ' uid:' + uid + ' didThrow:' + util.inspect(didThrow));
    },
    destroy(uid) {
      currentUid = uid;
      contexts.delete(uid);
      trace.push('destroy ' + name + ' uid:' + uid);
    }
  });

  process.namespaces[name] = namespace;
  return namespace;
}

function destroyNamespace(name) {
  let namespace = getNamespace(name);

  assert.ok(namespace, 'can\'t delete nonexistent namespace!');
  assert.ok(namespace.id, 'don\'t assign to process.namespaces directly! ' + util.inspect(namespace));

  process.namespaces[name] = null;
}

function reset() {
  // must unregister async listeners
  if (process.namespaces) {
    Object.keys(process.namespaces).forEach(function(name) {
      destroyNamespace(name);
    });
  }
  process.namespaces = Object.create(null);
}

process.namespaces = {};

/**
 * Really only used to set currentUid used during new Namespace() creation.
 */
function setupGlobalAsyncHooks() {

  asyncHook.addHooks({
    init(uid, handle, provider, parentUid, parentHandle) {
      //let name = currentNamespace ? currentNamespace.name : '';
      //trace.push('init uid:' + uid + ' parent:' + parentUid + ' provider:' + provider + ' ns:' + name);
      currentUid = uid;
      currentParentUid = parentUid;
      //currentNamespace = contexts.get(uid);

      /*if (currentNamespace && currentNamespace.active) {
       //trace.push('entering:' + currentNamespace.name + ' set:' + currentNamespace._set.length);
       currentNamespace.enter(currentNamespace.active);
       }*/
    },
    pre(uid, entryPoint) {
      //let name = currentNamespace ? currentNamespace.name : '';
      //trace.push('pre uid:' + uid + ' ns:' + name);
      currentUid = uid;
      currentParentUid = null;

      /*currentNamespace = contexts.get(uid);
       if (currentNamespace && currentNamespace.active) {
       //trace.push('entering:' + currentNamespace.name + ' set:' + currentNamespace._set.length);
       currentNamespace.enter(currentNamespace.active);
       }*/
    },
    post(uid, didThrow) {
      //let name = currentNamespace ? currentNamespace.name : '';
      //trace.push('post uid:' + uid + ' ns:' + name);
      currentUid = uid;
      currentParentUid = null;

      /*currentNamespace = contexts.get(uid);
       if (currentNamespace && currentNamespace.active) {
       //trace.push('exiting:' + currentNamespace.name + ' set:' + currentNamespace._set.length);
       currentNamespace.exit(currentNamespace.active);
       }*/
    },
    destroy(uid) {
      //let name = currentNamespace ? currentNamespace.name : '';
      //trace.push('destroy uid:' + uid + ' ns:' + name);
      currentUid = uid;
      currentParentUid = null;
      //currentNamespace = contexts.get(uid);
      //contexts.delete(uid);
    }
  });

}

if (1 === 1) {
  setupGlobalAsyncHooks();
}

if (asyncHook._state && !asyncHook._state.enabled) {
  asyncHook.enable();
}

module.exports = {
  getNamespace: getNamespace,
  createNamespace: createNamespace,
  destroyNamespace: destroyNamespace,
  reset: reset,
  trace: trace
};


// Add back to callstack
var stackChain = require('stack-chain');
if (stackChain.filter._modifiers && stackChain.filter._modifiers.length) {
  stackChain.filter.deattach(stackChain.filter._modifiers[0]);
}