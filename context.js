/* eslint-disable max-len */
'use strict';

const util = require('util');
const assert = require('assert');
const wrapEmitter = require('emitter-listener');
const async_hooks = require('async_hooks');

const CONTEXTS_SYMBOL = 'cls@contexts';
const ERROR_SYMBOL = 'error@context';

const PREFIX = '<cls>';
const DBG_EXCLUDE_BOOT = true;

// make this directly accessible
const stats = {
  maxSetLength: 0,              // maximum number of pushed contexts
  slowExits: 0,                 // count of slow path exits (not top of stack)
  fastExits: 0,                 // count of fast path exits (top of stack)

  totalContextsCreated: 0,
  activeContexts: 0,
  // <debugging root contexts>
  //activeCounts: new Map(),
  //rootContextSwitches: 0,
  //rootContextSwitchEnters: 0,
  //rootContextSwitchExits: 0,
  //transitions: [],              // testing only - a lot of data
  // </debugging root contexts>

  // raw counts for each async_hooks callback
  inits: 0,
  befores: 0,
  afters: 0,
  destroys: 0,
};

const metrics = {
  hooks: {},
  errors: {
    beforeNoInit: [],
    afterNoInit: [],
    destroyNoInit: [],
  },
  stats,
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

function Namespace(name, options = {}) {
  this.name = name;
  // changed in 2.7: no default context
  this.active = null;          // the active context, if any
  this._set = [];              // place to store inactive contexts
  this.id = null;
  this._contexts = new Map();  // maps asyncIDs to context objects
  this._indent = '';

  //
  // options.debug - true or an object with additional settings
  //

  this.debug = !!options.debug;
  if (typeof options.debug !== 'object') {
    options = {debug: {}};
  }
  this.prefix = options.debug.prefix || '<cls>';
  this.dbgShowActive = options.debug.showActive;
  this.dbgShowContext = options.debug.showContext;
  this.dbgShowBoot = options.debug.showBoot;
  this.captureHooks = options.captureHooks;
}

Namespace.prototype.getMetrics = function getMetrics () {
  metrics.stats.rootContextSwitches = metrics.stats.rootContextSwitchEnters + metrics.stats.rootContextSwitchExits;
  // make copies so the caller can fiddle with the returned object.
  const lmetrics = Object.assign({}, metrics);
  lmetrics.hooks = Object.assign({}, metrics.hooks);
  lmetrics.errors = Object.assign({}, metrics.errors);
  lmetrics.stats = Object.assign({}, metrics.stats);
  return lmetrics;
};

Namespace.prototype.set = function set(key, value) {
  if (!this.active) {
    throw new Error('No context available. ns.run() or ns.bind() must be called first.');
  }

  this.active[key] = value;

  if (this.debug) {
    const indentStr = this._indent;
    const at = activeContext(this);
    debug2(`${indentStr}~SET (context: active): ${this.fmtSetGet(key, value)} currentUid:${currentUid}${at}`);
  }

  return value;
};


Namespace.prototype.get = function get (key) {
  if (this.debug) {
    const info = getDebugInfo();
    if (info.show) {
      const {eaID, triggerId} = info;
      const indentStr = this._indent;

      let value = undefined;
      let no = 'no-';
      if (this.active) {
        value = this.active[key];
        no = '';
      }
      const ctxText = getContextText(this, this.active);
      debug2(`${indentStr}~GET (context: ${no}active): ${this.fmtSetGet(key, value)} currentUid:${currentUid} hooksCurID:${eaID} triggerId:${triggerId} ${ctxText}`);
    }
  }

  return this.active ? this.active[key] : undefined;
};

//
// options.newContext - true to force clean context
//
Namespace.prototype.createContext = function createContext (options = {}) {
  // Prototype inherit existing context if creating a new child context within existing context.
  let context;
  if (options.newContext || !this.active) {
    stats.totalContextsCreated += 1;
    context = Object.create({_id: stats.totalContextsCreated});
  } else {
    context = Object.create(this.active);
  }

  context._ns_name = this.name;
  context.id = currentUid;

  if (this.debug) {
    const flag = (options.newContext || !this.active) ? '-NEW' : '';
    const {eaID, triggerId} = getDebugInfo();
    const indentStr = this._indent;
    const ctxText = this.fmtContext(context);
    debug2(`${indentStr}~CREATE${flag}: currentUid:${currentUid} execAsyncId:${eaID} triggerId:${triggerId} context:${ctxText}`);
  }

  return context;
};

Namespace.prototype.run = function run(fn, options) {
  let context = this.createContext(options);
  this.enter(context);

  try {
    if (this.debug) {
      const triggerId = async_hooks.triggerAsyncId();
      const execAsyncID = async_hooks.executionAsyncId();
      const indentStr = this._indent;
      const ctxText = getContextText(this, context);
      debug2(`${indentStr}~RUN: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${execAsyncID} ${ctxText}`);
    }
    fn(context);
    return context;
  } catch (exception) {
    if (exception) {
      exception[ERROR_SYMBOL] = context;
    }
    throw exception;
  } finally {
    if (this.debug) {
      const triggerId = async_hooks.triggerAsyncId();
      const execAsyncID = async_hooks.executionAsyncId();
      const indentStr = this._indent;
      const ctxText = getContextText(this, context);
      debug2(`${indentStr}~RUN-FINALLY: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${execAsyncID} ${ctxText}`);
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
Namespace.prototype.runPromise = function runPromise(fn, options) {
  let context = this.createContext(options);
  this.enter(context);

  let promise = fn(context);
  if (!promise || !promise.then || !promise.catch) {
    throw new Error('fn must return a promise.');
  }

  if (this.debug) {
    debug2(`~RUN-PROMISE-BEFORE: (${this.name}) currentUid: ${currentUid} ${util.inspect(context)}`);
  }

  return promise
    .then(result => {
      if (this.debug) {
        debug2(`~RUN-PROMISE-THEN: (${this.name}) currentUid: ${currentUid} ${util.inspect(context)}`);
      }
      this.exit(context);
      return result;
    })
    .catch(err => {
      err[ERROR_SYMBOL] = context;
      if (this.debug) {
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

  // if entering a new context increment the active contexts and count how many times that number
  // of active contexts has been occurred.
  //let root = ''
  //let info = null;
  //if (context.__proto__.hasOwnProperty('_id')) {
  //  stats.activeContexts += 1;
  //  const activeContexts = stats.activeContexts;
  //  stats.activeCounts[activeContexts] = (stats.activeCounts[stats.activeContexts] || 0) + 1;
  //  if (this.active && this.active._id !== context._id) {
  //    stats.rootContextSwitchEnters += 1;
  //    root = ` (${this.active._id}=>${context._id})`
  //  }
  //}
  //info = this.active ? `${this.active._id}:${this.active.test}-${this.active.d}` : null
  //stats.transitions.push(`e${root} ${info} => ${context._id}:${context.test}`)

  this._set.push(this.active);
  if (this._set.length > stats.maxSetLength) {
    stats.maxSetLength = this._set.length;
  }
  this.active = context;

  if (this.debug) {
    const {eaID, triggerId} = getDebugInfo();

    const indentStr = this._indent;
    const ctxText = getContextText(this, context);
    debug2(`${indentStr}~ENTER: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${eaID} ${ctxText}`);
  }
};

Namespace.prototype.exit = function exit(context) {
  assert.ok(context, 'context must be provided for exiting');

  // if exiting a root context then decrement the active contexts.
  //if (context.__proto__ === Object.prototype) {
  //if (context.__proto__.hasOwnProperty('_id')) {
  //  stats.activeContexts -= 1;
  //}

  // helper
  const debug = how => {
    const {eaID, triggerId} = getDebugInfo();
    const indentStr = this._indent;
    const ctxText = getContextText(this, context);
    debug2(`${indentStr}~EXIT-${how}: currentUid:${currentUid} triggerId:${triggerId} execAsyncID:${eaID} ${ctxText}`);
  };


  // Fast path for most exits that are at the top of the stack
  if (this.active === context) {
    assert.ok(this._set.length, 'can\'t remove top context');
    //const previousContext = this._set[this._set.length - 1];
    //let root = ''
    //let info = null;
    //if (previousContext && previousContext._id !== context._id) {
    //  stats.rootContextSwitchExits += 1;
    //  root = ` (${context._id}=>${previousContext._id})`
    //}
    //info = previousContext ? `${previousContext._id}:${previousContext.test}-${previousContext.d}` : null
    //stats.transitions.push(`x${root} ${context._id}:${context.test} => ${info}`)
    this.active = this._set.pop();
    stats.fastExits += 1;
    if (this.debug) {
      debug('fast');
    }
    return;
  }

  // Fast search in the stack using lastIndexOf
  let index = this._set.lastIndexOf(context);

  if (index < 0) {
    if (this.debug) {
      debug2('??ERROR?? context exiting but not entered - ignoring: ' + util.inspect(context));
    }
    assert.ok(index >= 0, 'context not currently entered; can\'t exit. \n' + util.inspect(this) + '\n' + util.inspect(context));
  } else {
    assert.ok(index, 'can\'t remove top context');
    stats.slowExits += 1;
    this._set.splice(index, 1);
    if (this.debug) {
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

function createNamespace(name, options = {}) {
  assert.ok(name, 'namespace must be given a name.');

  if (options.debug) {
    debug2(`NS-CREATE-NAMESPACE (${name})`);
  }
  let namespace = new Namespace(name, options);
  namespace.id = currentUid;

  const hook = async_hooks.createHook({
    init (asyncId, type, triggerId, resource) {
      stats.inits += 1;
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

      if (namespace.captureHooks) {
        if (asyncId in metrics.hooks) {
          // the asyncId has already been seen.
          metrics.hooks[asyncId].inits += 1;
        } else {
          // it's a new asyncId
          metrics.hooks[asyncId] = {
            type,
            inits: 1, befores: 0, afters: 0, destroys: 0,
            triggerId,
            eaID,
            bootstrap: eaID === 1,
          };
        }
      }

      //
      // if there is an active context associate it with this asyncId.
      //
      if (namespace.active) {
        namespace._contexts.set(asyncId, namespace.active);

        if (namespace.debug) {
          const indentStr = namespace._indent;
          const at = activeContext(namespace);
          debug2(`${indentStr}@INIT (context: active) [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId} ${at} resource:${resource}`);
        }
      } else if (currentUid === 0) {
        // CurrentId will be 0 when triggered from C++. Promise events
        // https://nodejs.org/api/async_hooks.html
        const triggerId = async_hooks.triggerAsyncId();
        const triggerIdContext = namespace._contexts.get(triggerId);
        if (triggerIdContext) {
          namespace._contexts.set(asyncId, triggerIdContext);
          if (namespace.debug) {
            const indentStr = namespace._indent;
            const at = activeContext(namespace);
            debug2(`${indentStr}@INIT (context: triggerAsyncId) [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId} ${at} resource:${resource}`);
          }
        } else if (namespace.debug) {
          const indentStr = namespace._indent;
          const at = activeContext(namespace);
          debug2(`${indentStr}@INIT (context: missing - triggerAsyncId) [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId} ${at} resource:${resource}`);
        }
      } else if (namespace.debug) {
        // seems like there are missing INITs
        const indentStr = namespace._indent;
        const at = activeContext(namespace);
        debug2(`${indentStr}@INIT (context: missing - currentUid ${currentUid}) [${type}] asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId} ${at} resource:${resource}`);
      }


      if (namespace.debug && type === 'PROMISE'){
        debug2('@INIT PROMISE', util.inspect(resource, {showHidden: true}));
        const parentId = resource.parentId;
        const indentStr = namespace._indent;
        const at = activeContext(namespace);
        debug2(`${indentStr}@INIT (noop) [${type}] parentId:${parentId} asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId} ${at} resource:${resource}`);
      }

    },

    before (asyncId) {
      stats.befores += 1;
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
      if (namespace.captureHooks) {
        if (asyncId in metrics.hooks) {
          metrics.hooks[asyncId].befores += 1;
        } else {
          metrics.errors.beforeNoInit.push(asyncId);
        }
      }

      //HACK to work with promises until they are fixed in node > 8.1.1
      context = namespace._contexts.get(asyncId) || namespace._contexts.get(currentUid);

      if (context) {
        if (namespace.debug) {
          const triggerId = async_hooks.triggerAsyncId();
          const indentStr = namespace._indent;
          const ctxText = getContextText(namespace, context);;
          debug2(`${indentStr}@BEFORE (context: from _contexts) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${ctxText}`);
          namespace._indent += '  ';
        }

        namespace.enter(context);

      } else if (namespace.debug) {
        const triggerId = async_hooks.triggerAsyncId();
        const indentStr = namespace._indent;
        const ctxText = getContextText(namespace, context);;
        debug2(`${indentStr}@BEFORE (context: missing) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${ctxText}`);
        namespace._indent = namespace._indent.slice(2);
      }
    },

    after (asyncId) {
      stats.afters += 1;
      currentUid = async_hooks.executionAsyncId();
      let context; // = namespace._contexts.get(currentUid);

      if (namespace.captureHooks) {
        if (asyncId in metrics.hooks) {
          metrics.hooks[asyncId].afters += 1;
        } else {
          metrics.errors.afterNoInit.push(asyncId);
        }
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
        if (namespace.debug) {
          const triggerId = async_hooks.triggerAsyncId();
          namespace._indent = namespace._indent.slice(2);
          const indentStr = namespace._indent;
          const ctxText = getContextText(namespace, context);;
          debug2(`${indentStr}@AFTER (context: from _contexts) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${ctxText}`);
        }

        namespace.exit(context);

      } else if (namespace.debug) {
        const triggerId = async_hooks.triggerAsyncId();
        namespace._indent = namespace._indent.slice(2);
        const indentStr = namespace._indent;
        const ctxText = getContextText(namespace, context);;
        debug2(`${indentStr}@AFTER (context: missing) asyncId:${asyncId} currentUid:${currentUid} triggerId:${triggerId}${ctxText}`);
      }
    },

    destroy (asyncId) {
      stats.destroys += 1;
      currentUid = async_hooks.executionAsyncId();

      if (namespace.captureHooks) {
        if (asyncId in metrics.hooks) {
          metrics.hooks[asyncId].destroys += 1;
        } else {
          metrics.errors.destroyNoInit.push(asyncId);
        }
      }

      if (namespace.debug) {
        const triggerId = async_hooks.triggerAsyncId();
        const indentStr = namespace._indent;
        const existText = namespace._contexts.get(asyncId) ? 'found' : 'missing';
        const ctxText = getContextText(namespace, context);;
        debug2(`${indentStr}@DESTROY ${existText} currentUid:${currentUid} asyncId:${asyncId} triggerId:${triggerId} ${ctxText}`);
      }

      namespace._contexts.delete(asyncId);

    },
    //promiseResolve (asyncId) {
    //  currentUid = async_hooks.executionAsyncId();
    //  if (DEBUG) {
    //    const triggerId = async_hooks.triggerAsyncId();
    //    const indentStr = namespace._indent;
    //    debug2(`${indentStr}DESTROY currentUid:${currentUid} asyncId:${asyncId} triggerId:${triggerId} ${at} context:${util.inspect(namespace._contexts.get(currentUid))}`);
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
// Namespace-specific formatters.
//
Namespace.prototype.fmtContext = function fmtContext (ctx) {
  if (!ctx || !ctx.lastEvent) {
    if (typeof ctx === 'function') {
      return 'function()';
    }
    return util.inspect(ctx, inspectOpts);
  }
  return `${ctx.lastEvent.Layer}:${ctx.lastEvent.Label} ${ctx.lastEvent.event.toString(1)}`;
};

Namespace.prototype.valueFormatters = {
  topSpan: value => value && `${value.name}`,
  lastSpan: value => value && `${value.name}`,
  lastEvent: value => value && `${value.Layer}:${value.Label} ${value.event.toString(1)}`,
};

Namespace.prototype.fmtSetGet = function fmtSetGet (key, value) {
  if (key in this.valueFormatters) {
    return `${key}=${this.valueFormatters[key](value)}`;
  }
  return `${key}=${util.inspect(value)}`;
};

function getContextText (ns, context) {
  if (ns.dbgShowContext !== 'short') {
    return longContext(ns, context);
  }
  return shortContext(ns);
}

Namespace.prototype.shortContext = function () {
  const ckeys = [...this._contexts.keys()].filter(k => {
    const lastEvent = this._contexts.get(k).lastEvent;
    return lastEvent && lastEvent.Layer === 'restify' && lastEvent.Label === 'exit';
  });
  // map contexts to their ids.
  const skeys = this._set.filter(c => c).map(c => c.id);

  return `c[${ckeys.join(',')}], s[${skeys.join(',')}]`;
};

//
// formatters independent of the namespace
//

// find the id to preface the context with.
function activeContext (ns, active) {
  if (!ns || !ns._contexts || !ns._set) {
    return 'bad-namespace';
  }
  if (!ns.dbgShowActive) {
    return '';
  }
  if (!active) {
    active = ns.active;
  }
  // find the id for the context
  let ctxID = '?';
  for (let [key, ctx] of ns._contexts) {
    if (ctx === active) {
      ctxID = key;
      break;
    }
  }
  const t = active === ns.active ? '(active)' : '';
  return `${ctxID}${t}=>${ns.fmtContext(context)}`;
}

// the long form context
function longContext (ns, context) {
  if (!ns || !ns._contexts || !ns._set) {
    return 'bad-namespace';
  }
  let ctxKey = '';
  const ctext = [...ns._contexts.keys()].map(k => {
    const ctx = ns._contexts.get(k);
    if (ctx === context) {
      ctxKey = `${k}=>`;
    }
    return `${k} => ${ns.fmtContext(ctx)}`;
  });
  const stext = ns._set.map(c => ns.fmtContext(c));

  const sep = '\n    ';
  return `\n  context:${ctxKey}${ns.fmtContext(context)},\n  _contexts:${ctext.join(sep)},\n  _set(${stext.length}):${stext.join(sep)}`;
}

// short form context is always namespace-specific.
function shortContext (ns) {
  if (!ns || !ns._contexts || !ns._set) {
    return 'bad-namespace';
  }

  return ns.shortContext();
}

// placeholder in case it's useful to format resources (TickObject, UDPWRAP, etc.)
/* eslint-disable-next-line no-unused-vars */
function fmtResource (type, resource) {
  return '';
}

function debug2(...args) {
  process._rawDebug(PREFIX, `${util.format(...args)}`);
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


