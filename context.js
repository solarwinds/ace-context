/* eslint-disable max-len */
'use strict';

const util = require('util');
const assert = require('assert');
const wrapEmitter = require('emitter-listener');
const async_hooks = require('async_hooks');
const fs = require('fs');

const CONTEXTS_SYMBOL = 'cls@contexts';
const ERROR_SYMBOL = 'error@context';

const DEBUG = true && process.env.DEBUG_CLS_HOOKED;
const DEBUG_SHOW_ACTIVE = false;
const DEBUG_SHOW_CONTEXT = true;
const PREFIX = '<cls>';
const DBG_HOOKS = true;
const DBG_EXCLUDE_BOOT = true;

const graph = {
  inits: {},
  errors: {
    beforeNoInit: [],
    afterNoInit: [],
    destroyNoInit: [],
  },
  stats: {
    maxSetLength: 0,
  }
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

Namespace.prototype.getGraph = function getGraph () {
  return graph;
};

Namespace.prototype.set = function set(key, value) {
  if (!this.active) {
    throw new Error('No context available. ns.run() or ns.bind() must be called first.');
  }

  this.active[key] = value;

  if (DEBUG === this.name) {
    const indentStr = this._indent;
    const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(this.active, inspectOpts)}` : '';
    debug2(`${indentStr}~SET (context: active): ${fmtSetGet(key, value)} currentUid:${currentUid}${activeText}`);
  }

  return value;
};


Namespace.prototype.get = function get (key) {
  if (DEBUG === this.name) {
    const info = getDebugInfo();
    if (info.show) {
      const {eaID, triggerId} = info;
      const indentStr = this._indent;

      let value = undefined;
      let no = 'no-';
      let active = '';
      if (this.active) {
        value = this.active[key];
        no = '';
        active = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(this.active, inspectOpts)}` : '';
      }
      debug2(`${indentStr}~GET (context: ${no}active): ${fmtSetGet(key, value)} currentUid:${currentUid} hooksCurID:${eaID} triggerId:${triggerId} ${active}`);
    }
  }

  return this.active && this.active[key];
};


