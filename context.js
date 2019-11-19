/* eslint-disable max-len */
'use strict';

const util = require('util');
const assert = require('assert');
const wrapEmitter = require('emitter-listener');
const async_hooks = require('async_hooks');

const CONTEXTS_SYMBOL = 'cls@contexts';
const ERROR_SYMBOL = 'error@context';

const DEBUG = false && process.env.DEBUG_CLS_HOOKED;
const DEBUG_SHOW_ACTIVE = false;
const DEBUG_SHOW_CONTEXT = false;
const PREFIX = '<cls>';
const DBG_HOOKS = true;

const graph = {
  inits: {}
};

let currentUid = -1;

const inspectOpts = {showHidden: true, depth: 2};

module.exports = {
  getNamespace: getNamespace,
  createNamespace: createNamespace,
  destroyNamespace: destroyNamespace,
  reset: reset,
  ERROR_SYMBOL: ERROR_SYMBOL
};

function Namespace(name) {
  this.name = name;
  // changed in 2.7: no default context
  this.active = null;
  this._set = [];
  this.id = null;
  this._contexts = new Map();
  this._indent = '';
}

Namespace.prototype.getGraph = function getGraph () {return graph};

Namespace.prototype.set = function set(key, value) {
  if (!this.active) {
    throw new Error('No context available. ns.run() or ns.bind() must be called first.');
  }

  this.active[key] = value;

  if (DEBUG === this.name) {
    const indentStr = this._indent;
    const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(this.active, inspectOpts)}` : '';
    debug2(`${indentStr}~SET (context: active): ${key}=${value} currentUid:${currentUid}${activeText}`);
  }

  return value;
};

Namespace.prototype.get = function get(key) {
  if (!this.active) {
    if (DEBUG === this.name) {
      const hooksCurID = async_hooks.currentId();
      const triggerId = async_hooks.triggerAsyncId();
      const indentStr = this._indent;
      debug2(`${indentStr}~GET (context: no-active) ${key}=undefined currentUid:${currentUid} hooksCurID:${hooksCurID} triggerId:${triggerId} n:${this._set.length}`);
    }
    return undefined;
  }
  if (DEBUG === this.name) {
    const hooksCurID = async_hooks.executionAsyncId();
    const triggerId = async_hooks.triggerAsyncId();
    const indentStr = this._indent;
    const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(this.active, inspectOpts)}` : '';
    debug2(`${indentStr}~GET (context: active): ${key}=${this.active[key]} currentUid:${currentUid} hooksCurID:${hooksCurID} triggerId:${triggerId} n:${this._set.length}${activeText}`);
  }
  return this.active[key];
};

Namespace.prototype.createContext = function createContext() {
  // Prototype inherit existing context if created a new child context within existing context.
  let context = Object.create(this.active ? this.active : Object.prototype);
  context._ns_name = this.name;
  context.id = currentUid;

  if (DEBUG === this.name) {
    const execAsyncID = async_hooks.executionAsyncId();
    const triggerId = async_hooks.triggerAsyncId();
    const indentStr = this._indent;
    debug2(`${indentStr}~CREATE: currentUid:${currentUid} execAsyncId:${execAsyncID} triggerId:${triggerId} n:${this._set.length} context:${util.inspect(context, inspectOpts)}`);
  }

  return context;
};

Namespace.prototype.run = function run(fn) {
  let context = this.createContext();
  this.enter(context);

  try {
    if (DEBUG === this.name) {
      const triggerId = async_hooks.triggerAsyncId();
      const execAsyncID = async_hooks.executionAsyncId();
      const indentStr = this._indent;
      const contextText = DEBUG_SHOW_CONTEXT ? ` context:${util.inspect(context)}` : shortContext(this);
      debug2(`${indentStr}~RUN: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${execAsyncID} n:${this._set.length}${contextText}`);
    }
    fn(context);
    return context;
  } catch (exception) {
    if (exception) {
      exception[ERROR_SYMBOL] = context;
    }
    throw exception;
  } finally {
    if (DEBUG === this.name) {
      const triggerId = async_hooks.triggerAsyncId();
      const execAsyncID = async_hooks.executionAsyncId();
      const indentStr = this._indent;
      const contextText = DEBUG_SHOW_CONTEXT ? ` context:${util.inspect(context)}` : shortContext(this);
      debug2(`${indentStr}~RUN-FINALLY: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${execAsyncID} n:${this._set.length}${contextText}`);
    }
    this.exit(context);
  }
};

