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

//const contexts = new Map();
const trace = [];
//const traceHandles = [];
let currentUid = '';

const invertedProviders = [];
for (let key in asyncHook.providers) {
  invertedProviders[asyncHook.providers[key]] = key;
}


function Namespace(name) {
  this.name = name;
  // changed in 2.7: no default context
  this.active = null;
  this._set = [];
  this.id = null;
  this._contexts = new Map();
}

Namespace.prototype.set = function set(key, value) {
  if (!this.active) {
    throw new Error('No context available. ns.run() or ns.bind() must be called first.');
  }

  debug2('    SETTING KEY:' + key + '=' + value + ' in ns:' + this.name + ' uid:' + currentUid + ' active:' + util.inspect(this.active, true));
  this.active[key] = value;
  return value;
};

Namespace.prototype.get = function get(key) {
  if (!this.active) {
    debug2('    GETTING KEY:' + key + '=undefined' + ' ' + this.name + ' uid:' + currentUid + ' active:' + util.inspect(this.active, true));
    return undefined;
  }
  debug2('    GETTING KEY:' + key + '=' + this.active[key] + ' ' + this.name + ' uid:' + currentUid + ' active:' + util.inspect(this.active, true));
  return this.active[key];
};

Namespace.prototype.createContext = function createContext() {
  debug2('   CREATING Context: ' + this.name + ' uid:' + currentUid + ' len:' + this._set.length + ' ' + ' active:' + util.inspect(this.active, true, 2, true));

  let context = Object.create(this.active ? this.active : Object.prototype);
  context._ns_name = this.name;
  context.id = currentUid;

  //process._rawDebug('created Context in ns:' + this.name + ' context:' + util.inspect(context, true, 2, true) + ' context.prototype:' + util.inspect(context.__proto__, true, 2, true));
  debug2('   CREATED Context: ' + this.name + ' uid:' + currentUid + ' len:' + this._set.length + ' ' + ' context:' + util.inspect(context, true, 2, true));
  //process._rawDebug('isPrototype of active' + context.prototype.isPrototypeOf(this.active));

  return context;
};

Namespace.prototype.run = function run(fn) {
  let context = this.createContext();
  this.enter(context);
  try {
    debug2(' BEFORE RUN: ' + this.name + ' uid:' + currentUid + ' len:' + this._set.length + ' ' + util.inspect(context));
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
    debug2(' AFTER RUN: ' + this.name + ' uid:' + currentUid + ' len:' + this._set.length + ' ' + util.inspect(context));
    this.exit(context);
  }
};