Namespace.prototype.createContext = function createContext () {
  // Prototype inherit existing context if creating a new child context within existing context.
  let context = Object.create(this.active ? this.active : Object.prototype);
  context._ns_name = this.name;
  context.id = currentUid;

  if (DEBUG === this.name) {
    const {eaID, triggerId} = getDebugInfo();
    const indentStr = this._indent;
    debug2(`${indentStr}~CREATE: currentUid:${currentUid} execAsyncId:${eaID} triggerId:${triggerId} context:${util.inspect(context, inspectOpts)}`);
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
      const contextText = DEBUG_SHOW_CONTEXT ? longContext(this, context) : shortContext(this);
      debug2(`${indentStr}~RUN: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${execAsyncID} ${contextText}`);
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
      //const contextText = DEBUG_SHOW_CONTEXT ? longContext(this, context) : shortContext(this);
      const contextText = DEBUG_SHOW_CONTEXT ? longContext(this, context) : showContext(this);
      debug2(`${indentStr}~RUN-FINALLY: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${execAsyncID} ${contextText}`);
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
    debug2(`~RUN-PROMISE-BEFORE: (${this.name}) currentUid: ${currentUid} ${util.inspect(context)}`);
  }

  return promise
    .then(result => {
      if (DEBUG === this.name) {
        debug2(`~RUN-PROMISE-THEN: (${this.name}) currentUid: ${currentUid} ${util.inspect(context)}`);
      }
      this.exit(context);
      return result;
    })
    .catch(err => {
      err[ERROR_SYMBOL] = context;
      if (DEBUG === this.name) {
        debug2(`~RUN-PROMISE-CATCH: (${this.name}) currentUid: ${currentUid} ${util.inspect(context)}`);
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

  this._set.push(this.active);
  if (this._set.length > graph.stats.maxSetLength) {
    graph.stats.maxSetLength = this._set.length;
  }
  this.active = context;

  if (DEBUG === this.name) {
    const {eaID, triggerId} = getDebugInfo();

    const indentStr = this._indent;
    const contextText = DEBUG_SHOW_CONTEXT ? longContext(this, context) : shortContext(this);
    debug2(`${indentStr}~ENTER: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${eaID} ${contextText}`);
  }
};

Namespace.prototype.exit = function exit(context) {
  assert.ok(context, 'context must be provided for exiting');

  // helper
  const debug = how => {
    const {eaID, triggerId} = getDebugInfo();
    //const execAsyncID = async_hooks.executionAsyncId();
    //const triggerId = async_hooks.triggerAsyncId();
    const indentStr = this._indent;
    const contextText = DEBUG_SHOW_CONTEXT ? longContext(this, context) : shortContext(this);
    debug2(`${indentStr}~EXIT-${how}: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${eaID} ${contextText}`);
  };


  // Fast path for most exits that are at the top of the stack
  if (this.active === context) {
    assert.ok(this._set.length, 'can\'t remove top context');
    this.active = this._set.pop();
    if (DEBUG === this.name) {
      debug('fast');
    }
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
    if (DEBUG === this.name) {
      debug('slow');
    }
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
      const eaID = currentUid = async_hooks.executionAsyncId();

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
        if (asyncId in graph.inits) {
          // the asyncId has already been seen.
          graph.inits[asyncId].inits += 1;
        } else {
          // it's a new asyncId
          graph.inits[asyncId] = {type, inits: 1, befores: 0, afters: 0, destroys: 0, triggerId, eaID};
          if (eaID === 1) {
            graph.inits[asyncId].bootstrap = true;
          }

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

    before (asyncId) {
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

      if (asyncId in graph.inits) {
        graph.inits[asyncId].befores += 1;
      } else {
        graph.errors.beforeNoInit.push(asyncId);
      }

      //HACK to work with promises until they are fixed in node > 8.1.1
      context = namespace._contexts.get(asyncId) || namespace._contexts.get(currentUid);

      if (context) {
        if (DEBUG === name) {
          const triggerId = async_hooks.triggerAsyncId();
          const indentStr = namespace._indent;
          const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
          const contextText = DEBUG_SHOW_CONTEXT ? longContext(namespace, context) : shortContext(namespace);
          debug2(`${indentStr}@BEFORE (context: from _contexts) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText}${contextText}`);
          namespace._indent += '  ';
        }

        namespace.enter(context);

      } else if (DEBUG === name) {
        const triggerId = async_hooks.triggerAsyncId();
        const indentStr = namespace._indent;
        const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
        const contextText = DEBUG_SHOW_CONTEXT ? longContext(namespace, context) : shortContext(namespace);
        debug2(`${indentStr}@BEFORE (context: missing) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText}${contextText}`);
        namespace._indent = namespace._indent.slice(2);
      }
    },

    after (asyncId) {
      currentUid = async_hooks.executionAsyncId();
      let context; // = namespace._contexts.get(currentUid);


      if (asyncId in graph.inits) {
        graph.inits[asyncId].afters += 1;
      } else {
        graph.errors.afterNoInit.push(asyncId);
      }
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
          const contextText = DEBUG_SHOW_CONTEXT ? longContext(namespace, context) : shortContext(namespace);
          debug2(`${indentStr}@AFTER (context: from _contexts) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText} ${contextText}`);
        }

        namespace.exit(context);

      } else if (DEBUG === name) {
        const triggerId = async_hooks.triggerAsyncId();
        namespace._indent = namespace._indent.slice(2);
        const indentStr = namespace._indent;
        const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
        const contextText = DEBUG_SHOW_CONTEXT ? longContext(namespace, context) : shortContext(namespace);
        debug2(`${indentStr}@AFTER (context: missing) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${activeText} ${contextText}`);
      }
    },

    destroy (asyncId) {
      currentUid = async_hooks.executionAsyncId();

      if (asyncId in graph.inits) {
        graph.inits[asyncId].destroys += 1;
      } else {
        graph.errors.destroyNoInit.push(asyncId);
      }

      if (DEBUG === name) {
        const triggerId = async_hooks.triggerAsyncId();
        const indentStr = namespace._indent;
        const existText = namespace._contexts.get(asyncId) ? 'found' : 'missing';
        const activeText = DEBUG_SHOW_ACTIVE ? ` active:${util.inspect(namespace.active, inspectOpts)}` : '';
        const contextText = DEBUG_SHOW_CONTEXT ? longContext(namespace, context) : shortContext(namespace);
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
  namespace._hook = hook;

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

//
// TODO BAM make these options for namespace
//
function fmtContext (ctx) {
  if (!ctx || !ctx.lastEvent) {
    if (typeof ctx === 'function') {
      return 'function()';
    }
    return util.inspect(ctx, inspectOpts);
  }
  return `${ctx.lastEvent.Layer}:${ctx.lastEvent.Label} ${ctx.lastEvent.event.toString(1)}`;
}

const valueFormatters = {
  topSpan: value => value && `${value.name}`,
  lastSpan: value => value && `${value.name}`,
  lastEvent: value => value && `${value.Layer}:${value.Label} ${value.event.toString(1)}`,
};

function fmtSetGet (key, value) {
  if (key in valueFormatters) {
    return `${key}=${valueFormatters[key](value)}`;
  }
  return `${key}=${util.inspect(value)}`;
}

function longContext (ns, context) {
  if (!ns || !ns._contexts || !ns._set) {
    return 'bad-namespace';
  }
  const ctext = [...ns._contexts.keys()].map(k => {
    const ctx = ns._contexts.get(k);
    return `${k} => ${fmtContext(ctx)}`;
  });
  const stext = ns._set.map(c => fmtContext(c));

  const sep = '\n    ';
  return `\n  context:${fmtContext(context)},\n  _contexts:${ctext.join(sep)},\n  _set(${stext.length}):${stext.join(sep)}`;
}

function shortContext (ns) {
  if (!ns || !ns._contexts || !ns._set) {
    return 'bad-namespace';
  }
  const ckeys = [...ns._contexts.keys()].filter(k => {
    const lastEvent = ns._contexts.get(k).lastEvent;
    return lastEvent && lastEvent.Layer === 'restify' && lastEvent.Label === 'exit';
  });
  // map contexts to their ids.
  const skeys = ns._set.filter(c => c).map(c => c.id);

  return `c[${ckeys.join(',')}], s[${skeys.join(',')}]`;
}

//const fs = require('fs');
function debug2(...args) {
  if (DEBUG) {
    //fs.writeSync(1, `${util.format(...args)}\n`);
    process._rawDebug(PREFIX, `${util.format(...args)}`);
  }
}


function getDebugInfo () {
  const info = {
    eaID: async_hooks.executionAsyncId(),
    triggerId: async_hooks.triggerAsyncId(),
  };
  info.show = !DBG_EXCLUDE_BOOT || (info.eaID !== 1 && info.triggerId !== 1);

  return info;
};


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