Namespace.prototype.runAndReturn = function runAndReturn(fn) {
  let value;
  this.run(function (context) {
    value = fn(context);
  });
  return value;
};

/**
 * Uses global Promise and assumes Promise is cls friendly or wrapped already.
 * @param {function} fn
 * @returns {*}
 */
Namespace.prototype.runPromise = function runPromise(fn) {
  let context = this.createContext();
  this.enter(context);

  let promise = fn(context);
  if (!promise || !promise.then || !promise.catch) {
    throw new Error('fn must return a promise.');
  }

  if (DEBUG === this.name) {
    debug2('~RUN-PROMISE-BEFORE: (' + this.name + ') currentUid:' + currentUid + ' n:' + this._set.length + ' ' + util.inspect(context));
  }

  return promise
    .then(result => {
      if (DEBUG === this.name) {
        debug2('~RUN-PROMISE-THEN: (' + this.name + ') currentUid:' + currentUid + ' n:' + this._set.length + ' ' + util.inspect(context));
      }
      this.exit(context);
      return result;
    })
    .catch(err => {
      err[ERROR_SYMBOL] = context;
      if (DEBUG === this.name) {
        debug2('~RUN-PROMISE-CATCH: (' + this.name + ') currentUid:' + currentUid + ' n:' + this._set.length + ' ' + util.inspect(context));
      }
      this.exit(context);
      throw err;
    });
};

Namespace.prototype.bind = function bindFactory(fn, context) {
  if (!context) {
    if (!this.active) {
      context = this.createContext();
    } else {
      context = this.active;
    }
  }

  let self = this;
  return function clsBind() {
    self.enter(context);
    try {
      return fn.apply(this, arguments);
    } catch (exception) {
      if (exception) {
        exception[ERROR_SYMBOL] = context;
      }
      throw exception;
    } finally {
      self.exit(context);
    }
  };
};

Namespace.prototype.enter = function enter(context) {
  assert.ok(context, 'context must be provided for entering');
  if (DEBUG === this.name) {
    const execAsyncID = async_hooks.executionAsyncId();
    const triggerId = async_hooks.triggerAsyncId();
    const indentStr = this._indent;
    const contextText = DEBUG_SHOW_CONTEXT ? ` context:${util.inspect(context)}` : ` ${shortContext(this)}`;
    debug2(`${indentStr}~ENTER: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${execAsyncID} n:${this._set.length}${contextText}`);
  }

  this._set.push(this.active);
  this.active = context;
};