Namespace.prototype.bind = function bind(fn, context) {
  if (!context) {
    if (!this.active) {
      context = this.createContext();
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

  debug2('  ENTER ' + this.name + ' uid:' + currentUid + ' len:' + this._set.length + ' context: ' + util.inspect(context));

  this._set.push(this.active);
  this.active = context;
};

Namespace.prototype.exit = function exit(context) {
  assert.ok(context, 'context must be provided for exiting');

  debug2('  EXIT ' + this.name + ' uid:' + currentUid + ' len:' + this._set.length + ' context: ' + util.inspect(context));

  // Fast path for most exits that are at the top of the stack
  if (this.active === context) {
    assert.ok(this._set.length, 'can\'t remove top context');
    this.active = this._set.pop();
    return;
  }

  // Fast search in the stack using lastIndexOf
  let index = this._set.lastIndexOf(context);

  if (index < 0) {
    debug2('??ERROR?? context exiting but not entered - ignoring: ' + util.inspect(context));
    assert.ok(index >= 0, 'context not currently entered; can\'t exit. \n' + util.inspect(this) + '\n' + util.inspect(context));
    /*let len = trace.length;
     for (let i = 0; i < len; i++) {
     console.log(trace[i]);
     }*/
  } else {
    assert.ok(index, 'can\'t remove top context');
    this._set.splice(index, 1);
  }
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
    let unwrappedContexts = unwrapped[CONTEXTS_SYMBOL];
    Object.keys(unwrappedContexts).forEach(function(name) {
      let thunk = unwrappedContexts[name];
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
  assert.ok(name, 'namespace must be given a name.');

  debug2('CREATING NAMESPACE ' + name);
  let namespace = new Namespace(name);
  namespace.id = currentUid;

  asyncHook.addHooks({
    init(uid, handle, provider, parentUid, parentHandle) {
      //currentUid = parentUid || uid;
      currentUid = uid;

      //CHAIN Parent's Context onto child if none exists. This is needed to pass net-events.spec
      //if (parentUid && !namespace.active) {
      if (parentUid) {
        namespace._contexts.set(uid, namespace._contexts.get(parentUid));
      } else {
        namespace._contexts.set(currentUid, namespace.active);
      }

      //trace.push('INIT ns:' + name + ' uid:' + uid + ' parent:' + parentUid + ' provider:' + invertedProviders[provider]);
      debug2('INIT ' + name + ' uid:' + uid + ' parent:' + parentUid + ' provider:' + invertedProviders[provider]
        + ' active:' + util.inspect(namespace.active, true));
      /*trace.push({
       ns: name,
       currentId: currentUid,
       provider: invertedProviders[provider],
       arguments: arguments
       });*/

      if (parentUid) {
        //trace.push('PARENTID: ' + name + ' uid:' + uid + ' parent:' + parentUid + ' provider:' + provider);
        debug2('PARENTID: ' + name + ' uid:' + uid + ' parent:' + parentUid + ' provider:' + provider);
      }

    },
    pre(uid, handle) {
      currentUid = uid;
      let context = namespace._contexts.get(uid);
      if (context) {
        // trace.push('PRE ' + name + ' uid:' + uid + ' entryPoint:' + getFunctionName(handle) + ' context:' + util.inspect(context)
        //   + ' active:' + util.inspect(namespace.active, true));
        debug2(' PRE ' + name + ' uid:' + uid + ' handle:' + getFunctionName(handle) + ' context:' + util.inspect(context));

        namespace.enter(context);
      } else {
        debug2(' PRE MISSING CONTEXT ' + name + ' uid:' + uid + ' handle:' + getFunctionName(handle));
      }
      /*trace.push({
       ns: name,
       currentId: currentUid,
       handle: handle,
       arguments: arguments
       });*/
    },
    post(uid, handle) {
      currentUid = uid;
      let context = namespace._contexts.get(uid);
      if (context) {
        // trace.push('POST ' + name + ' uid:' + uid + ' handle:' + util.inspect(handle) + ' context:' + util.inspect(context)
        //   + ' active:' + util.inspect(namespace.active, true));
        debug2(' POST ' + name + ' uid:' + uid + ' handle:' + getFunctionName(handle) + ' context:' + util.inspect(context));

        namespace.exit(context);
      } else {
        debug2(' POST MISSING CONTEXT ' + name + ' uid:' + uid + ' handle:' + getFunctionName(handle));
      }
      /*trace.push({
       ns: name,
       currentId: currentUid,
       handle: handle,
       arguments: arguments
       });*/
    },
    destroy(uid) {
      currentUid = uid;

      // trace.push('DESTROY ' + name + ' uid:' + uid);
      debug2('DESTROY ' + name + ' uid:' + uid + ' context:' + util.inspect(namespace._contexts.get(currentUid))
        + ' active:' + util.inspect(namespace.active, true));
      /*trace.push({
       ns: name,
       currentId: currentUid
       });*/

      namespace._contexts.delete(uid);

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
 * Used to set currentUid for first new Namespace() creation.
 */
function setupGlobalAsyncHooks() {

  asyncHook.addHooks({
    init(uid, handle, provider, parentUid, parentHandle) {
      //let name = currentNamespace ? currentNamespace.name : '';
      //trace.push('init uid:' + uid + ' parent:' + parentUid + ' provider:' + provider + ' ns:' + name);
      currentUid = parentUid || uid;
      ;
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

function debug2(msg) {
  if (process.env.DEBUG) {
    process._rawDebug(msg);
  }
}


function debug(from, ns) {
  process._rawDebug('DEBUG: ' + util.inspect({
      from: from,
      currentUid: currentUid,
      context: ns ? ns._contexts.get(currentUid) : 'no ns'
    }, true, 2, true));
}


module.exports = {
  getNamespace: getNamespace,
  createNamespace: createNamespace,
  destroyNamespace: destroyNamespace,
  reset: reset,
  trace: trace,
  debug: debug,
  ERROR_SYMBOL: ERROR_SYMBOL
};

function getFunctionName(fn) {
  if (!fn) {
    return fn;
  }
  if (typeof fn === 'function') {
    if (fn.name) {
      return fn.name;
    }
    return (fn.toString().trim().match(/^function\s*([^\s(]+)/) || [])[1];
  } else if (fn.constructor && fn.constructor.name) {
    return fn.constructor.name;
  }
}


// Add back to callstack
var stackChain = require('stack-chain');
for (var modifier in stackChain.filter._modifiers) {
  stackChain.filter.deattach(modifier);
}
/*
 if (stackChain.filter._modifiers && stackChain.filter._modifiers.length) {
 stackChain.filter.deattach(stackChain.filter._modifiers[0]);
 }
 */