Namespace.prototype.exit = function exit(context) {
  assert.ok(context, 'context must be provided for exiting');
  if (DEBUG === this.name) {
    const execAsyncID = async_hooks.executionAsyncId();
    const triggerId = async_hooks.triggerAsyncId();
    const indentStr = this._indent;
    const contextText = DEBUG_SHOW_CONTEXT ? ` context:${util.inspect(context)}` : shortContext(this);
    debug2(`${indentStr}~EXIT: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${execAsyncID} n:${this._set.length}${contextText}`);
  }

  // Fast path for most exits that are at the top of the stack
  if (this.active === context) {
    assert.ok(this._set.length, 'can\'t remove top context');
    this.active = this._set.pop();
    return;
  }

  // Fast search in the stack using lastIndexOf
  let index = this._set.lastIndexOf(context);

  if (index < 0) {
    if (DEBUG === this.name) {
      debug2('??ERROR?? context exiting but not entered - ignoring: ' + util.inspect(context));
    }
    assert.ok(index >= 0, 'context not currently entered; can\'t exit. \n' + util.inspect(this) + '\n' + util.inspect(context));
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
    Object.keys(unwrappedContexts).forEach(function (name) {
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

  if (DEBUG) {
    debug2(`NS-CREATE-NAMESPACE (${name})`);
  }
  let namespace = new Namespace(name);
  namespace.id = currentUid;

  const hook = async_hooks.createHook({
    init (asyncId, type, triggerId, resource) {
      currentUid = async_hooks.executionAsyncId();

      //CHAIN Parent's Context onto child if none exists. This is needed to pass net-events.spec
      // let initContext = namespace.active;
      // if(!initContext && triggerId) {
      //   let parentContext = namespace._contexts.get(triggerId);
      //   if (parentContext) {
      //     namespace.active = parentContext;
      //     namespace._contexts.set(currentUid, parentContext);
      //     if (DEBUG) {
      //       const indentStr = namespace._indent;
      //       debug2(`${indentStr}INIT [${type}] WITH PARENT CONTEXT asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId} active:${util.inspect(namespace.active, true)} resource:${resource}`);
      //     }
      //   } else if (DEBUG) {
      //       const indentStr = namespace._indent;
      //       debug2(`${indentStr}INIT [${type}] MISSING CONTEXT asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId} active:${util.inspect(namespace.active, true)} resource:${resource}`);
      //     }
      // }else {
      //   namespace._contexts.set(currentUid, namespace.active);
      //   if (DEBUG) {
      //     const indentStr = namespace._indent;
      //     debug2(`${indentStr}INIT [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId} active:${util.inspect(namespace.active, true)} resource:${resource}`);
      //   }
      // }
      if (DBG_HOOKS) {
        const active = namespace.active;
        if (asyncId in graph.inits) {
          const entry = graph.inits[asyncId].get(active);
          if (entry) {
            entry.count += 1;
          } else {
            graph.inits[asyncId].set(active, {count: 1});
          }
        } else {
          graph.inits[asyncId] = new Map();
          graph.inits[asyncId].set(active, {count: 1});
          process._rawDebug('new init', active);
        }
      }

      //
      // if there is an active context associate it with this asyncId.
      //
      if (namespace.active) {
        namespace._contexts.set(asyncId, namespace.active);

        if (DEBUG === name) {
          const indentStr = namespace._indent;
          const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
          debug2(`${indentStr}@INIT (context: active) [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText} resource:${resource}`);
        }
      } else if (currentUid === 0){
        // CurrentId will be 0 when triggered from C++. Promise events
        // https://nodejs.org/api/async_hooks.html
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        const triggerId = async_hooks.triggerAsyncId();
        const triggerIdContext = namespace._contexts.get(triggerId);
        if (triggerIdContext) {
          namespace._contexts.set(asyncId, triggerIdContext);
          if (DEBUG === name) {
            const indentStr = namespace._indent;
            const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
            debug2(`${indentStr}@INIT (context: triggerAsyncId) [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText} resource:${resource}`);
          }
        } else if (DEBUG === name) {
          const indentStr = namespace._indent;
          const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
          debug2(`${indentStr}@INIT (context: missing - triggerAsyncId) [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText} resource:${resource}`);
        }
      } else if (DEBUG === name) {
        // seems like there are missing INITs
        const indentStr = namespace._indent;
        const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
        debug2(`${indentStr}@INIT (context: missing - currentUid ${currentUid}) [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText} resource:${resource}`);
      }


      if(DEBUG === name && type === 'PROMISE'){
        debug2('@INIT PROMISE', util.inspect(resource, {showHidden: true}));
        const parentId = resource.parentId;
        const indentStr = namespace._indent;
        const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
        debug2(`${indentStr}@INIT (noop) [${type}] parentId:${parentId} asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText} resource:${resource}`);
      }

    },

    before(asyncId) {
      currentUid = async_hooks.executionAsyncId();
      let context;

      /*
      if(currentUid === 0){
        // CurrentId will be 0 when triggered from C++. Promise events
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        //const triggerId = async_hooks.triggerAsyncId();
        context = namespace._contexts.get(asyncId); // || namespace._contexts.get(triggerId);
      }else{
        context = namespace._contexts.get(currentUid);
      }
      */

      //HACK to work with promises until they are fixed in node > 8.1.1
      context = namespace._contexts.get(asyncId) || namespace._contexts.get(currentUid);

      if (context) {
        if (DEBUG === name) {
          const triggerId = async_hooks.triggerAsyncId();
          const indentStr = namespace._indent;
          const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
          const contextText = DEBUG_SHOW_CONTEXT ? ` context:${util.inspect(context)}` : ` ${shortContext(namespace)}`;
          debug2(`${indentStr}@BEFORE (context: from _contexts) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText}${contextText}`);
          namespace._indent += '  ';
        }

        namespace.enter(context);

      } else if (DEBUG === name) {
        const triggerId = async_hooks.triggerAsyncId();
        const indentStr = namespace._indent;
        const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
        const contextText = DEBUG_SHOW_CONTEXT ? ` namespace._contexts:${util.inspect(namespace._contexts, inspectOpts)}` : ` ${shortContext(namespace)}`;
        debug2(`${indentStr}@BEFORE (context: missing) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText}${contextText}`);
        namespace._indent = namespace._indent.slice(2);
      }
    },

    after(asyncId) {
      currentUid = async_hooks.executionAsyncId();
      let context; // = namespace._contexts.get(currentUid);
      /*
      if(currentUid === 0){
        // CurrentId will be 0 when triggered from C++. Promise events
        // https://github.com/nodejs/node/blob/master/doc/api/async_hooks.md#triggerid
        //const triggerId = async_hooks.triggerAsyncId();
        context = namespace._contexts.get(asyncId); // || namespace._contexts.get(triggerId);
      }else{
        context = namespace._contexts.get(currentUid);
      }
      */
      //HACK to work with promises until they are fixed in node > 8.1.1
      context = namespace._contexts.get(asyncId) || namespace._contexts.get(currentUid);

      if (context) {
        if (DEBUG === name) {
          const triggerId = async_hooks.triggerAsyncId();
          namespace._indent = namespace._indent.slice(2);
          const indentStr = namespace._indent;
          const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
          const contextText = DEBUG_SHOW_CONTEXT ? ` context:${util.inspect(context)}` : ` ${shortContext(namespace)}`;
          debug2(`${indentStr}@AFTER (context: from _contexts) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText}${contextText}`);
        }

        namespace.exit(context);

      } else if (DEBUG === name) {
        const triggerId = async_hooks.triggerAsyncId();
        namespace._indent = namespace._indent.slice(2);
        const indentStr = namespace._indent;
        const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
        const contextText = DEBUG_SHOW_CONTEXT ? ` context:${util.inspect(context)}` : ` ${shortContext(namespace)}`;
        debug2(`${indentStr}@AFTER (context: missing) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText}${contextText}`);
      }
    },

    destroy (asyncId) {
      currentUid = async_hooks.executionAsyncId();
      if (DEBUG === name) {
        const triggerId = async_hooks.triggerAsyncId();
        const indentStr = namespace._indent;
        const existText = namespace._contexts.get(asyncId) ? 'found' : 'missing';
        const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
        const contextText = DEBUG_SHOW_CONTEXT ? ` context:${util.inspect(context)}` : shortContext(namespace);
        debug2(`${indentStr}@DESTROY ${existText} currentUid:${currentUid} asyncId:${asyncId} triggerId:${triggerId}${activeText} ${contextText}`);
      }

      namespace._contexts.delete(asyncId);
      if (asyncId === 2071) {
        debug2(`~KEYS: ${util.inspect(namespace._contexts)}`);
      }
    },
    //promiseResolve (asyncId) {
    //  currentUid = async_hooks.executionAsyncId();
    //  if (DEBUG) {
    //    const triggerId = async_hooks.triggerAsyncId();
    //    const indentStr = namespace._indent;
    //    debug2(`${indentStr}DESTROY currentUid:${currentUid} asyncId:${asyncId} triggerId:${triggerId}${activeText} context:${util.inspect(namespace._contexts.get(currentUid))}`);
    //  }
    //}
  });

  hook.enable();

  process.namespaces[name] = namespace;
  return namespace;
}

function destroyNamespace(name) {
  let namespace = getNamespace(name);

  assert.ok(namespace, 'can\'t delete nonexistent namespace! "' + name + '"');
  assert.ok(namespace.id, 'don\'t assign to process.namespaces directly! ' + util.inspect(namespace));

  process.namespaces[name] = null;
}

function reset() {
  // must unregister async listeners
  if (process.namespaces) {
    Object.keys(process.namespaces).forEach(function (name) {
      destroyNamespace(name);
    });
  }
  process.namespaces = Object.create(null);
}

process.namespaces = {};

function shortContext (ns) {
  if (!ns) {
    return 'no-namespace';
  }
  if (!ns._contexts) {
    return 'ns missing _contexts';
  }
  const keys = [...ns._contexts.keys()].filter(k => {
    const lastEvent = ns._contexts.get(k).lastEvent;
    return lastEvent.Layer === 'restify' && lastEvent.Label === 'exit';
  })
  return keys.join(',');
}

//const fs = require('fs');
function debug2(...args) {
  if (DEBUG) {
    //fs.writeSync(1, `${util.format(...args)}\n`);
    process._rawDebug(PREFIX, `${util.format(...args)}`);
  }
}

/*function getFunctionName(fn) {
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
}*/


