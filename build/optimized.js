/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

/*global process,document,setTimeout,clearTimeout,MutationObserver,WebKitMutationObserver*/
(function(define) { 'use strict';
define('when/lib/env',['require'],function(require) {
	/*jshint maxcomplexity:6*/

	// Sniff "best" async scheduling option
	// Prefer process.nextTick or MutationObserver, then check for
	// setTimeout, and finally vertx, since its the only env that doesn't
	// have setTimeout

	var MutationObs;
	var capturedSetTimeout = typeof setTimeout !== 'undefined' && setTimeout;

	// Default env
	var setTimer = function(f, ms) { return setTimeout(f, ms); };
	var clearTimer = function(t) { return clearTimeout(t); };
	var asap = function (f) { return capturedSetTimeout(f, 0); };

	// Detect specific env
	if (isNode()) { // Node
		asap = function (f) { return process.nextTick(f); };

	} else if (MutationObs = hasMutationObserver()) { // Modern browser
		asap = initMutationObserver(MutationObs);

	} else if (!capturedSetTimeout) { // vert.x
		var vertxRequire = require;
		var vertx = vertxRequire('vertx');
		setTimer = function (f, ms) { return vertx.setTimer(ms, f); };
		clearTimer = vertx.cancelTimer;
		asap = vertx.runOnLoop || vertx.runOnContext;
	}

	return {
		setTimer: setTimer,
		clearTimer: clearTimer,
		asap: asap
	};

	function isNode () {
		return typeof process !== 'undefined' &&
			Object.prototype.toString.call(process) === '[object process]';
	}

	function hasMutationObserver () {
		return (typeof MutationObserver === 'function' && MutationObserver) ||
			(typeof WebKitMutationObserver === 'function' && WebKitMutationObserver);
	}

	function initMutationObserver(MutationObserver) {
		var scheduled;
		var node = document.createTextNode('');
		var o = new MutationObserver(run);
		o.observe(node, { characterData: true });

		function run() {
			var f = scheduled;
			scheduled = void 0;
			f();
		}

		var i = 0;
		return function (f) {
			scheduled = f;
			node.data = (i ^= 1);
		};
	}
});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/TimeoutError',[],function() {

	/**
	 * Custom error type for promises rejected by promise.timeout
	 * @param {string} message
	 * @constructor
	 */
	function TimeoutError (message) {
		Error.call(this);
		this.message = message;
		this.name = TimeoutError.name;
		if (typeof Error.captureStackTrace === 'function') {
			Error.captureStackTrace(this, TimeoutError);
		}
	}

	TimeoutError.prototype = Object.create(Error.prototype);
	TimeoutError.prototype.constructor = TimeoutError;

	return TimeoutError;
});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));
/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/decorators/timed',['require','../env','../TimeoutError'],function(require) {

	var env = require('../env');
	var TimeoutError = require('../TimeoutError');

	function setTimeout(f, ms, x, y) {
		return env.setTimer(function() {
			f(x, y, ms);
		}, ms);
	}

	return function timed(Promise) {
		/**
		 * Return a new promise whose fulfillment value is revealed only
		 * after ms milliseconds
		 * @param {number} ms milliseconds
		 * @returns {Promise}
		 */
		Promise.prototype.delay = function(ms) {
			var p = this._beget();
			this._handler.fold(handleDelay, ms, void 0, p._handler);
			return p;
		};

		function handleDelay(ms, x, h) {
			setTimeout(resolveDelay, ms, x, h);
		}

		function resolveDelay(x, h) {
			h.resolve(x);
		}

		/**
		 * Return a new promise that rejects after ms milliseconds unless
		 * this promise fulfills earlier, in which case the returned promise
		 * fulfills with the same value.
		 * @param {number} ms milliseconds
		 * @param {Error|*=} reason optional rejection reason to use, defaults
		 *   to a TimeoutError if not provided
		 * @returns {Promise}
		 */
		Promise.prototype.timeout = function(ms, reason) {
			var p = this._beget();
			var h = p._handler;

			var t = setTimeout(onTimeout, ms, reason, p._handler);

			this._handler.visit(h,
				function onFulfill(x) {
					env.clearTimer(t);
					this.resolve(x); // this = h
				},
				function onReject(x) {
					env.clearTimer(t);
					this.reject(x); // this = h
				},
				h.notify);

			return p;
		};

		function onTimeout(reason, h, ms) {
			var e = typeof reason === 'undefined'
				? new TimeoutError('timed out after ' + ms + 'ms')
				: reason;
			h.reject(e);
		}

		return Promise;
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/state',[],function() {

	return {
		pending: toPendingState,
		fulfilled: toFulfilledState,
		rejected: toRejectedState,
		inspect: inspect
	};

	function toPendingState() {
		return { state: 'pending' };
	}

	function toRejectedState(e) {
		return { state: 'rejected', reason: e };
	}

	function toFulfilledState(x) {
		return { state: 'fulfilled', value: x };
	}

	function inspect(handler) {
		var state = handler.state();
		return state === 0 ? toPendingState()
			 : state > 0   ? toFulfilledState(handler.value)
			               : toRejectedState(handler.value);
	}

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/apply',[],function() {

	makeApply.tryCatchResolve = tryCatchResolve;

	return makeApply;

	function makeApply(Promise, call) {
		if(arguments.length < 2) {
			call = tryCatchResolve;
		}

		return apply;

		function apply(f, thisArg, args) {
			var p = Promise._defer();
			var l = args.length;
			var params = new Array(l);
			callAndResolve({ f:f, thisArg:thisArg, args:args, params:params, i:l-1, call:call }, p._handler);

			return p;
		}

		function callAndResolve(c, h) {
			if(c.i < 0) {
				return call(c.f, c.thisArg, c.params, h);
			}

			var handler = Promise._handler(c.args[c.i]);
			handler.fold(callAndResolveNext, c, void 0, h);
		}

		function callAndResolveNext(c, x, h) {
			c.params[c.i] = x;
			c.i -= 1;
			callAndResolve(c, h);
		}
	}

	function tryCatchResolve(f, thisArg, args, resolver) {
		try {
			resolver.resolve(f.apply(thisArg, args));
		} catch(e) {
			resolver.reject(e);
		}
	}

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));



/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/decorators/array',['require','../state','../apply'],function(require) {

	var state = require('../state');
	var applier = require('../apply');

	return function array(Promise) {

		var applyFold = applier(Promise);
		var toPromise = Promise.resolve;
		var all = Promise.all;

		var ar = Array.prototype.reduce;
		var arr = Array.prototype.reduceRight;
		var slice = Array.prototype.slice;

		// Additional array combinators

		Promise.any = any;
		Promise.some = some;
		Promise.settle = settle;

		Promise.map = map;
		Promise.filter = filter;
		Promise.reduce = reduce;
		Promise.reduceRight = reduceRight;

		/**
		 * When this promise fulfills with an array, do
		 * onFulfilled.apply(void 0, array)
		 * @param {function} onFulfilled function to apply
		 * @returns {Promise} promise for the result of applying onFulfilled
		 */
		Promise.prototype.spread = function(onFulfilled) {
			return this.then(all).then(function(array) {
				return onFulfilled.apply(this, array);
			});
		};

		return Promise;

		/**
		 * One-winner competitive race.
		 * Return a promise that will fulfill when one of the promises
		 * in the input array fulfills, or will reject when all promises
		 * have rejected.
		 * @param {array} promises
		 * @returns {Promise} promise for the first fulfilled value
		 */
		function any(promises) {
			var p = Promise._defer();
			var resolver = p._handler;
			var l = promises.length>>>0;

			var pending = l;
			var errors = [];

			for (var h, x, i = 0; i < l; ++i) {
				x = promises[i];
				if(x === void 0 && !(i in promises)) {
					--pending;
					continue;
				}

				h = Promise._handler(x);
				if(h.state() > 0) {
					resolver.become(h);
					Promise._visitRemaining(promises, i, h);
					break;
				} else {
					h.visit(resolver, handleFulfill, handleReject);
				}
			}

			if(pending === 0) {
				resolver.reject(new RangeError('any(): array must not be empty'));
			}

			return p;

			function handleFulfill(x) {
				/*jshint validthis:true*/
				errors = null;
				this.resolve(x); // this === resolver
			}

			function handleReject(e) {
				/*jshint validthis:true*/
				if(this.resolved) { // this === resolver
					return;
				}

				errors.push(e);
				if(--pending === 0) {
					this.reject(errors);
				}
			}
		}

		/**
		 * N-winner competitive race
		 * Return a promise that will fulfill when n input promises have
		 * fulfilled, or will reject when it becomes impossible for n
		 * input promises to fulfill (ie when promises.length - n + 1
		 * have rejected)
		 * @param {array} promises
		 * @param {number} n
		 * @returns {Promise} promise for the earliest n fulfillment values
		 *
		 * @deprecated
		 */
		function some(promises, n) {
			/*jshint maxcomplexity:7*/
			var p = Promise._defer();
			var resolver = p._handler;

			var results = [];
			var errors = [];

			var l = promises.length>>>0;
			var nFulfill = 0;
			var nReject;
			var x, i; // reused in both for() loops

			// First pass: count actual array items
			for(i=0; i<l; ++i) {
				x = promises[i];
				if(x === void 0 && !(i in promises)) {
					continue;
				}
				++nFulfill;
			}

			// Compute actual goals
			n = Math.max(n, 0);
			nReject = (nFulfill - n + 1);
			nFulfill = Math.min(n, nFulfill);

			if(n > nFulfill) {
				resolver.reject(new RangeError('some(): array must contain at least '
				+ n + ' item(s), but had ' + nFulfill));
			} else if(nFulfill === 0) {
				resolver.resolve(results);
			}

			// Second pass: observe each array item, make progress toward goals
			for(i=0; i<l; ++i) {
				x = promises[i];
				if(x === void 0 && !(i in promises)) {
					continue;
				}

				Promise._handler(x).visit(resolver, fulfill, reject, resolver.notify);
			}

			return p;

			function fulfill(x) {
				/*jshint validthis:true*/
				if(this.resolved) { // this === resolver
					return;
				}

				results.push(x);
				if(--nFulfill === 0) {
					errors = null;
					this.resolve(results);
				}
			}

			function reject(e) {
				/*jshint validthis:true*/
				if(this.resolved) { // this === resolver
					return;
				}

				errors.push(e);
				if(--nReject === 0) {
					results = null;
					this.reject(errors);
				}
			}
		}

		/**
		 * Apply f to the value of each promise in a list of promises
		 * and return a new list containing the results.
		 * @param {array} promises
		 * @param {function(x:*, index:Number):*} f mapping function
		 * @returns {Promise}
		 */
		function map(promises, f) {
			return Promise._traverse(f, promises);
		}

		/**
		 * Filter the provided array of promises using the provided predicate.  Input may
		 * contain promises and values
		 * @param {Array} promises array of promises and values
		 * @param {function(x:*, index:Number):boolean} predicate filtering predicate.
		 *  Must return truthy (or promise for truthy) for items to retain.
		 * @returns {Promise} promise that will fulfill with an array containing all items
		 *  for which predicate returned truthy.
		 */
		function filter(promises, predicate) {
			var a = slice.call(promises);
			return Promise._traverse(predicate, a).then(function(keep) {
				return filterSync(a, keep);
			});
		}

		function filterSync(promises, keep) {
			// Safe because we know all promises have fulfilled if we've made it this far
			var l = keep.length;
			var filtered = new Array(l);
			for(var i=0, j=0; i<l; ++i) {
				if(keep[i]) {
					filtered[j++] = Promise._handler(promises[i]).value;
				}
			}
			filtered.length = j;
			return filtered;

		}

		/**
		 * Return a promise that will always fulfill with an array containing
		 * the outcome states of all input promises.  The returned promise
		 * will never reject.
		 * @param {Array} promises
		 * @returns {Promise} promise for array of settled state descriptors
		 */
		function settle(promises) {
			return all(promises.map(settleOne));
		}

		function settleOne(p) {
			var h = Promise._handler(p);
			if(h.state() === 0) {
				return toPromise(p).then(state.fulfilled, state.rejected);
			}

			h._unreport();
			return state.inspect(h);
		}

		/**
		 * Traditional reduce function, similar to `Array.prototype.reduce()`, but
		 * input may contain promises and/or values, and reduceFunc
		 * may return either a value or a promise, *and* initialValue may
		 * be a promise for the starting value.
		 * @param {Array|Promise} promises array or promise for an array of anything,
		 *      may contain a mix of promises and values.
		 * @param {function(accumulated:*, x:*, index:Number):*} f reduce function
		 * @returns {Promise} that will resolve to the final reduced value
		 */
		function reduce(promises, f /*, initialValue */) {
			return arguments.length > 2 ? ar.call(promises, liftCombine(f), arguments[2])
					: ar.call(promises, liftCombine(f));
		}

		/**
		 * Traditional reduce function, similar to `Array.prototype.reduceRight()`, but
		 * input may contain promises and/or values, and reduceFunc
		 * may return either a value or a promise, *and* initialValue may
		 * be a promise for the starting value.
		 * @param {Array|Promise} promises array or promise for an array of anything,
		 *      may contain a mix of promises and values.
		 * @param {function(accumulated:*, x:*, index:Number):*} f reduce function
		 * @returns {Promise} that will resolve to the final reduced value
		 */
		function reduceRight(promises, f /*, initialValue */) {
			return arguments.length > 2 ? arr.call(promises, liftCombine(f), arguments[2])
					: arr.call(promises, liftCombine(f));
		}

		function liftCombine(f) {
			return function(z, x, i) {
				return applyFold(f, void 0, [z,x,i]);
			};
		}
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/decorators/flow',[],function() {

	return function flow(Promise) {

		var resolve = Promise.resolve;
		var reject = Promise.reject;
		var origCatch = Promise.prototype['catch'];

		/**
		 * Handle the ultimate fulfillment value or rejection reason, and assume
		 * responsibility for all errors.  If an error propagates out of result
		 * or handleFatalError, it will be rethrown to the host, resulting in a
		 * loud stack track on most platforms and a crash on some.
		 * @param {function?} onResult
		 * @param {function?} onError
		 * @returns {undefined}
		 */
		Promise.prototype.done = function(onResult, onError) {
			this._handler.visit(this._handler.receiver, onResult, onError);
		};

		/**
		 * Add Error-type and predicate matching to catch.  Examples:
		 * promise.catch(TypeError, handleTypeError)
		 *   .catch(predicate, handleMatchedErrors)
		 *   .catch(handleRemainingErrors)
		 * @param onRejected
		 * @returns {*}
		 */
		Promise.prototype['catch'] = Promise.prototype.otherwise = function(onRejected) {
			if (arguments.length < 2) {
				return origCatch.call(this, onRejected);
			}

			if(typeof onRejected !== 'function') {
				return this.ensure(rejectInvalidPredicate);
			}

			return origCatch.call(this, createCatchFilter(arguments[1], onRejected));
		};

		/**
		 * Wraps the provided catch handler, so that it will only be called
		 * if the predicate evaluates truthy
		 * @param {?function} handler
		 * @param {function} predicate
		 * @returns {function} conditional catch handler
		 */
		function createCatchFilter(handler, predicate) {
			return function(e) {
				return evaluatePredicate(e, predicate)
					? handler.call(this, e)
					: reject(e);
			};
		}

		/**
		 * Ensures that onFulfilledOrRejected will be called regardless of whether
		 * this promise is fulfilled or rejected.  onFulfilledOrRejected WILL NOT
		 * receive the promises' value or reason.  Any returned value will be disregarded.
		 * onFulfilledOrRejected may throw or return a rejected promise to signal
		 * an additional error.
		 * @param {function} handler handler to be called regardless of
		 *  fulfillment or rejection
		 * @returns {Promise}
		 */
		Promise.prototype['finally'] = Promise.prototype.ensure = function(handler) {
			if(typeof handler !== 'function') {
				return this;
			}

			return this.then(function(x) {
				return runSideEffect(handler, this, identity, x);
			}, function(e) {
				return runSideEffect(handler, this, reject, e);
			});
		};

		function runSideEffect (handler, thisArg, propagate, value) {
			var result = handler.call(thisArg);
			return maybeThenable(result)
				? propagateValue(result, propagate, value)
				: propagate(value);
		}

		function propagateValue (result, propagate, x) {
			return resolve(result).then(function () {
				return propagate(x);
			});
		}

		/**
		 * Recover from a failure by returning a defaultValue.  If defaultValue
		 * is a promise, it's fulfillment value will be used.  If defaultValue is
		 * a promise that rejects, the returned promise will reject with the
		 * same reason.
		 * @param {*} defaultValue
		 * @returns {Promise} new promise
		 */
		Promise.prototype['else'] = Promise.prototype.orElse = function(defaultValue) {
			return this.then(void 0, function() {
				return defaultValue;
			});
		};

		/**
		 * Shortcut for .then(function() { return value; })
		 * @param  {*} value
		 * @return {Promise} a promise that:
		 *  - is fulfilled if value is not a promise, or
		 *  - if value is a promise, will fulfill with its value, or reject
		 *    with its reason.
		 */
		Promise.prototype['yield'] = function(value) {
			return this.then(function() {
				return value;
			});
		};

		/**
		 * Runs a side effect when this promise fulfills, without changing the
		 * fulfillment value.
		 * @param {function} onFulfilledSideEffect
		 * @returns {Promise}
		 */
		Promise.prototype.tap = function(onFulfilledSideEffect) {
			return this.then(onFulfilledSideEffect)['yield'](this);
		};

		return Promise;
	};

	function rejectInvalidPredicate() {
		throw new TypeError('catch predicate must be a function');
	}

	function evaluatePredicate(e, predicate) {
		return isError(predicate) ? e instanceof predicate : predicate(e);
	}

	function isError(predicate) {
		return predicate === Error
			|| (predicate != null && predicate.prototype instanceof Error);
	}

	function maybeThenable(x) {
		return (typeof x === 'object' || typeof x === 'function') && x !== null;
	}

	function identity(x) {
		return x;
	}

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */
/** @author Jeff Escalante */

(function(define) { 'use strict';
define('when/lib/decorators/fold',[],function() {

	return function fold(Promise) {

		Promise.prototype.fold = function(f, z) {
			var promise = this._beget();

			this._handler.fold(function(z, x, to) {
				Promise._handler(z).fold(function(x, z, to) {
					to.resolve(f.call(this, z, x));
				}, x, this, to);
			}, z, promise._handler.receiver, promise._handler);

			return promise;
		};

		return Promise;
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/decorators/inspect',['require','../state'],function(require) {

	var inspect = require('../state').inspect;

	return function inspection(Promise) {

		Promise.prototype.inspect = function() {
			return inspect(Promise._handler(this));
		};

		return Promise;
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/decorators/iterate',[],function() {

	return function generate(Promise) {

		var resolve = Promise.resolve;

		Promise.iterate = iterate;
		Promise.unfold = unfold;

		return Promise;

		/**
		 * @deprecated Use github.com/cujojs/most streams and most.iterate
		 * Generate a (potentially infinite) stream of promised values:
		 * x, f(x), f(f(x)), etc. until condition(x) returns true
		 * @param {function} f function to generate a new x from the previous x
		 * @param {function} condition function that, given the current x, returns
		 *  truthy when the iterate should stop
		 * @param {function} handler function to handle the value produced by f
		 * @param {*|Promise} x starting value, may be a promise
		 * @return {Promise} the result of the last call to f before
		 *  condition returns true
		 */
		function iterate(f, condition, handler, x) {
			return unfold(function(x) {
				return [x, f(x)];
			}, condition, handler, x);
		}

		/**
		 * @deprecated Use github.com/cujojs/most streams and most.unfold
		 * Generate a (potentially infinite) stream of promised values
		 * by applying handler(generator(seed)) iteratively until
		 * condition(seed) returns true.
		 * @param {function} unspool function that generates a [value, newSeed]
		 *  given a seed.
		 * @param {function} condition function that, given the current seed, returns
		 *  truthy when the unfold should stop
		 * @param {function} handler function to handle the value produced by unspool
		 * @param x {*|Promise} starting value, may be a promise
		 * @return {Promise} the result of the last value produced by unspool before
		 *  condition returns true
		 */
		function unfold(unspool, condition, handler, x) {
			return resolve(x).then(function(seed) {
				return resolve(condition(seed)).then(function(done) {
					return done ? seed : resolve(unspool(seed)).spread(next);
				});
			});

			function next(item, newSeed) {
				return resolve(handler(item)).then(function() {
					return unfold(unspool, condition, handler, newSeed);
				});
			}
		}
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/decorators/progress',[],function() {

	return function progress(Promise) {

		/**
		 * @deprecated
		 * Register a progress handler for this promise
		 * @param {function} onProgress
		 * @returns {Promise}
		 */
		Promise.prototype.progress = function(onProgress) {
			return this.then(void 0, void 0, onProgress);
		};

		return Promise;
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/decorators/with',[],function() {

	return function addWith(Promise) {
		/**
		 * Returns a promise whose handlers will be called with `this` set to
		 * the supplied receiver.  Subsequent promises derived from the
		 * returned promise will also have their handlers called with receiver
		 * as `this`. Calling `with` with undefined or no arguments will return
		 * a promise whose handlers will again be called in the usual Promises/A+
		 * way (no `this`) thus safely undoing any previous `with` in the
		 * promise chain.
		 *
		 * WARNING: Promises returned from `with`/`withThis` are NOT Promises/A+
		 * compliant, specifically violating 2.2.5 (http://promisesaplus.com/#point-41)
		 *
		 * @param {object} receiver `this` value for all handlers attached to
		 *  the returned promise.
		 * @returns {Promise}
		 */
		Promise.prototype['with'] = Promise.prototype.withThis = function(receiver) {
			var p = this._beget();
			var child = p._handler;
			child.receiver = receiver;
			this._handler.chain(child, receiver);
			return p;
		};

		return Promise;
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));


/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/format',[],function() {

	return {
		formatError: formatError,
		formatObject: formatObject,
		tryStringify: tryStringify
	};

	/**
	 * Format an error into a string.  If e is an Error and has a stack property,
	 * it's returned.  Otherwise, e is formatted using formatObject, with a
	 * warning added about e not being a proper Error.
	 * @param {*} e
	 * @returns {String} formatted string, suitable for output to developers
	 */
	function formatError(e) {
		var s = typeof e === 'object' && e !== null && e.stack ? e.stack : formatObject(e);
		return e instanceof Error ? s : s + ' (WARNING: non-Error used)';
	}

	/**
	 * Format an object, detecting "plain" objects and running them through
	 * JSON.stringify if possible.
	 * @param {Object} o
	 * @returns {string}
	 */
	function formatObject(o) {
		var s = String(o);
		if(s === '[object Object]' && typeof JSON !== 'undefined') {
			s = tryStringify(o, s);
		}
		return s;
	}

	/**
	 * Try to return the result of JSON.stringify(x).  If that fails, return
	 * defaultValue
	 * @param {*} x
	 * @param {*} defaultValue
	 * @returns {String|*} JSON.stringify(x) or defaultValue
	 */
	function tryStringify(x, defaultValue) {
		try {
			return JSON.stringify(x);
		} catch(e) {
			return defaultValue;
		}
	}

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/decorators/unhandledRejection',['require','../env','../format'],function(require) {

	var setTimer = require('../env').setTimer;
	var format = require('../format');

	return function unhandledRejection(Promise) {

		var logError = noop;
		var logInfo = noop;
		var localConsole;

		if(typeof console !== 'undefined') {
			// Alias console to prevent things like uglify's drop_console option from
			// removing console.log/error. Unhandled rejections fall into the same
			// category as uncaught exceptions, and build tools shouldn't silence them.
			localConsole = console;
			logError = typeof localConsole.error !== 'undefined'
				? function (e) { localConsole.error(e); }
				: function (e) { localConsole.log(e); };

			logInfo = typeof localConsole.info !== 'undefined'
				? function (e) { localConsole.info(e); }
				: function (e) { localConsole.log(e); };
		}

		Promise.onPotentiallyUnhandledRejection = function(rejection) {
			enqueue(report, rejection);
		};

		Promise.onPotentiallyUnhandledRejectionHandled = function(rejection) {
			enqueue(unreport, rejection);
		};

		Promise.onFatalRejection = function(rejection) {
			enqueue(throwit, rejection.value);
		};

		var tasks = [];
		var reported = [];
		var running = null;

		function report(r) {
			if(!r.handled) {
				reported.push(r);
				logError('Potentially unhandled rejection [' + r.id + '] ' + format.formatError(r.value));
			}
		}

		function unreport(r) {
			var i = reported.indexOf(r);
			if(i >= 0) {
				reported.splice(i, 1);
				logInfo('Handled previous rejection [' + r.id + '] ' + format.formatObject(r.value));
			}
		}

		function enqueue(f, x) {
			tasks.push(f, x);
			if(running === null) {
				running = setTimer(flush, 0);
			}
		}

		function flush() {
			running = null;
			while(tasks.length > 0) {
				tasks.shift()(tasks.shift());
			}
		}

		return Promise;
	};

	function throwit(e) {
		throw e;
	}

	function noop() {}

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/makePromise',[],function() {

	return function makePromise(environment) {

		var tasks = environment.scheduler;
		var emitRejection = initEmitRejection();

		var objectCreate = Object.create ||
			function(proto) {
				function Child() {}
				Child.prototype = proto;
				return new Child();
			};

		/**
		 * Create a promise whose fate is determined by resolver
		 * @constructor
		 * @returns {Promise} promise
		 * @name Promise
		 */
		function Promise(resolver, handler) {
			this._handler = resolver === Handler ? handler : init(resolver);
		}

		/**
		 * Run the supplied resolver
		 * @param resolver
		 * @returns {Pending}
		 */
		function init(resolver) {
			var handler = new Pending();

			try {
				resolver(promiseResolve, promiseReject, promiseNotify);
			} catch (e) {
				promiseReject(e);
			}

			return handler;

			/**
			 * Transition from pre-resolution state to post-resolution state, notifying
			 * all listeners of the ultimate fulfillment or rejection
			 * @param {*} x resolution value
			 */
			function promiseResolve (x) {
				handler.resolve(x);
			}
			/**
			 * Reject this promise with reason, which will be used verbatim
			 * @param {Error|*} reason rejection reason, strongly suggested
			 *   to be an Error type
			 */
			function promiseReject (reason) {
				handler.reject(reason);
			}

			/**
			 * @deprecated
			 * Issue a progress event, notifying all progress listeners
			 * @param {*} x progress event payload to pass to all listeners
			 */
			function promiseNotify (x) {
				handler.notify(x);
			}
		}

		// Creation

		Promise.resolve = resolve;
		Promise.reject = reject;
		Promise.never = never;

		Promise._defer = defer;
		Promise._handler = getHandler;

		/**
		 * Returns a trusted promise. If x is already a trusted promise, it is
		 * returned, otherwise returns a new trusted Promise which follows x.
		 * @param  {*} x
		 * @return {Promise} promise
		 */
		function resolve(x) {
			return isPromise(x) ? x
				: new Promise(Handler, new Async(getHandler(x)));
		}

		/**
		 * Return a reject promise with x as its reason (x is used verbatim)
		 * @param {*} x
		 * @returns {Promise} rejected promise
		 */
		function reject(x) {
			return new Promise(Handler, new Async(new Rejected(x)));
		}

		/**
		 * Return a promise that remains pending forever
		 * @returns {Promise} forever-pending promise.
		 */
		function never() {
			return foreverPendingPromise; // Should be frozen
		}

		/**
		 * Creates an internal {promise, resolver} pair
		 * @private
		 * @returns {Promise}
		 */
		function defer() {
			return new Promise(Handler, new Pending());
		}

		// Transformation and flow control

		/**
		 * Transform this promise's fulfillment value, returning a new Promise
		 * for the transformed result.  If the promise cannot be fulfilled, onRejected
		 * is called with the reason.  onProgress *may* be called with updates toward
		 * this promise's fulfillment.
		 * @param {function=} onFulfilled fulfillment handler
		 * @param {function=} onRejected rejection handler
		 * @param {function=} onProgress @deprecated progress handler
		 * @return {Promise} new promise
		 */
		Promise.prototype.then = function(onFulfilled, onRejected, onProgress) {
			var parent = this._handler;
			var state = parent.join().state();

			if ((typeof onFulfilled !== 'function' && state > 0) ||
				(typeof onRejected !== 'function' && state < 0)) {
				// Short circuit: value will not change, simply share handler
				return new this.constructor(Handler, parent);
			}

			var p = this._beget();
			var child = p._handler;

			parent.chain(child, parent.receiver, onFulfilled, onRejected, onProgress);

			return p;
		};

		/**
		 * If this promise cannot be fulfilled due to an error, call onRejected to
		 * handle the error. Shortcut for .then(undefined, onRejected)
		 * @param {function?} onRejected
		 * @return {Promise}
		 */
		Promise.prototype['catch'] = function(onRejected) {
			return this.then(void 0, onRejected);
		};

		/**
		 * Creates a new, pending promise of the same type as this promise
		 * @private
		 * @returns {Promise}
		 */
		Promise.prototype._beget = function() {
			return begetFrom(this._handler, this.constructor);
		};

		function begetFrom(parent, Promise) {
			var child = new Pending(parent.receiver, parent.join().context);
			return new Promise(Handler, child);
		}

		// Array combinators

		Promise.all = all;
		Promise.race = race;
		Promise._traverse = traverse;

		/**
		 * Return a promise that will fulfill when all promises in the
		 * input array have fulfilled, or will reject when one of the
		 * promises rejects.
		 * @param {array} promises array of promises
		 * @returns {Promise} promise for array of fulfillment values
		 */
		function all(promises) {
			return traverseWith(snd, null, promises);
		}

		/**
		 * Array<Promise<X>> -> Promise<Array<f(X)>>
		 * @private
		 * @param {function} f function to apply to each promise's value
		 * @param {Array} promises array of promises
		 * @returns {Promise} promise for transformed values
		 */
		function traverse(f, promises) {
			return traverseWith(tryCatch2, f, promises);
		}

		function traverseWith(tryMap, f, promises) {
			var handler = typeof f === 'function' ? mapAt : settleAt;

			var resolver = new Pending();
			var pending = promises.length >>> 0;
			var results = new Array(pending);

			for (var i = 0, x; i < promises.length && !resolver.resolved; ++i) {
				x = promises[i];

				if (x === void 0 && !(i in promises)) {
					--pending;
					continue;
				}

				traverseAt(promises, handler, i, x, resolver);
			}

			if(pending === 0) {
				resolver.become(new Fulfilled(results));
			}

			return new Promise(Handler, resolver);

			function mapAt(i, x, resolver) {
				if(!resolver.resolved) {
					traverseAt(promises, settleAt, i, tryMap(f, x, i), resolver);
				}
			}

			function settleAt(i, x, resolver) {
				results[i] = x;
				if(--pending === 0) {
					resolver.become(new Fulfilled(results));
				}
			}
		}

		function traverseAt(promises, handler, i, x, resolver) {
			if (maybeThenable(x)) {
				var h = getHandlerMaybeThenable(x);
				var s = h.state();

				if (s === 0) {
					h.fold(handler, i, void 0, resolver);
				} else if (s > 0) {
					handler(i, h.value, resolver);
				} else {
					resolver.become(h);
					visitRemaining(promises, i+1, h);
				}
			} else {
				handler(i, x, resolver);
			}
		}

		Promise._visitRemaining = visitRemaining;
		function visitRemaining(promises, start, handler) {
			for(var i=start; i<promises.length; ++i) {
				markAsHandled(getHandler(promises[i]), handler);
			}
		}

		function markAsHandled(h, handler) {
			if(h === handler) {
				return;
			}

			var s = h.state();
			if(s === 0) {
				h.visit(h, void 0, h._unreport);
			} else if(s < 0) {
				h._unreport();
			}
		}

		/**
		 * Fulfill-reject competitive race. Return a promise that will settle
		 * to the same state as the earliest input promise to settle.
		 *
		 * WARNING: The ES6 Promise spec requires that race()ing an empty array
		 * must return a promise that is pending forever.  This implementation
		 * returns a singleton forever-pending promise, the same singleton that is
		 * returned by Promise.never(), thus can be checked with ===
		 *
		 * @param {array} promises array of promises to race
		 * @returns {Promise} if input is non-empty, a promise that will settle
		 * to the same outcome as the earliest input promise to settle. if empty
		 * is empty, returns a promise that will never settle.
		 */
		function race(promises) {
			if(typeof promises !== 'object' || promises === null) {
				return reject(new TypeError('non-iterable passed to race()'));
			}

			// Sigh, race([]) is untestable unless we return *something*
			// that is recognizable without calling .then() on it.
			return promises.length === 0 ? never()
				 : promises.length === 1 ? resolve(promises[0])
				 : runRace(promises);
		}

		function runRace(promises) {
			var resolver = new Pending();
			var i, x, h;
			for(i=0; i<promises.length; ++i) {
				x = promises[i];
				if (x === void 0 && !(i in promises)) {
					continue;
				}

				h = getHandler(x);
				if(h.state() !== 0) {
					resolver.become(h);
					visitRemaining(promises, i+1, h);
					break;
				} else {
					h.visit(resolver, resolver.resolve, resolver.reject);
				}
			}
			return new Promise(Handler, resolver);
		}

		// Promise internals
		// Below this, everything is @private

		/**
		 * Get an appropriate handler for x, without checking for cycles
		 * @param {*} x
		 * @returns {object} handler
		 */
		function getHandler(x) {
			if(isPromise(x)) {
				return x._handler.join();
			}
			return maybeThenable(x) ? getHandlerUntrusted(x) : new Fulfilled(x);
		}

		/**
		 * Get a handler for thenable x.
		 * NOTE: You must only call this if maybeThenable(x) == true
		 * @param {object|function|Promise} x
		 * @returns {object} handler
		 */
		function getHandlerMaybeThenable(x) {
			return isPromise(x) ? x._handler.join() : getHandlerUntrusted(x);
		}

		/**
		 * Get a handler for potentially untrusted thenable x
		 * @param {*} x
		 * @returns {object} handler
		 */
		function getHandlerUntrusted(x) {
			try {
				var untrustedThen = x.then;
				return typeof untrustedThen === 'function'
					? new Thenable(untrustedThen, x)
					: new Fulfilled(x);
			} catch(e) {
				return new Rejected(e);
			}
		}

		/**
		 * Handler for a promise that is pending forever
		 * @constructor
		 */
		function Handler() {}

		Handler.prototype.when
			= Handler.prototype.become
			= Handler.prototype.notify // deprecated
			= Handler.prototype.fail
			= Handler.prototype._unreport
			= Handler.prototype._report
			= noop;

		Handler.prototype._state = 0;

		Handler.prototype.state = function() {
			return this._state;
		};

		/**
		 * Recursively collapse handler chain to find the handler
		 * nearest to the fully resolved value.
		 * @returns {object} handler nearest the fully resolved value
		 */
		Handler.prototype.join = function() {
			var h = this;
			while(h.handler !== void 0) {
				h = h.handler;
			}
			return h;
		};

		Handler.prototype.chain = function(to, receiver, fulfilled, rejected, progress) {
			this.when({
				resolver: to,
				receiver: receiver,
				fulfilled: fulfilled,
				rejected: rejected,
				progress: progress
			});
		};

		Handler.prototype.visit = function(receiver, fulfilled, rejected, progress) {
			this.chain(failIfRejected, receiver, fulfilled, rejected, progress);
		};

		Handler.prototype.fold = function(f, z, c, to) {
			this.when(new Fold(f, z, c, to));
		};

		/**
		 * Handler that invokes fail() on any handler it becomes
		 * @constructor
		 */
		function FailIfRejected() {}

		inherit(Handler, FailIfRejected);

		FailIfRejected.prototype.become = function(h) {
			h.fail();
		};

		var failIfRejected = new FailIfRejected();

		/**
		 * Handler that manages a queue of consumers waiting on a pending promise
		 * @constructor
		 */
		function Pending(receiver, inheritedContext) {
			Promise.createContext(this, inheritedContext);

			this.consumers = void 0;
			this.receiver = receiver;
			this.handler = void 0;
			this.resolved = false;
		}

		inherit(Handler, Pending);

		Pending.prototype._state = 0;

		Pending.prototype.resolve = function(x) {
			this.become(getHandler(x));
		};

		Pending.prototype.reject = function(x) {
			if(this.resolved) {
				return;
			}

			this.become(new Rejected(x));
		};

		Pending.prototype.join = function() {
			if (!this.resolved) {
				return this;
			}

			var h = this;

			while (h.handler !== void 0) {
				h = h.handler;
				if (h === this) {
					return this.handler = cycle();
				}
			}

			return h;
		};

		Pending.prototype.run = function() {
			var q = this.consumers;
			var handler = this.handler;
			this.handler = this.handler.join();
			this.consumers = void 0;

			for (var i = 0; i < q.length; ++i) {
				handler.when(q[i]);
			}
		};

		Pending.prototype.become = function(handler) {
			if(this.resolved) {
				return;
			}

			this.resolved = true;
			this.handler = handler;
			if(this.consumers !== void 0) {
				tasks.enqueue(this);
			}

			if(this.context !== void 0) {
				handler._report(this.context);
			}
		};

		Pending.prototype.when = function(continuation) {
			if(this.resolved) {
				tasks.enqueue(new ContinuationTask(continuation, this.handler));
			} else {
				if(this.consumers === void 0) {
					this.consumers = [continuation];
				} else {
					this.consumers.push(continuation);
				}
			}
		};

		/**
		 * @deprecated
		 */
		Pending.prototype.notify = function(x) {
			if(!this.resolved) {
				tasks.enqueue(new ProgressTask(x, this));
			}
		};

		Pending.prototype.fail = function(context) {
			var c = typeof context === 'undefined' ? this.context : context;
			this.resolved && this.handler.join().fail(c);
		};

		Pending.prototype._report = function(context) {
			this.resolved && this.handler.join()._report(context);
		};

		Pending.prototype._unreport = function() {
			this.resolved && this.handler.join()._unreport();
		};

		/**
		 * Wrap another handler and force it into a future stack
		 * @param {object} handler
		 * @constructor
		 */
		function Async(handler) {
			this.handler = handler;
		}

		inherit(Handler, Async);

		Async.prototype.when = function(continuation) {
			tasks.enqueue(new ContinuationTask(continuation, this));
		};

		Async.prototype._report = function(context) {
			this.join()._report(context);
		};

		Async.prototype._unreport = function() {
			this.join()._unreport();
		};

		/**
		 * Handler that wraps an untrusted thenable and assimilates it in a future stack
		 * @param {function} then
		 * @param {{then: function}} thenable
		 * @constructor
		 */
		function Thenable(then, thenable) {
			Pending.call(this);
			tasks.enqueue(new AssimilateTask(then, thenable, this));
		}

		inherit(Pending, Thenable);

		/**
		 * Handler for a fulfilled promise
		 * @param {*} x fulfillment value
		 * @constructor
		 */
		function Fulfilled(x) {
			Promise.createContext(this);
			this.value = x;
		}

		inherit(Handler, Fulfilled);

		Fulfilled.prototype._state = 1;

		Fulfilled.prototype.fold = function(f, z, c, to) {
			runContinuation3(f, z, this, c, to);
		};

		Fulfilled.prototype.when = function(cont) {
			runContinuation1(cont.fulfilled, this, cont.receiver, cont.resolver);
		};

		var errorId = 0;

		/**
		 * Handler for a rejected promise
		 * @param {*} x rejection reason
		 * @constructor
		 */
		function Rejected(x) {
			Promise.createContext(this);

			this.id = ++errorId;
			this.value = x;
			this.handled = false;
			this.reported = false;

			this._report();
		}

		inherit(Handler, Rejected);

		Rejected.prototype._state = -1;

		Rejected.prototype.fold = function(f, z, c, to) {
			to.become(this);
		};

		Rejected.prototype.when = function(cont) {
			if(typeof cont.rejected === 'function') {
				this._unreport();
			}
			runContinuation1(cont.rejected, this, cont.receiver, cont.resolver);
		};

		Rejected.prototype._report = function(context) {
			tasks.afterQueue(new ReportTask(this, context));
		};

		Rejected.prototype._unreport = function() {
			if(this.handled) {
				return;
			}
			this.handled = true;
			tasks.afterQueue(new UnreportTask(this));
		};

		Rejected.prototype.fail = function(context) {
			this.reported = true;
			emitRejection('unhandledRejection', this);
			Promise.onFatalRejection(this, context === void 0 ? this.context : context);
		};

		function ReportTask(rejection, context) {
			this.rejection = rejection;
			this.context = context;
		}

		ReportTask.prototype.run = function() {
			if(!this.rejection.handled && !this.rejection.reported) {
				this.rejection.reported = true;
				emitRejection('unhandledRejection', this.rejection) ||
					Promise.onPotentiallyUnhandledRejection(this.rejection, this.context);
			}
		};

		function UnreportTask(rejection) {
			this.rejection = rejection;
		}

		UnreportTask.prototype.run = function() {
			if(this.rejection.reported) {
				emitRejection('rejectionHandled', this.rejection) ||
					Promise.onPotentiallyUnhandledRejectionHandled(this.rejection);
			}
		};

		// Unhandled rejection hooks
		// By default, everything is a noop

		Promise.createContext
			= Promise.enterContext
			= Promise.exitContext
			= Promise.onPotentiallyUnhandledRejection
			= Promise.onPotentiallyUnhandledRejectionHandled
			= Promise.onFatalRejection
			= noop;

		// Errors and singletons

		var foreverPendingHandler = new Handler();
		var foreverPendingPromise = new Promise(Handler, foreverPendingHandler);

		function cycle() {
			return new Rejected(new TypeError('Promise cycle'));
		}

		// Task runners

		/**
		 * Run a single consumer
		 * @constructor
		 */
		function ContinuationTask(continuation, handler) {
			this.continuation = continuation;
			this.handler = handler;
		}

		ContinuationTask.prototype.run = function() {
			this.handler.join().when(this.continuation);
		};

		/**
		 * Run a queue of progress handlers
		 * @constructor
		 */
		function ProgressTask(value, handler) {
			this.handler = handler;
			this.value = value;
		}

		ProgressTask.prototype.run = function() {
			var q = this.handler.consumers;
			if(q === void 0) {
				return;
			}

			for (var c, i = 0; i < q.length; ++i) {
				c = q[i];
				runNotify(c.progress, this.value, this.handler, c.receiver, c.resolver);
			}
		};

		/**
		 * Assimilate a thenable, sending it's value to resolver
		 * @param {function} then
		 * @param {object|function} thenable
		 * @param {object} resolver
		 * @constructor
		 */
		function AssimilateTask(then, thenable, resolver) {
			this._then = then;
			this.thenable = thenable;
			this.resolver = resolver;
		}

		AssimilateTask.prototype.run = function() {
			var h = this.resolver;
			tryAssimilate(this._then, this.thenable, _resolve, _reject, _notify);

			function _resolve(x) { h.resolve(x); }
			function _reject(x)  { h.reject(x); }
			function _notify(x)  { h.notify(x); }
		};

		function tryAssimilate(then, thenable, resolve, reject, notify) {
			try {
				then.call(thenable, resolve, reject, notify);
			} catch (e) {
				reject(e);
			}
		}

		/**
		 * Fold a handler value with z
		 * @constructor
		 */
		function Fold(f, z, c, to) {
			this.f = f; this.z = z; this.c = c; this.to = to;
			this.resolver = failIfRejected;
			this.receiver = this;
		}

		Fold.prototype.fulfilled = function(x) {
			this.f.call(this.c, this.z, x, this.to);
		};

		Fold.prototype.rejected = function(x) {
			this.to.reject(x);
		};

		Fold.prototype.progress = function(x) {
			this.to.notify(x);
		};

		// Other helpers

		/**
		 * @param {*} x
		 * @returns {boolean} true iff x is a trusted Promise
		 */
		function isPromise(x) {
			return x instanceof Promise;
		}

		/**
		 * Test just enough to rule out primitives, in order to take faster
		 * paths in some code
		 * @param {*} x
		 * @returns {boolean} false iff x is guaranteed *not* to be a thenable
		 */
		function maybeThenable(x) {
			return (typeof x === 'object' || typeof x === 'function') && x !== null;
		}

		function runContinuation1(f, h, receiver, next) {
			if(typeof f !== 'function') {
				return next.become(h);
			}

			Promise.enterContext(h);
			tryCatchReject(f, h.value, receiver, next);
			Promise.exitContext();
		}

		function runContinuation3(f, x, h, receiver, next) {
			if(typeof f !== 'function') {
				return next.become(h);
			}

			Promise.enterContext(h);
			tryCatchReject3(f, x, h.value, receiver, next);
			Promise.exitContext();
		}

		/**
		 * @deprecated
		 */
		function runNotify(f, x, h, receiver, next) {
			if(typeof f !== 'function') {
				return next.notify(x);
			}

			Promise.enterContext(h);
			tryCatchReturn(f, x, receiver, next);
			Promise.exitContext();
		}

		function tryCatch2(f, a, b) {
			try {
				return f(a, b);
			} catch(e) {
				return reject(e);
			}
		}

		/**
		 * Return f.call(thisArg, x), or if it throws return a rejected promise for
		 * the thrown exception
		 */
		function tryCatchReject(f, x, thisArg, next) {
			try {
				next.become(getHandler(f.call(thisArg, x)));
			} catch(e) {
				next.become(new Rejected(e));
			}
		}

		/**
		 * Same as above, but includes the extra argument parameter.
		 */
		function tryCatchReject3(f, x, y, thisArg, next) {
			try {
				f.call(thisArg, x, y, next);
			} catch(e) {
				next.become(new Rejected(e));
			}
		}

		/**
		 * @deprecated
		 * Return f.call(thisArg, x), or if it throws, *return* the exception
		 */
		function tryCatchReturn(f, x, thisArg, next) {
			try {
				next.notify(f.call(thisArg, x));
			} catch(e) {
				next.notify(e);
			}
		}

		function inherit(Parent, Child) {
			Child.prototype = objectCreate(Parent.prototype);
			Child.prototype.constructor = Child;
		}

		function snd(x, y) {
			return y;
		}

		function noop() {}

		function initEmitRejection() {
			/*global process, self, CustomEvent*/
			if(typeof process !== 'undefined' && process !== null
				&& typeof process.emit === 'function') {
				// Returning falsy here means to call the default
				// onPotentiallyUnhandledRejection API.  This is safe even in
				// browserify since process.emit always returns falsy in browserify:
				// https://github.com/defunctzombie/node-process/blob/master/browser.js#L40-L46
				return function(type, rejection) {
					return type === 'unhandledRejection'
						? process.emit(type, rejection.value, rejection)
						: process.emit(type, rejection);
				};
			} else if(typeof self !== 'undefined' && typeof CustomEvent === 'function') {
				return (function(noop, self, CustomEvent) {
					var hasCustomEvent = false;
					try {
						var ev = new CustomEvent('unhandledRejection');
						hasCustomEvent = ev instanceof CustomEvent;
					} catch (e) {}

					return !hasCustomEvent ? noop : function(type, rejection) {
						var ev = new CustomEvent(type, {
							detail: {
								reason: rejection.value,
								key: rejection
							},
							bubbles: false,
							cancelable: true
						});

						return !self.dispatchEvent(ev);
					};
				}(noop, self, CustomEvent));
			}

			return noop;
		}

		return Promise;
	};
});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/Scheduler',[],function() {

	// Credit to Twisol (https://github.com/Twisol) for suggesting
	// this type of extensible queue + trampoline approach for next-tick conflation.

	/**
	 * Async task scheduler
	 * @param {function} async function to schedule a single async function
	 * @constructor
	 */
	function Scheduler(async) {
		this._async = async;
		this._running = false;

		this._queue = this;
		this._queueLen = 0;
		this._afterQueue = {};
		this._afterQueueLen = 0;

		var self = this;
		this.drain = function() {
			self._drain();
		};
	}

	/**
	 * Enqueue a task
	 * @param {{ run:function }} task
	 */
	Scheduler.prototype.enqueue = function(task) {
		this._queue[this._queueLen++] = task;
		this.run();
	};

	/**
	 * Enqueue a task to run after the main task queue
	 * @param {{ run:function }} task
	 */
	Scheduler.prototype.afterQueue = function(task) {
		this._afterQueue[this._afterQueueLen++] = task;
		this.run();
	};

	Scheduler.prototype.run = function() {
		if (!this._running) {
			this._running = true;
			this._async(this.drain);
		}
	};

	/**
	 * Drain the handler queue entirely, and then the after queue
	 */
	Scheduler.prototype._drain = function() {
		var i = 0;
		for (; i < this._queueLen; ++i) {
			this._queue[i].run();
			this._queue[i] = void 0;
		}

		this._queueLen = 0;
		this._running = false;

		for (i = 0; i < this._afterQueueLen; ++i) {
			this._afterQueue[i].run();
			this._afterQueue[i] = void 0;
		}

		this._afterQueueLen = 0;
	};

	return Scheduler;

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2014 original author or authors */
/** @author Brian Cavalier */
/** @author John Hann */

(function(define) { 'use strict';
define('when/lib/Promise',['require','./makePromise','./Scheduler','./env'],function (require) {

	var makePromise = require('./makePromise');
	var Scheduler = require('./Scheduler');
	var async = require('./env').asap;

	return makePromise({
		scheduler: new Scheduler(async)
	});

});
})(typeof define === 'function' && define.amd ? define : function (factory) { module.exports = factory(require); });

/** @license MIT License (c) copyright 2010-2014 original author or authors */

/**
 * Promises/A+ and when() implementation
 * when is part of the cujoJS family of libraries (http://cujojs.com/)
 * @author Brian Cavalier
 * @author John Hann
 */
(function(define) { 'use strict';
define('when/when',['require','./lib/decorators/timed','./lib/decorators/array','./lib/decorators/flow','./lib/decorators/fold','./lib/decorators/inspect','./lib/decorators/iterate','./lib/decorators/progress','./lib/decorators/with','./lib/decorators/unhandledRejection','./lib/TimeoutError','./lib/Promise','./lib/apply'],function (require) {

	var timed = require('./lib/decorators/timed');
	var array = require('./lib/decorators/array');
	var flow = require('./lib/decorators/flow');
	var fold = require('./lib/decorators/fold');
	var inspect = require('./lib/decorators/inspect');
	var generate = require('./lib/decorators/iterate');
	var progress = require('./lib/decorators/progress');
	var withThis = require('./lib/decorators/with');
	var unhandledRejection = require('./lib/decorators/unhandledRejection');
	var TimeoutError = require('./lib/TimeoutError');

	var Promise = [array, flow, fold, generate, progress,
		inspect, withThis, timed, unhandledRejection]
		.reduce(function(Promise, feature) {
			return feature(Promise);
		}, require('./lib/Promise'));

	var apply = require('./lib/apply')(Promise);

	// Public API

	when.promise     = promise;              // Create a pending promise
	when.resolve     = Promise.resolve;      // Create a resolved promise
	when.reject      = Promise.reject;       // Create a rejected promise

	when.lift        = lift;                 // lift a function to return promises
	when['try']      = attempt;              // call a function and return a promise
	when.attempt     = attempt;              // alias for when.try

	when.iterate     = Promise.iterate;      // DEPRECATED (use cujojs/most streams) Generate a stream of promises
	when.unfold      = Promise.unfold;       // DEPRECATED (use cujojs/most streams) Generate a stream of promises

	when.join        = join;                 // Join 2 or more promises

	when.all         = all;                  // Resolve a list of promises
	when.settle      = settle;               // Settle a list of promises

	when.any         = lift(Promise.any);    // One-winner race
	when.some        = lift(Promise.some);   // Multi-winner race
	when.race        = lift(Promise.race);   // First-to-settle race

	when.map         = map;                  // Array.map() for promises
	when.filter      = filter;               // Array.filter() for promises
	when.reduce      = lift(Promise.reduce);       // Array.reduce() for promises
	when.reduceRight = lift(Promise.reduceRight);  // Array.reduceRight() for promises

	when.isPromiseLike = isPromiseLike;      // Is something promise-like, aka thenable

	when.Promise     = Promise;              // Promise constructor
	when.defer       = defer;                // Create a {promise, resolve, reject} tuple

	// Error types

	when.TimeoutError = TimeoutError;

	/**
	 * Get a trusted promise for x, or by transforming x with onFulfilled
	 *
	 * @param {*} x
	 * @param {function?} onFulfilled callback to be called when x is
	 *   successfully fulfilled.  If promiseOrValue is an immediate value, callback
	 *   will be invoked immediately.
	 * @param {function?} onRejected callback to be called when x is
	 *   rejected.
	 * @param {function?} onProgress callback to be called when progress updates
	 *   are issued for x. @deprecated
	 * @returns {Promise} a new promise that will fulfill with the return
	 *   value of callback or errback or the completion value of promiseOrValue if
	 *   callback and/or errback is not supplied.
	 */
	function when(x, onFulfilled, onRejected, onProgress) {
		var p = Promise.resolve(x);
		if (arguments.length < 2) {
			return p;
		}

		return p.then(onFulfilled, onRejected, onProgress);
	}

	/**
	 * Creates a new promise whose fate is determined by resolver.
	 * @param {function} resolver function(resolve, reject, notify)
	 * @returns {Promise} promise whose fate is determine by resolver
	 */
	function promise(resolver) {
		return new Promise(resolver);
	}

	/**
	 * Lift the supplied function, creating a version of f that returns
	 * promises, and accepts promises as arguments.
	 * @param {function} f
	 * @returns {Function} version of f that returns promises
	 */
	function lift(f) {
		return function() {
			for(var i=0, l=arguments.length, a=new Array(l); i<l; ++i) {
				a[i] = arguments[i];
			}
			return apply(f, this, a);
		};
	}

	/**
	 * Call f in a future turn, with the supplied args, and return a promise
	 * for the result.
	 * @param {function} f
	 * @returns {Promise}
	 */
	function attempt(f /*, args... */) {
		/*jshint validthis:true */
		for(var i=0, l=arguments.length-1, a=new Array(l); i<l; ++i) {
			a[i] = arguments[i+1];
		}
		return apply(f, this, a);
	}

	/**
	 * Creates a {promise, resolver} pair, either or both of which
	 * may be given out safely to consumers.
	 * @return {{promise: Promise, resolve: function, reject: function, notify: function}}
	 */
	function defer() {
		return new Deferred();
	}

	function Deferred() {
		var p = Promise._defer();

		function resolve(x) { p._handler.resolve(x); }
		function reject(x) { p._handler.reject(x); }
		function notify(x) { p._handler.notify(x); }

		this.promise = p;
		this.resolve = resolve;
		this.reject = reject;
		this.notify = notify;
		this.resolver = { resolve: resolve, reject: reject, notify: notify };
	}

	/**
	 * Determines if x is promise-like, i.e. a thenable object
	 * NOTE: Will return true for *any thenable object*, and isn't truly
	 * safe, since it may attempt to access the `then` property of x (i.e.
	 *  clever/malicious getters may do weird things)
	 * @param {*} x anything
	 * @returns {boolean} true if x is promise-like
	 */
	function isPromiseLike(x) {
		return x && typeof x.then === 'function';
	}

	/**
	 * Return a promise that will resolve only once all the supplied arguments
	 * have resolved. The resolution value of the returned promise will be an array
	 * containing the resolution values of each of the arguments.
	 * @param {...*} arguments may be a mix of promises and values
	 * @returns {Promise}
	 */
	function join(/* ...promises */) {
		return Promise.all(arguments);
	}

	/**
	 * Return a promise that will fulfill once all input promises have
	 * fulfilled, or reject when any one input promise rejects.
	 * @param {array|Promise} promises array (or promise for an array) of promises
	 * @returns {Promise}
	 */
	function all(promises) {
		return when(promises, Promise.all);
	}

	/**
	 * Return a promise that will always fulfill with an array containing
	 * the outcome states of all input promises.  The returned promise
	 * will only reject if `promises` itself is a rejected promise.
	 * @param {array|Promise} promises array (or promise for an array) of promises
	 * @returns {Promise} promise for array of settled state descriptors
	 */
	function settle(promises) {
		return when(promises, Promise.settle);
	}

	/**
	 * Promise-aware array map function, similar to `Array.prototype.map()`,
	 * but input array may contain promises or values.
	 * @param {Array|Promise} promises array of anything, may contain promises and values
	 * @param {function(x:*, index:Number):*} mapFunc map function which may
	 *  return a promise or value
	 * @returns {Promise} promise that will fulfill with an array of mapped values
	 *  or reject if any input promise rejects.
	 */
	function map(promises, mapFunc) {
		return when(promises, function(promises) {
			return Promise.map(promises, mapFunc);
		});
	}

	/**
	 * Filter the provided array of promises using the provided predicate.  Input may
	 * contain promises and values
	 * @param {Array|Promise} promises array of promises and values
	 * @param {function(x:*, index:Number):boolean} predicate filtering predicate.
	 *  Must return truthy (or promise for truthy) for items to retain.
	 * @returns {Promise} promise that will fulfill with an array containing all items
	 *  for which predicate returned truthy.
	 */
	function filter(promises, predicate) {
		return when(promises, function(promises) {
			return Promise.filter(promises, predicate);
		});
	}

	return when;
});
})(typeof define === 'function' && define.amd ? define : function (factory) { module.exports = factory(require); });

define('when', ['when/when'], function (main) { return main; });

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define){ 'use strict';
define('wire/lib/object',[],function() {

	var hasOwn;

	hasOwn = Object.prototype.hasOwnProperty.call.bind(Object.prototype.hasOwnProperty);

	return {
		hasOwn: hasOwn,
		isObject: isObject,
		inherit: inherit,
		mixin: mixin,
		extend: extend
	};

	function isObject(it) {
		// In IE7 tos.call(null) is '[object Object]'
		// so we need to check to see if 'it' is
		// even set
		return it && Object.prototype.toString.call(it) == '[object Object]';
	}

	function inherit(parent) {
		return parent ? Object.create(parent) : {};
	}

	/**
	 * Brute force copy own properties from -> to. Effectively an
	 * ES6 Object.assign polyfill, usable with Array.prototype.reduce.
	 * @param {object} to
	 * @param {object} from
	 * @returns {object} to
	 */
	function mixin(to, from) {
		if(!from) {
			return to;
		}

		return Object.keys(from).reduce(function(to, key) {
			to[key] = from[key];
			return to;
		}, to);
	}

	/**
	 * Beget a new object from base and then mixin own properties from
	 * extensions.  Equivalent to mixin(inherit(base), extensions)
	 * @param {object} base
	 * @param {object} extensions
	 * @returns {object}
	 */
	function extend(base, extensions) {
		return mixin(inherit(base), extensions);
	}

});
})(typeof define == 'function'
	// AMD
	? define
	// CommonJS
	: function(factory) { module.exports = factory(); }
);
/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */
(function(define) { 'use strict';
define('wire/lib/loader/adapter',['require','when'],function(require) {

	var when = require('when');

	// Sniff for the platform's loader
	return typeof exports == 'object'
		? function(require) {
			return function(moduleId) {
				try {
					return when.resolve(require(moduleId));
				} catch(e) {
					return when.reject(e);
				}
			};
		}
		: function (require) {
			return function(moduleId) {
				var deferred = when.defer();
				require([moduleId], deferred.resolve, deferred.reject);
				return deferred.promise;
			};
		};

});
}(typeof define === 'function' ? define : function(factory) { module.exports = factory(require); }));


/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */
(function(define) { 'use strict';
define('wire/lib/loader/moduleId',[],function() {

	return {
		base: base,
		resolve: resolve
	};

	/**
	 * Given a moduleId, returns the "basename".  For example:
	 * base('foo/bar/baz') -> 'foo/bar'
	 * base('foo') -> 'foo'
	 * @param id
	 * @returns {*}
	 */
	function base(id) {
		if(!id) {
			return '';
		}

		var split = id.lastIndexOf('/');
		return split >= 0 ? id.slice(0, split) : id;
	}

	/**
	 * Resolve id against base (which is also an id), such that the
	 * returned resolved id contains no leading '.' or '..'
	 * components.  Id may be relative or absolute, and may also
	 * be an AMD plugin plus resource id, in which case both the
	 * plugin id and the resource id may be relative or absolute.
	 * @param {string} base module id against which id will be resolved
	 * @param {string} id module id to resolve, may be an
	 *  AMD plugin+resource id.
	 * @returns {string} resolved id with no leading '.' or '..'
	 *  components.  If the input id was an AMD plugin+resource id,
	 *  both the plugin id and the resource id will be resolved in
	 *  the returned id (thus neither will have leading '.' or '..'
	 *  components)
	 */
	function resolve(base, id) {
		if(typeof id != 'string') {
			return base;
		}

		return id.split('!').map(function(part) {
			return resolveId(base, part.trim());
		}).join('!');
	}

	function resolveId(base, id) {
		var up, prefix;

		if(id === '' || id === '.' || id === './') {
			return base;
		}

		if(id[0] != '.') {
			return id;
		}

		prefix = base;

		if(id == '..' || id == '../') {
			up = 1;
			id = '';
		} else {
			up = 0;
			id = id.replace(/^(\.\.?\/)+/, function(s) {
				s.replace(/\.\./g, function(s) {
					up++;
					return s;
				});
				return '';
			});

			if(id == '..') {
				up++;
				id = '';
			} else if(id == '.') {
				id = '';
			}
		}

		if(up > 0) {
			prefix = prefix.split('/');
			up = Math.max(0, prefix.length - up);
			prefix = prefix.slice(0, up).join('/');
		}

		if(id.length && id[0] !== '/' && prefix[prefix.length-1] !== '/') {
			prefix += '/';
		}

		if(prefix[0] == '/') {
			prefix = prefix.slice(1);
		}

		return prefix + id;
	}

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */
(function(define) { 'use strict';
define('wire/lib/loader/relative',['require','./moduleId'],function(require) {

	var mid = require('./moduleId');

	return function relativeLoader(loader, referenceId) {
		referenceId = mid.base(referenceId);
		return function(moduleId) {
			return loader(mid.resolve(referenceId, moduleId));
		};
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */

(function(define) { 'use strict';
define('wire/lib/advice',['require','when'],function(require) {

	var when;

	when = require('when');

	// Very simple advice functions for internal wire use only.
	// This is NOT a replacement for meld.  These advices stack
	// differently and will not be as efficient.
	return {
		before: before,
		after: after,
		beforeAsync: beforeAsync,
		afterAsync: afterAsync
	};

	/**
	 * Execute advice before f, passing same arguments to both, and
	 * discarding advice's return value.
	 * @param {function} f function to advise
	 * @param {function} advice function to execute before f
	 * @returns {function} advised function
	 */
	function before(f, advice) {
		return function() {
			advice.apply(this, arguments);
			return f.apply(this, arguments);
		};
	}

	/**
	 * Execute advice after f, passing f's return value to advice
	 * @param {function} f function to advise
	 * @param {function} advice function to execute after f
	 * @returns {function} advised function
	 */
	function after(f, advice) {
		return function() {
			return advice.call(this, f.apply(this, arguments));
		};
	}

	/**
	 * Execute f after a promise returned by advice fulfills. The same args
	 * will be passed to both advice and f.
	 * @param {function} f function to advise
	 * @param {function} advice function to execute before f
	 * @returns {function} advised function which always returns a promise
	 */
	function beforeAsync(f, advice) {
		return function() {
			var self, args;

			self = this;
			args = arguments;

			return when(args, function() {
				return advice.apply(self, args);
			}).then(function() {
				return f.apply(self, args);
			});
		};
	}

	/**
	 * Execute advice after a promise returned by f fulfills. The same args
	 * will be passed to both advice and f.
	 * @param {function} f function to advise
	 * @param {function} advice function to execute after f
	 * @returns {function} advised function which always returns a promise
	 */
	function afterAsync(f, advice) {
		return function() {
			var self = this;

			return when(arguments, function(args) {
				return f.apply(self, args);
			}).then(function(result) {
				return advice.call(self, result);
			});
		};
	}


});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define){ 'use strict';
	define('wire/lib/WireContext',['require','./object'],function(require) {

		var object, undef;

		object = require('./object');

		function WireContext() {}

		WireContext.inherit = function(parent, api) {
			var contextApi, context;

			contextApi = object.inherit(parent);
			object.mixin(contextApi, api);

			WireContext.prototype = contextApi;

			context = new WireContext();
			WireContext.prototype = undef;

			return context;
		};

		return WireContext;

	});
}(typeof define === 'function' ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2011-2013 original author or authors */

/**
 * sequence.js
 *
 * Run a set of task functions in sequence.  All tasks will
 * receive the same args.
 *
 * @author Brian Cavalier
 * @author John Hann
 */

(function(define) {
define('when/sequence',['require','./when'],function(require) {

	var when = require('./when');
	var all = when.Promise.all;
	var slice = Array.prototype.slice;

	/**
	 * Run array of tasks in sequence with no overlap
	 * @param tasks {Array|Promise} array or promiseForArray of task functions
	 * @param [args] {*} arguments to be passed to all tasks
	 * @return {Promise} promise for an array containing
	 * the result of each task in the array position corresponding
	 * to position of the task in the tasks array
	 */
	return function sequence(tasks /*, args... */) {
		var results = [];

		return all(slice.call(arguments, 1)).then(function(args) {
			return when.reduce(tasks, function(results, task) {
				return when(task.apply(void 0, args), addResult);
			}, results);
		});

		function addResult(result) {
			results.push(result);
			return results;
		}
	};

});
})(typeof define === 'function' && define.amd ? define : function (factory) { module.exports = factory(require); });



/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define){ 'use strict';
define('wire/lib/array',[],function() {


	var slice = [].slice;

	return {
		delegate: delegateArray,
		fromArguments: fromArguments,
		union: union
	};

	/**
	 * Creates a new {Array} with the same contents as array
	 * @param array {Array}
	 * @return {Array} a new {Array} with the same contents as array. If array is falsey,
	 *  returns a new empty {Array}
	 */
	function delegateArray(array) {
		return array ? [].concat(array) : [];
	}

	function fromArguments(args, index) {
		return slice.call(args, index||0);
	}

	/**
	 * Returns a new set that is the union of the two supplied sets
	 * @param {Array} a1 set
	 * @param {Array} a2 set
	 * @returns {Array} union of a1 and a2
	 */
	function union(a1, a2) {
		// If either is empty, return the other
		if(!a1.length) {
			return a2.slice();
		} else if(!a2.length) {
			return a1.slice();
		}

		return a2.reduce(function(union, a2item) {
			if(union.indexOf(a2item) === -1) {
				union.push(a2item);
			}
			return union;
		}, a1.slice());
	}

});
})(typeof define == 'function'
	// AMD
	? define
	// CommonJS
	: function(factory) { module.exports = factory(); }
);
/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */

(function(define) { 'use strict';
define('wire/lib/Map',[],function() {

	function Map() {
		this.clear();
	}

	Map.prototype = {
		get: function(key) {
			var value, found;
			found = this._data.some(function(entry) {
				if(entry.key === key) {
					value = entry.value;
					return true;
				}
			});

			return found ? value : arguments[1];
		},

		set: function(key, value) {
			var replaced = this._data.some(function(entry) {
				if(entry.key === key) {
					entry.value = value;
					return true;
				}
			});

			if(!replaced) {
				this._data.push({ key: key, value: value });
			}
		},

		has: function(key) {
			return this._data.some(function(entry) {
				return entry.key === key;
			});
		},

		'delete': function(key) {
			var value, found;
			found = this._data.some(function(entry, i, array) {
				if(entry.key === key) {
					value = entry.value;
					array.splice(i, 1);
					return true;
				}
			});
		},

		clear: function() {
			this._data = [];
		}
	};

	return Map;

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define){ 'use strict';
define('wire/lib/WireProxy',['require','./object','./array'],function(require) {

	var object, array;

	object = require('./object');
	array = require('./array');

	/**
	 * A base proxy for all components that wire creates.  It allows wire's
	 * internals and plugins to work with components using a standard interface.
	 * WireProxy instances may be extended to specialize the behavior of the
	 * interface for a particular type of component.  For example, there is a
	 * specialized version for DOM Nodes.
	 * @param {*} target value to be proxied
	 * @constructor
	 */
	function WireProxy(target) {
		// read-only target
		Object.defineProperty(this, 'target', { value: target });
	}

	WireProxy.prototype = {
		/**
		 * Get the value of the named property. Sub-types should
		 * override to get properties from their targets in whatever
		 * specialized way is necessary.
		 * @param {string} property
		 * @returns {*} the value or undefined
		 */
		get: function (property) {
			return this.target[property];
		},

		/**
		 * Set the value of the named property. Sub-types should
		 * override to set properties on their targets in whatever
		 * specialized way is necessary.
		 * @param {string} property
		 * @param {*} value
		 * @returns {*}
		 */
		set: function (property, value) {
			this.target[property] = value;
			return value;
		},

		/**
		 * Invoke the method, with the supplied args, on the proxy's
		 * target. Sub-types should override to invoke methods their
		 * targets in whatever specialized way is necessary.
		 * @param {string|function} method name of method to invoke or
		 *  a function to call using proxy's target as the thisArg
		 * @param {array} args arguments to pass to method
		 * @returns {*} the method's return value
		 */
		invoke: function (method, args) {
			var target = this.target;

			if (typeof method === 'string') {
				method = target[method];
			}

			return method.apply(target, array.fromArguments(args));
		},

		/**
		 * Add an aspect to the proxy's target. Sub-types should
		 * override to add aspects in whatever specialized way is
		 * necessary.
		 * @param {String|Array|RegExp|Function} pointcut
		 *  expression matching methods to be advised
		 * @param {Object} aspect aspect to add
		 * @returns {{remove:function}} object with remove() that
		 *  will remove the aspect.
		 */
		advise: function(pointcut, aspect) {
			/*jshint unused:false*/
			throw new TypeError('Advice not supported on component type: ' + this.target);
		},

		/**
		 * Destroy the proxy's target.  Sub-types should override
		 * to destroy their targets in whatever specialized way is
		 * necessary.
		 */
		destroy: function() {},

		/**
		 * Attempt to clone this proxy's target. Sub-types should
		 * override to clone their targets in whatever specialized
		 * way is necessary.
		 * @param {object|array|function} thing thing to clone
		 * @param {object} options
		 * @param {boolean} options.deep if true and thing is an Array, try to deep clone its contents
		 * @param {boolean} options.inherited if true and thing is an object, clone inherited and own properties.
		 * @returns {*}
		 */
		clone: function (options) {
			// don't try to clone a primitive
			var target = this.target;

			if (typeof target == 'function') {
				// cloneThing doesn't clone functions, so clone here:
				return target.bind();
			} else if (typeof target != 'object') {
				return target;
			}

			return cloneThing(target, options || {});
		}
	};

	WireProxy.isProxy = isProxy;
	WireProxy.getTarget = getTarget;
	WireProxy.extend = extendProxy;

	return WireProxy;

	/**
	 * Returns a new WireProxy, whose prototype is proxy, with extensions
	 * as own properties.  This is the "official" way to extend the functionality
	 * of an existing WireProxy.
	 * @param {WireProxy} proxy proxy to extend
	 * @param extensions
	 * @returns {*}
	 */
	function extendProxy(proxy, extensions) {
		if(!isProxy(proxy)) {
			throw new Error('Cannot extend non-WireProxy');
		}

		return object.extend(proxy, extensions);
	}

	/**
	 * Returns true if it is a WireProxy
	 * @param {*} it
	 * @returns {boolean}
	 */
	function isProxy(it) {
		return it instanceof WireProxy;
	}

	/**
	 * If it is a WireProxy (see isProxy), returns it's target.  Otherwise,
	 * returns it;
	 * @param {*} it
	 * @returns {*}
	 */
	function getTarget(it) {
		return isProxy(it) ? it.target : it;
	}

	/**
	 * Try to clone thing, which can be an object, Array, or Function
	 * @param {object|array|function} thing thing to clone
	 * @param {object} options
	 * @param {boolean} options.deep if true and thing is an Array, try to deep clone its contents
	 * @param {boolean} options.inherited if true and thing is an object, clone inherited and own properties.
	 * @returns {array|object|function} cloned thing
	 */
	function cloneThing (thing, options) {
		var deep, inherited, clone, prop;
		deep = options.deep;
		inherited = options.inherited;

		// Note: this filters out primitive properties and methods
		if (typeof thing != 'object') {
			return thing;
		}
		else if (thing instanceof Date) {
			return new Date(thing.getTime());
		}
		else if (thing instanceof RegExp) {
			return new RegExp(thing);
		}
		else if (Array.isArray(thing)) {
			return deep
				? thing.map(function (i) { return cloneThing(i, options); })
				: thing.slice();
		}
		else {
			clone = thing.constructor ? new thing.constructor() : {};
			for (prop in thing) {
				if (inherited || object.hasOwn(thing, prop)) {
					clone[prop] = deep
						? cloneThing(thing[prop], options)
						: thing[prop];
				}
			}
			return clone;
		}
	}

});
})(typeof define == 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }
);
/** @license MIT License (c) copyright 2011-2013 original author or authors */

/**
 * meld
 * Aspect Oriented Programming for Javascript
 *
 * meld is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author Brian Cavalier
 * @author John Hann
 * @version 1.3.1
 */
(function (define) {
define('meld/meld',[],function () {

	//
	// Public API
	//

	// Add a single, specific type of advice
	// returns a function that will remove the newly-added advice
	meld.before =         adviceApi('before');
	meld.around =         adviceApi('around');
	meld.on =             adviceApi('on');
	meld.afterReturning = adviceApi('afterReturning');
	meld.afterThrowing =  adviceApi('afterThrowing');
	meld.after =          adviceApi('after');

	// Access to the current joinpoint in advices
	meld.joinpoint =      joinpoint;

	// DEPRECATED: meld.add(). Use meld() instead
	// Returns a function that will remove the newly-added aspect
	meld.add =            function() { return meld.apply(null, arguments); };

	/**
	 * Add an aspect to all matching methods of target, or to target itself if
	 * target is a function and no pointcut is provided.
	 * @param {object|function} target
	 * @param {string|array|RegExp|function} [pointcut]
	 * @param {object} aspect
	 * @param {function?} aspect.before
	 * @param {function?} aspect.on
	 * @param {function?} aspect.around
	 * @param {function?} aspect.afterReturning
	 * @param {function?} aspect.afterThrowing
	 * @param {function?} aspect.after
	 * @returns {{ remove: function }|function} if target is an object, returns a
	 *  remover { remove: function } whose remove method will remove the added
	 *  aspect. If target is a function, returns the newly advised function.
	 */
	function meld(target, pointcut, aspect) {
		var pointcutType, remove;

		if(arguments.length < 3) {
			return addAspectToFunction(target, pointcut);
		} else {
			if (isArray(pointcut)) {
				remove = addAspectToAll(target, pointcut, aspect);
			} else {
				pointcutType = typeof pointcut;

				if (pointcutType === 'string') {
					if (typeof target[pointcut] === 'function') {
						remove = addAspectToMethod(target, pointcut, aspect);
					}

				} else if (pointcutType === 'function') {
					remove = addAspectToAll(target, pointcut(target), aspect);

				} else {
					remove = addAspectToMatches(target, pointcut, aspect);
				}
			}

			return remove;
		}

	}

	function Advisor(target, func) {

		var orig, advisor, advised;

		this.target = target;
		this.func = func;
		this.aspects = {};

		orig = this.orig = target[func];
		advisor = this;

		advised = this.advised = function() {
			var context, joinpoint, args, callOrig, afterType;

			// If called as a constructor (i.e. using "new"), create a context
			// of the correct type, so that all advice types (including before!)
			// are called with the correct context.
			if(this instanceof advised) {
				// shamelessly derived from https://github.com/cujojs/wire/blob/c7c55fe50238ecb4afbb35f902058ab6b32beb8f/lib/component.js#L25
				context = objectCreate(orig.prototype);
				callOrig = function (args) {
					return applyConstructor(orig, context, args);
				};

			} else {
				context = this;
				callOrig = function(args) {
					return orig.apply(context, args);
				};

			}

			args = slice.call(arguments);
			afterType = 'afterReturning';

			// Save the previous joinpoint and set the current joinpoint
			joinpoint = pushJoinpoint({
				target: context,
				method: func,
				args: args
			});

			try {
				advisor._callSimpleAdvice('before', context, args);

				try {
					joinpoint.result = advisor._callAroundAdvice(context, func, args, callOrigAndOn);
				} catch(e) {
					joinpoint.result = joinpoint.exception = e;
					// Switch to afterThrowing
					afterType = 'afterThrowing';
				}

				args = [joinpoint.result];

				callAfter(afterType, args);
				callAfter('after', args);

				if(joinpoint.exception) {
					throw joinpoint.exception;
				}

				return joinpoint.result;

			} finally {
				// Restore the previous joinpoint, if necessary.
				popJoinpoint();
			}

			function callOrigAndOn(args) {
				var result = callOrig(args);
				advisor._callSimpleAdvice('on', context, args);

				return result;
			}

			function callAfter(afterType, args) {
				advisor._callSimpleAdvice(afterType, context, args);
			}
		};

		defineProperty(advised, '_advisor', { value: advisor, configurable: true });
	}

	Advisor.prototype = {

		/**
		 * Invoke all advice functions in the supplied context, with the supplied args
		 *
		 * @param adviceType
		 * @param context
		 * @param args
		 */
		_callSimpleAdvice: function(adviceType, context, args) {

			// before advice runs LIFO, from most-recently added to least-recently added.
			// All other advice is FIFO
			var iterator, advices;

			advices = this.aspects[adviceType];
			if(!advices) {
				return;
			}

			iterator = iterators[adviceType];

			iterator(this.aspects[adviceType], function(aspect) {
				var advice = aspect.advice;
				advice && advice.apply(context, args);
			});
		},

		/**
		 * Invoke all around advice and then the original method
		 *
		 * @param context
		 * @param method
		 * @param args
		 * @param applyOriginal
		 */
		_callAroundAdvice: function (context, method, args, applyOriginal) {
			var len, aspects;

			aspects = this.aspects.around;
			len = aspects ? aspects.length : 0;

			/**
			 * Call the next function in the around chain, which will either be another around
			 * advice, or the orig method.
			 * @param i {Number} index of the around advice
			 * @param args {Array} arguments with with to call the next around advice
			 */
			function callNext(i, args) {
				// If we exhausted all aspects, finally call the original
				// Otherwise, if we found another around, call it
				return i < 0
					? applyOriginal(args)
					: callAround(aspects[i].advice, i, args);
			}

			function callAround(around, i, args) {
				var proceedCalled, joinpoint;

				proceedCalled = 0;

				// Joinpoint is immutable
				// TODO: Use Object.freeze once v8 perf problem is fixed
				joinpoint = pushJoinpoint({
					target: context,
					method: method,
					args: args,
					proceed: proceedCall,
					proceedApply: proceedApply,
					proceedCount: proceedCount
				});

				try {
					// Call supplied around advice function
					return around.call(context, joinpoint);
				} finally {
					popJoinpoint();
				}

				/**
				 * The number of times proceed() has been called
				 * @return {Number}
				 */
				function proceedCount() {
					return proceedCalled;
				}

				/**
				 * Proceed to the original method/function or the next around
				 * advice using original arguments or new argument list if
				 * arguments.length > 0
				 * @return {*} result of original method/function or next around advice
				 */
				function proceedCall(/* newArg1, newArg2... */) {
					return proceed(arguments.length > 0 ? slice.call(arguments) : args);
				}

				/**
				 * Proceed to the original method/function or the next around
				 * advice using original arguments or new argument list if
				 * newArgs is supplied
				 * @param [newArgs] {Array} new arguments with which to proceed
				 * @return {*} result of original method/function or next around advice
				 */
				function proceedApply(newArgs) {
					return proceed(newArgs || args);
				}

				/**
				 * Create proceed function that calls the next around advice, or
				 * the original.  May be called multiple times, for example, in retry
				 * scenarios
				 * @param [args] {Array} optional arguments to use instead of the
				 * original arguments
				 */
				function proceed(args) {
					proceedCalled++;
					return callNext(i - 1, args);
				}

			}

			return callNext(len - 1, args);
		},

		/**
		 * Adds the supplied aspect to the advised target method
		 *
		 * @param aspect
		 */
		add: function(aspect) {

			var advisor, aspects;

			advisor = this;
			aspects = advisor.aspects;

			insertAspect(aspects, aspect);

			return {
				remove: function () {
					var remaining = removeAspect(aspects, aspect);

					// If there are no aspects left, restore the original method
					if (!remaining) {
						advisor.remove();
					}
				}
			};
		},

		/**
		 * Removes the Advisor and thus, all aspects from the advised target method, and
		 * restores the original target method, copying back all properties that may have
		 * been added or updated on the advised function.
		 */
		remove: function () {
			delete this.advised._advisor;
			this.target[this.func] = this.orig;
		}
	};

	/**
	 * Returns the advisor for the target object-function pair.  A new advisor
	 * will be created if one does not already exist.
	 * @param target {*} target containing a method with the supplied methodName
	 * @param methodName {String} name of method on target for which to get an advisor
	 * @return {Object|undefined} existing or newly created advisor for the supplied method
	 */
	Advisor.get = function(target, methodName) {
		if(!(methodName in target)) {
			return;
		}

		var advisor, advised;

		advised = target[methodName];

		if(typeof advised !== 'function') {
			throw new Error('Advice can only be applied to functions: ' + methodName);
		}

		advisor = advised._advisor;
		if(!advisor) {
			advisor = new Advisor(target, methodName);
			target[methodName] = advisor.advised;
		}

		return advisor;
	};

	/**
	 * Add an aspect to a pure function, returning an advised version of it.
	 * NOTE: *only the returned function* is advised.  The original (input) function
	 * is not modified in any way.
	 * @param func {Function} function to advise
	 * @param aspect {Object} aspect to add
	 * @return {Function} advised function
	 */
	function addAspectToFunction(func, aspect) {
		var name, placeholderTarget;

		name = func.name || '_';

		placeholderTarget = {};
		placeholderTarget[name] = func;

		addAspectToMethod(placeholderTarget, name, aspect);

		return placeholderTarget[name];

	}

	function addAspectToMethod(target, method, aspect) {
		var advisor = Advisor.get(target, method);

		return advisor && advisor.add(aspect);
	}

	function addAspectToAll(target, methodArray, aspect) {
		var removers, added, f, i;

		removers = [];
		i = 0;

		while((f = methodArray[i++])) {
			added = addAspectToMethod(target, f, aspect);
			added && removers.push(added);
		}

		return createRemover(removers);
	}

	function addAspectToMatches(target, pointcut, aspect) {
		var removers = [];
		// Assume the pointcut is a an object with a .test() method
		for (var p in target) {
			// TODO: Decide whether hasOwnProperty is correct here
			// Only apply to own properties that are functions, and match the pointcut regexp
			if (typeof target[p] == 'function' && pointcut.test(p)) {
				// if(object.hasOwnProperty(p) && typeof object[p] === 'function' && pointcut.test(p)) {
				removers.push(addAspectToMethod(target, p, aspect));
			}
		}

		return createRemover(removers);
	}

	function createRemover(removers) {
		return {
			remove: function() {
				for (var i = removers.length - 1; i >= 0; --i) {
					removers[i].remove();
				}
			}
		};
	}

	// Create an API function for the specified advice type
	function adviceApi(type) {
		return function(target, method, adviceFunc) {
			var aspect = {};

			if(arguments.length === 2) {
				aspect[type] = method;
				return meld(target, aspect);
			} else {
				aspect[type] = adviceFunc;
				return meld(target, method, aspect);
			}
		};
	}

	/**
	 * Insert the supplied aspect into aspectList
	 * @param aspectList {Object} list of aspects, categorized by advice type
	 * @param aspect {Object} aspect containing one or more supported advice types
	 */
	function insertAspect(aspectList, aspect) {
		var adviceType, advice, advices;

		for(adviceType in iterators) {
			advice = aspect[adviceType];

			if(advice) {
				advices = aspectList[adviceType];
				if(!advices) {
					aspectList[adviceType] = advices = [];
				}

				advices.push({
					aspect: aspect,
					advice: advice
				});
			}
		}
	}

	/**
	 * Remove the supplied aspect from aspectList
	 * @param aspectList {Object} list of aspects, categorized by advice type
	 * @param aspect {Object} aspect containing one or more supported advice types
	 * @return {Number} Number of *advices* left on the advised function.  If
	 *  this returns zero, then it is safe to remove the advisor completely.
	 */
	function removeAspect(aspectList, aspect) {
		var adviceType, advices, remaining;

		remaining = 0;

		for(adviceType in iterators) {
			advices = aspectList[adviceType];
			if(advices) {
				remaining += advices.length;

				for (var i = advices.length - 1; i >= 0; --i) {
					if (advices[i].aspect === aspect) {
						advices.splice(i, 1);
						--remaining;
						break;
					}
				}
			}
		}

		return remaining;
	}

	function applyConstructor(C, instance, args) {
		try {
			// Try to define a constructor, but don't care if it fails
			defineProperty(instance, 'constructor', {
				value: C,
				enumerable: false
			});
		} catch(e) {
			// ignore
		}

		C.apply(instance, args);

		return instance;
	}

	var currentJoinpoint, joinpointStack,
		ap, prepend, append, iterators, slice, isArray, defineProperty, objectCreate;

	// TOOD: Freeze joinpoints when v8 perf problems are resolved
//	freeze = Object.freeze || function (o) { return o; };

	joinpointStack = [];

	ap      = Array.prototype;
	prepend = ap.unshift;
	append  = ap.push;
	slice   = ap.slice;

	isArray = Array.isArray || function(it) {
		return Object.prototype.toString.call(it) == '[object Array]';
	};

	// Check for a *working* Object.defineProperty, fallback to
	// simple assignment.
	defineProperty = definePropertyWorks()
		? Object.defineProperty
		: function(obj, prop, descriptor) {
		obj[prop] = descriptor.value;
	};

	objectCreate = Object.create ||
		(function() {
			function F() {}
			return function(proto) {
				F.prototype = proto;
				var instance = new F();
				F.prototype = null;
				return instance;
			};
		}());

	iterators = {
		// Before uses reverse iteration
		before: forEachReverse,
		around: false
	};

	// All other advice types use forward iteration
	// Around is a special case that uses recursion rather than
	// iteration.  See Advisor._callAroundAdvice
	iterators.on
		= iterators.afterReturning
		= iterators.afterThrowing
		= iterators.after
		= forEach;

	function forEach(array, func) {
		for (var i = 0, len = array.length; i < len; i++) {
			func(array[i]);
		}
	}

	function forEachReverse(array, func) {
		for (var i = array.length - 1; i >= 0; --i) {
			func(array[i]);
		}
	}

	function joinpoint() {
		return currentJoinpoint;
	}

	function pushJoinpoint(newJoinpoint) {
		joinpointStack.push(currentJoinpoint);
		return currentJoinpoint = newJoinpoint;
	}

	function popJoinpoint() {
		return currentJoinpoint = joinpointStack.pop();
	}

	function definePropertyWorks() {
		try {
			return 'x' in Object.defineProperty({}, 'x', {});
		} catch (e) { /* return falsey */ }
	}

	return meld;

});
})(typeof define == 'function' && define.amd ? define : function (factory) { module.exports = factory(); }
);

define('meld', ['meld/meld'], function (main) { return main; });

/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */

(function(define) { 'use strict';
define('wire/lib/ObjectProxy',['require','./WireProxy','./object','./advice','meld'],function(require) {

	var WireProxy, extend, before, meld, advise, superDestroy;

	WireProxy = require('./WireProxy');
	extend = require('./object').extend;
	before = require('./advice').before;
	meld = require('meld');

	// FIXME: Remove support for meld.add after deprecation period
	advise = typeof meld === 'function' ? meld : meld.add;

	superDestroy = WireProxy.prototype.destroy;

	function ObjectProxy(target) {
		/*jshint unused:false*/
		WireProxy.apply(this, arguments);
	}

	ObjectProxy.prototype = extend(WireProxy.prototype, {
		/**
		 * Add an aspect to the proxy's target. Sub-types should
		 * override to add aspects in whatever specialized way is
		 * necessary.
		 * @param {String|Array|RegExp|Function} pointcut
		 *  expression matching methods to be advised
		 * @param {Object} aspect aspect to add
		 * @returns {{remove:function}} object with remove() that
		 *  will remove the aspect.
		 */
		advise: function(pointcut, aspect) {
			return advise(this.target, pointcut, aspect);
		}


	});

	return ObjectProxy;

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */

(function(define) { 'use strict';
define('wire/lib/ComponentFactory',['require','when','./object','./WireProxy','./ObjectProxy'],function(require) {

	var when, object, WireProxy, ObjectProxy, undef;

	when = require('when');
	object = require('./object');
	WireProxy = require('./WireProxy');
	ObjectProxy = require('./ObjectProxy');

	function ComponentFactory(lifecycle, plugins, pluginApi) {
		this.plugins = plugins;
		this.pluginApi = pluginApi;
		this.lifecycle = lifecycle;
		this.proxies = [];
	}

	ComponentFactory.prototype = {

		create: function(component) {
			var found;

			// Look for a factory, then use it to create the object
			found = this.getFactory(component.spec);
			return found
				? this._create(component, found.factory, found.options)
				: when.reject(component);
		},

		_create: function(component, factory, options) {
			var instance, self;

			instance = when.defer();
			self = this;

			factory(instance.resolver, options,
				this.pluginApi.contextualize(component.id));

			return instance.promise.then(function(instance) {
				return self.processComponent(component, instance);
			});
		},

		processComponent: function(component, instance) {
			var self, proxy;

			self = this;
			proxy = this.createProxy(instance, component);

			return self.initInstance(proxy).then(
				function(proxy) {
					return self.startupInstance(proxy);
				}
			);
		},

		initInstance: function(proxy) {
			return this.lifecycle.init(proxy);
		},

		startupInstance: function(proxy) {
			return this.lifecycle.startup(proxy);
		},

		createProxy: function(instance, component) {
			var proxy;

			if (WireProxy.isProxy(instance)) {
				proxy = instance;
				instance = WireProxy.getTarget(proxy);
			} else {
				proxy = new ObjectProxy(instance);
			}

			proxy = this.initProxy(proxy);

			if(component) {
				component.proxy = proxy;
				proxy.id = component.id;
				proxy.metadata = component;
			}

			this._registerProxy(proxy);

			return proxy;
		},

		initProxy: function(proxy) {

			var proxiers = this.plugins.proxiers;

			// Allow proxy plugins to process/modify the proxy
			proxy = proxiers.reduce(
				function(proxy, proxier) {
					var overridden = proxier(proxy);
					return WireProxy.isProxy(overridden) ? overridden : proxy;
				},
				proxy
			);

			return proxy;
		},

		destroy: function() {
			var proxies, lifecycle;

			proxies = this.proxies;
			lifecycle = this.lifecycle;

			return shutdownComponents().then(destroyComponents);

			function shutdownComponents() {
				return when.reduce(proxies,
					function(_, proxy) { return lifecycle.shutdown(proxy); },
					undef);
			}

			function destroyComponents() {
				return when.reduce(proxies,
					function(_, proxy) { return proxy.destroy(); },
					undef);
			}
		},

		_registerProxy: function(proxy) {
			if(proxy.metadata) {
				proxy.path = proxy.metadata.path;
				this.proxies.push(proxy);
			}
		},

		getFactory: function(spec) {
			var f, factories, found;

			factories = this.plugins.factories;

			for (f in factories) {
				if (object.hasOwn(spec, f)) {
					found = {
						factory: factories[f],
						options: {
							options: spec[f],
							spec: spec
						}
					};
					break;
				}
			}

			// Intentionally returns undefined if no factory found
			return found;

		}
	};

	return ComponentFactory;

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define){ 'use strict';
define('wire/lib/lifecycle',['require','when'],function(require) {

	var when, safeNonFacetNames;

	when = require('when');
	safeNonFacetNames = {
		id: { value: 1 }
	};

	function Lifecycle(plugins, pluginApi) {
		this._plugins = plugins;
		this._pluginApi = pluginApi;
	}

	Lifecycle.prototype = {
		init: createLifecyclePhase(['create', 'configure', 'initialize']),
		startup: createLifecyclePhase(['connect', 'ready']),
		shutdown: createLifecyclePhase(['destroy'])
	};

	return Lifecycle;

	/**
	 * Generate a method to process all steps in a lifecycle phase
	 * @return {Function}
	 */
	function createLifecyclePhase(steps) {
		steps = generateSteps(steps);

		return function(proxy) {
			var plugins, pluginApi;

			plugins = this._plugins;
			pluginApi = this._pluginApi.contextualize(proxy.id);

			return when.reduce(steps, function (unused, step) {
				return processFacets(step, proxy, pluginApi, plugins);
			}, proxy);
		};
	}

	function processFacets(step, proxy, api, plugins) {
		var promises, metadata, options, name, spec, facets, safeNames, unprocessed;

		promises = [];
		metadata = proxy.metadata;
		spec = metadata.spec;
		facets = plugins.facets;
		safeNames = Object.create(plugins.factories, safeNonFacetNames);
		unprocessed = [];

		for(name in spec) {
			if(name in facets) {
				options = spec[name];
				if (options) {
					processStep(promises, facets[name], step, proxy, options, api);
				}
			} else if (!(name in safeNames)) {
				unprocessed.push(name);
			}
		}

		if(unprocessed.length) {
			return when.reject(unrecognizedFacets(proxy, unprocessed, spec));
		} else {
			return when.all(promises).then(function () {
				return processListeners(step, proxy, api, plugins.listeners);
			}).yield(proxy);
		}
	}

	function processListeners(step, proxy, api, listeners) {
		var listenerPromises = [];

		for (var i = 0; i < listeners.length; i++) {
			processStep(listenerPromises, listeners[i], step, proxy, {}, api);
		}

		return when.all(listenerPromises);
	}

	function processStep(promises, processor, step, proxy, options, api) {
		var facet, pendingFacet;

		if (processor && processor[step]) {
			pendingFacet = when.defer();
			promises.push(pendingFacet.promise);

			facet = Object.create(proxy);
			facet.options = options;
			processor[step](pendingFacet.resolver, facet, api);
		}
	}

	function generateSteps(steps) {
		return steps.reduce(reduceSteps, []);
	}

	function reduceSteps(lifecycle, step) {
		lifecycle.push(step + ':before');
		lifecycle.push(step);
		lifecycle.push(step + ':after');
		return lifecycle;
	}

	function unrecognizedFacets(proxy, unprocessed, spec) {
		return new Error('unrecognized facets in ' + proxy.id + ', maybe you forgot a plugin? ' + unprocessed.join(', ') + '\n' + JSON.stringify(spec));
	}

});
})(typeof define == 'function'
	// AMD
	? define
	// CommonJS
	: function(factory) { module.exports = factory(require); }
);
/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define){ 'use strict';
define('wire/lib/resolver',['require','when','./object'],function(require) {

	var when, object;

	when = require('when');
	object = require('./object');

	/**
	 * Create a reference resolve that uses the supplied plugins and pluginApi
	 * @param {object} config
	 * @param {object} config.plugins plugin registry
	 * @param {object} config.pluginApi plugin Api to provide to resolver plugins
	 *  when resolving references
	 * @constructor
	 */
	function Resolver(resolvers, pluginApi) {
		this._resolvers = resolvers;
		this._pluginApi = pluginApi;
	}

	Resolver.prototype = {

		/**
		 * Determine if it is a reference spec that can be resolved by this resolver
		 * @param {*} it
		 * @return {boolean} true iff it is a reference
		 */
		isRef: function(it) {
			return it && object.hasOwn(it, '$ref');
		},

		/**
		 * Parse it, which must be a reference spec, into a reference object
		 * @param {object|string} it
		 * @param {string?} it.$ref
		 * @return {object} reference object
		 */
		parse: function(it) {
			return this.isRef(it)
				? this.create(it.$ref, it)
				: this.create(it, {});
		},

		/**
		 * Creates a reference object
		 * @param {string} name reference name
		 * @param {object} options
		 * @return {{resolver: String, name: String, options: object, resolve: Function}}
		 */
		create: function(name, options) {
			var self, split, resolver;

			self = this;

			split = name.indexOf('!');
			resolver = name.substring(0, split);
			name = name.substring(split + 1);

			return {
				resolver: resolver,
				name: name,
				options: options,
				resolve: function(fallback, onBehalfOf) {
					return this.resolver
						? self._resolve(resolver, name, options, onBehalfOf)
						: fallback(name, options);
				}
			};
		},

		/**
		 * Do the work of resolving a reference using registered plugins
		 * @param {string} resolverName plugin resolver name (e.g. "dom"), the part before the "!"
		 * @param {string} name reference name, the part after the "!"
		 * @param {object} options additional options to pass thru to a resolver plugin
		 * @param {string|*} onBehalfOf some indication of another component on whose behalf this
		 *  reference is being resolved.  Used to build a reference graph and detect cycles
		 * @return {object} promise for the resolved reference
		 * @private
		 */
		_resolve: function(resolverName, name, options, onBehalfOf) {
			var deferred, resolver, api;

			deferred = when.defer();

			if (resolverName) {
				resolver = this._resolvers[resolverName];

				if (resolver) {
					api = this._pluginApi.contextualize(onBehalfOf);
					resolver(deferred.resolver, name, options||{}, api);
				} else {
					deferred.reject(new Error('No resolver plugin found: ' + resolverName));
				}

			} else {
				deferred.reject(new Error('Cannot resolve ref: ' + name));
			}

			return deferred.promise;
		}
	};

	return Resolver;

});
})(typeof define == 'function'
	// AMD
	? define
	// CommonJS
	: function(factory) { module.exports = factory(require); }
);
/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */

(function(define) { 'use strict';
define('wire/lib/plugin/priority',[],function() {

	var basePriority, defaultPriority;

	basePriority = -99;
	defaultPriority = 0;

	return {
		basePriority: basePriority,
		sortReverse: prioritizeReverse
	};

	function prioritizeReverse(list) {
		return list.sort(byReversePriority);
	}

	function byReversePriority(a, b) {
		var aPriority, bPriority;

		aPriority = a.priority || defaultPriority;
		bPriority = b.priority || defaultPriority;

		return aPriority < bPriority ? -1
			: aPriority > bPriority ? 1 : 0;
	}


});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define){ 'use strict';
define('wire/lib/instantiate',[],function() {

	var undef;

	/**
	 * Creates an object by either invoking ctor as a function and returning the result,
	 * or by calling new ctor().  It uses a simple heuristic to try to guess which approach
	 * is the "right" one.
	 *
	 * @param ctor {Function} function or constructor to invoke
	 * @param args {Array} array of arguments to pass to ctor in either case
	 *
	 * @return The result of invoking ctor with args, with or without new, depending on
	 * the strategy selected.
	 */
	return function instantiate(ctor, args, forceConstructor) {

		var begotten, ctorResult;

		if (forceConstructor || (forceConstructor === undef && isConstructor(ctor))) {
			begotten = Object.create(ctor.prototype);
			defineConstructorIfPossible(begotten, ctor);
			ctorResult = ctor.apply(begotten, args);
			if(ctorResult !== undef) {
				begotten = ctorResult;
			}

		} else {
			begotten = ctor.apply(undef, args);

		}

		return begotten === undef ? null : begotten;
	};

	/**
	 * Carefully sets the instance's constructor property to the supplied
	 * constructor, using Object.defineProperty if available.  If it can't
	 * set the constructor in a safe way, it will do nothing.
	 *
	 * @param instance {Object} component instance
	 * @param ctor {Function} constructor
	 */
	function defineConstructorIfPossible(instance, ctor) {
		try {
			Object.defineProperty(instance, 'constructor', {
				value: ctor,
				enumerable: false
			});
		} catch(e) {
			// If we can't define a constructor, oh well.
			// This can happen if in envs where Object.defineProperty is not
			// available, or when using cujojs/poly or other ES5 shims
		}
	}

	/**
	 * Determines whether the supplied function should be invoked directly or
	 * should be invoked using new in order to create the object to be wired.
	 *
	 * @param func {Function} determine whether this should be called using new or not
	 *
	 * @returns {Boolean} true iff func should be invoked using new, false otherwise.
	 */
	function isConstructor(func) {
		var is = false, p;
		for (p in func.prototype) {
			if (p !== undef) {
				is = true;
				break;
			}
		}

		return is;
	}

});
})(typeof define == 'function'
	// AMD
	? define
	// CommonJS
	: function(factory) {
		module.exports = factory();
	}
);

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * plugins
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 * @author: brian@hovercraftstudios.com
 */
(function(define) {
define('wire/lib/plugin/registry',['require','when','../array','../object','./priority','../instantiate'],function(require) {

	var when, array, object, priority, instantiate, nsKey, nsSeparator;

	when = require('when');
	array = require('../array');
	object = require('../object');
	priority = require('./priority');
	instantiate = require('../instantiate');

	nsKey = '$ns';
	nsSeparator = ':';

	function PluginRegistry() {
		this.plugins = [];
		this._namespaces = {};

		this.contextListeners = [];
		this.listeners = [];
		this.proxiers =  [];
		this.resolvers = {};
		this.factories = {};
		this.facets =    {};
	}

	PluginRegistry.prototype = {
		scanModule: function (module, spec, namespace) {
			var self, pluginFactory;

			pluginFactory = discoverPlugin(module);

			if (!allowPlugin(pluginFactory, this.plugins)) {
				return when.resolve();
			}

			// Add to singleton plugins list to only allow one instance
			// of this plugin in the current context.
			this.plugins.push(pluginFactory);

			// Initialize the plugin for this context
			self = this;
			return when(instantiate(pluginFactory, [spec]),
				function (plugin) {
					plugin && self.registerPlugin(plugin, namespace || getNamespace(spec));
				}
			).yield();
		},

		registerPlugin: function (plugin, namespace) {
			addNamespace(namespace, this._namespaces);

			addPlugin(plugin.resolvers, this.resolvers, namespace);
			addPlugin(plugin.factories, this.factories, namespace);
			addPlugin(plugin.facets, this.facets, namespace);

			this.listeners.push(plugin);
			if(plugin.context) {
				this.contextListeners.push(plugin.context);
			}

			this._registerProxies(plugin.proxies);
		},

		_registerProxies: function (proxiesToAdd) {
			if (!proxiesToAdd) {
				return;
			}

			this.proxiers = priority.sortReverse(array.union(this.proxiers, proxiesToAdd));
		}
	};

	return PluginRegistry;

	function discoverPlugin(module) {
		var plugin;

		// Prefer deprecated legacy wire$plugin format over newer
		// plain function format.
		// TODO: Remove support for wire$plugin
		if(typeof module.wire$plugin === 'function') {
			plugin = module.wire$plugin;
		} else if(typeof module === 'function') {
			plugin = module;
		}

		return plugin;
	}

	function getNamespace(spec) {
		var namespace;
		if(typeof spec === 'object' && nsKey in spec) {
			// A namespace was provided
			namespace = spec[nsKey];
		}

		return namespace;
	}

	function addNamespace(namespace, namespaces) {
		if(namespace && namespace in namespaces) {
			throw new Error('plugin namespace already in use: ' + namespace);
		} else {
			namespaces[namespace] = 1;
		}
	}

	function allowPlugin(plugin, existing) {
		return typeof plugin === 'function' && existing.indexOf(plugin) === -1;
	}

	function addPlugin(src, registry, namespace) {
		var newPluginName, namespacedName;
		for (newPluginName in src) {
			namespacedName = makeNamespace(newPluginName, namespace);
			if (object.hasOwn(registry, namespacedName)) {
				throw new Error('Two plugins for same type in scope: ' + namespacedName);
			}

			registry[namespacedName] = src[newPluginName];
		}
	}

	function makeNamespace(pluginName, namespace) {
		return namespace ? (namespace + nsSeparator + pluginName) : pluginName;
	}
});
}(typeof define === 'function' ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */

(function(define) { 'use strict';
define('wire/lib/specUtils',['require','when','./object'],function(require) {

	var object, when;

	when = require('when');
	object = require('./object');

	function mergeSpecs(moduleLoader, specs) {
		return when(specs, function(specs) {
			return when.resolve(Array.isArray(specs)
				? mergeAll(moduleLoader, specs)
				: (typeof specs === 'string' ? moduleLoader(specs) : specs));
		});
	}

	function mergeAll(moduleLoader, specs) {
		return when.reduce(specs, function(merged, module) {
			return typeof module == 'string'
				? when(moduleLoader(module), function(spec) { return object.mixin(merged, spec); })
				: object.mixin(merged, module);
		}, {});
	}

	return {
		mergeSpecs: mergeSpecs,
		mergeAll: mergeAll
	};
});
})(typeof define == 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }
);
/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * DirectedGraph
 * @author: brian@hovercraftstudios.com
 */
(function(define) {
define('wire/lib/graph/DirectedGraph',[],function() {

	/**
	 * A simple directed graph
	 * @constructor
	 */
	function DirectedGraph() {
		this.vertices = {};
	}

	DirectedGraph.prototype = {
		/**
		 * Add a new edge from one vertex to another
		 * @param {string} from vertex at the tail of the edge
		 * @param {string} to vertex at the head of the edge
		 */
		addEdge: function(from, to) {
			this._getOrCreateVertex(to);
			this._getOrCreateVertex(from).edges[to] = 1;
		},

		/**
		 * Adds and initializes new vertex, or returns an existing vertex
		 * if one with the supplied name already exists
		 * @param {string} name vertex name
		 * @return {object} the new vertex, with an empty edge set
		 * @private
		 */
		_getOrCreateVertex: function(name) {
			var v = this.vertices[name];
			if(!v) {
				v = this.vertices[name] = { name: name, edges: {} };
			}

			return v;
		},

		/**
		 * Removes an edge, if it exits
		 * @param {string} from vertex at the tail of the edge
		 * @param {string} to vertex at the head of the edge
		 */
		removeEdge: function(from, to) {
			var outbound = this.vertices[from];
			if(outbound) {
				delete outbound.edges[to];
			}
		},

		/**
		 * Calls lambda once for each vertex in the graph passing
		 * the vertex as the only param.
		 * @param {function} lambda
		 */
		eachVertex: function(lambda) {
			var vertices, v;

			vertices = this.vertices;
			for(v in vertices) {
				lambda(vertices[v]);
			}
		},

		/**
		 * Calls lambda once for every outbound edge of the supplied vertex
		 * @param {string} vertex vertex name whose edges will be passed to lambda
		 * @param {function} lambda
		 */
		eachEdgeFrom: function(vertex, lambda) {
			var v, e, vertices;

			vertices = this.vertices;
			v = vertices[vertex];

			if(!v) {
				return;
			}

			for(e in v.edges) {
				lambda(v, vertices[e]);
			}
		}
	};

	return DirectedGraph;

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Tarjan directed graph cycle detection
 * @author: brian@hovercraftstudios.com
 */
(function(define) {
define('wire/lib/graph/tarjan',[],function() {

	var undef;

	/**
	 * Tarjan directed graph cycle detection.
	 * See http://en.wikipedia.org/wiki/Tarjan's_strongly_connected_components_algorithm
	 *
	 * WARNING: For efficiency, this adds properties to the vertices in the
	 * graph.  It doesn't really matter for wire's internal purposes.
	 *
	 * @param {DirectedGraph} digraph
	 * @return {Array} each element is a set (Array) of vertices involved
	 * in a cycle.
	 */
	return function tarjan(digraph) {

		var index, stack, scc;

		index = 0;
		stack = [];

		scc = [];

		// Clear out any old cruft that may be hanging around
		// from a previous run.  Maybe should do this afterward?
		digraph.eachVertex(function(v) {
			delete v.index;
			delete v.lowlink;
			delete v.onStack;
		});

		// Start the depth first search
		digraph.eachVertex(function(v) {
			if(v.index === undef) {
				findStronglyConnected(digraph, v);
			}
		});

		// Tarjan algorithm for a single node
		function findStronglyConnected(dg, v) {
			var vertices, vertex;

			v.index = v.lowlink = index;
			index += 1;
			pushStack(stack, v);

			dg.eachEdgeFrom(v.name, function(v, w) {

				if(w.index === undef) {
					// Continue depth first search
					findStronglyConnected(dg, w);
					v.lowlink = Math.min(v.lowlink, w.lowlink);
				} else if(w.onStack) {
					v.lowlink = Math.min(v.lowlink, w.index);
				}

			});

			if(v.lowlink === v.index) {
				vertices = [];
				if(stack.length) {
					do {
						vertex = popStack(stack);
						vertices.push(vertex);
					} while(v !== vertex);
				}

				if(vertices.length) {
					scc.push(vertices);
				}
			}
		}

		return scc;
	};

	/**
	 * Push a vertex on the supplied stack, but also tag the
	 * vertex as being on the stack so we don't have to scan the
	 * stack later in order to tell.
	 * @param {Array} stack
	 * @param {object} vertex
	 */
	function pushStack(stack, vertex) {
		stack.push(vertex);
		vertex.onStack = 1;
	}

	/**
	 * Pop an item off the supplied stack, being sure to un-tag it
	 * @param {Array} stack
	 * @return {object|undefined} vertex
	 */
	function popStack(stack) {
		var v = stack.pop();
		if(v) {
			delete v.onStack;
		}

		return v;
	}

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * formatCycles
 * @author: brian@hovercraftstudios.com
 */
(function(define) {
define('wire/lib/graph/formatCycles',[],function() {
	/**
	 * If there are cycles, format them for output
	 * @param {Array} cycles array of reference resolution cycles
	 * @return {String} formatted string
	 */
	return function formatCycles(cycles) {
		return cycles.map(function (sc) {
			return '[' + sc.map(function (v) {
					return v.name;
				}
			).join(', ') + ']';
		}).join(', ');
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * cyclesTracker
 * @author: brian@hovercraftstudios.com
 * @author: younes.ouadi@gmail.com
 */
(function(define) {
define('wire/lib/graph/cyclesTracker',['require','./tarjan','./formatCycles'],function(require) {

	var findStronglyConnected, formatCycles;

	findStronglyConnected = require('./tarjan');
	formatCycles = require('./formatCycles');

	/**
	 * Make sure that the new name doesn't introduce a cycle.
	 * 
	 * @param {string} name the name being used.
	 * @param {string} onBehalfOf some indication of another name on whose behalf this
	 *  name is being used.  Used to build graph and detect cycles
	 * @return {string} the name being used.
	 */
	function ensureNoCycles(namesGraph, name, onBehalfOf) {
		var stronglyConnected, cycles;

		// add the name to the graph
		onBehalfOf = onBehalfOf||'?';
		namesGraph.addEdge(onBehalfOf, name);

		// compute cycles
		stronglyConnected = findStronglyConnected(namesGraph);
		cycles = stronglyConnected.filter(function(node) {
			// Only consider cycles that:
			// * have more than one node
			// * have one node and that node is not self-referenced
			return node.length > 1 || (node.length === 1 && Object.keys(node[0].edges).indexOf(node[0].name) !== -1);
		});

		// is there a cycle?
		if(cycles.length) {
			// Cycles detected
			throw new Error('Possible circular usage:\n' + formatCycles(cycles));
		}

		return name;
	}

	return {
		ensureNoCycles: ensureNoCycles
	};
});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author brian@hovercraftstudios.com
 */

(function(define) { 'use strict';
define('wire/lib/scope',['require','when','when/sequence','./array','./object','./Map','./loader/adapter','./ComponentFactory','./lifecycle','./resolver','./WireProxy','./plugin/registry','./specUtils','./graph/DirectedGraph','./graph/cyclesTracker'],function(require) {

	var when, defer, sequence, array, object, loader, Map,
		ComponentFactory, Lifecycle, Resolver, WireProxy, PluginRegistry,
		undef, specUtils, DirectedGraph, cyclesTracker;

	when = require('when');
	sequence = require('when/sequence');
	array = require('./array');
	object = require('./object');
	Map = require('./Map');
	loader = require('./loader/adapter');
	ComponentFactory = require('./ComponentFactory');
	Lifecycle = require('./lifecycle');
	Resolver = require('./resolver');
	WireProxy = require('./WireProxy');
	PluginRegistry = require('./plugin/registry');
	specUtils = require('./specUtils');
	DirectedGraph = require('./graph/DirectedGraph');
	cyclesTracker = require('./graph/cyclesTracker');
	
	defer = when.defer;

	function Scope(parent, options) {
		this.parent = parent||{};
		object.mixin(this, options);
	}

	Scope.prototype = {

		init: function(spec) {

			this._inherit(this.parent);
			this._init();
			this._configure();

			return this._startup(spec).yield(this);
		},

		_inherit: function(parent) {

			this._instanceToProxy = new Map();

			this.instances = this._inheritInstances(parent);
			this.components = object.inherit(parent.components);

			this.path = this._createPath(this.name, parent.path);

			this.plugins = parent.plugins;

			this.initializers = array.delegate(this.initializers);
			this.destroyers = array.delegate(this.destroyers);
			this.postDestroy = array.delegate(this.postDestroy);

			if(!this.moduleLoader) {
				this.moduleLoader = parent.moduleLoader;
			}
		},

		_inheritInstances: function(parent) {
			return object.inherit(parent.instances);
		},

		_addDependent: function(dependant, tasks) {
			return dependant.then(
				function(dependant) {
					tasks.push(function() {
						return dependant.destroy();
					});
					return dependant;
				}
			);

		},

		_createNestedScope: function(spec) {
			var options = { createContext: this.createContext };
			return this._addDependent(
				new Scope(this, options).init(spec), this.postDestroy);
		},

		_createChildContext: function(spec, options) {
			// Create child and arrange for it to be destroyed just before
			// this scope is destroyed
			return this._addDependent(
				this.createContext(spec, this, options), this.destroyers);
		},

		_init: function() {
			this._pluginApi = this._initPluginApi();
		},

		_initPluginApi: function() {
			// Plugin API
			// wire() API that is passed to plugins.
			var self, pluginApi;

			self = this;
			pluginApi = {};

			pluginApi.contextualize = function(name) {
				function contextualApi(spec, id) {
					return self._resolveInstance(self._createComponentDef(id, spec));
				}

				contextualApi.createChild = self._createChildContext.bind(self);
				contextualApi.loadModule = self.getModule.bind(self);
				contextualApi.resolver = self.resolver;
				contextualApi.addComponent = addComponent;
				contextualApi.addInstance = addInstance;

				contextualApi.resolveRef = function(ref) {
					var onBehalfOf = arguments.length > 1 ? arguments[2] : name;
					return self._resolveRef(ref, onBehalfOf);
				};

				contextualApi.getProxy = function(nameOrComponent) {
					var onBehalfOf = arguments.length > 1 ? arguments[2] : name;
					return self.getProxy(nameOrComponent, onBehalfOf);
				};

				return contextualApi;
			};

			return pluginApi;

			function addComponent(component, id) {
				var def, instance;

				def = self._createComponentDef(id);
				instance = self.componentFactory.processComponent(def, component);

				return self._makeResolvable(def, instance);
			}

			function addInstance(instance, id) {
				self._makeResolvable(self._createComponentDef(id), instance);
				return when.resolve(instance);
			}
		},

		_configure: function() {
			var plugins, pluginApi;

			plugins = this.plugins;
			pluginApi = this._pluginApi;

			this.resolver = this._createResolver(plugins, pluginApi);
			this.componentFactory = this._createComponentFactory(plugins, pluginApi);

			this._destroy = function() {
				this._destroy = noop;

				return this._executeDestroyers()
					.then(this._destroyComponents.bind(this))
					.then(this._releaseResources.bind(this))
					.then(this._executePostDestroy.bind(this));
			};
		},

		_startup: function(spec) {
			var self = this;

			return this._executeInitializers().then(function() {
				return self._parseSpec(spec).then(function(parsed){
					return self._createComponents(parsed).then(function() {
						return self._awaitInstances(parsed);
					});
				});
			});
		},

		destroy: function() {
			return this._destroy();
		},

		_destroy: noop,

		_destroyComponents: function() {
			var instances = this.instances;

			return this.componentFactory.destroy().then(function() {
				for (var p in instances) {
					delete instances[p];
				}
			});
		},

		_releaseResources: function() {
			// Free Objects
			this.instances = this.components = this.parent
				= this.resolver = this.componentFactory
				= this._instanceToProxy = this._pluginApi = this.plugins
				= undef;
		},

		getModule: function(moduleId) {
			return typeof moduleId == 'string'
				? this.moduleLoader(moduleId)
				: when.resolve(moduleId);
		},

		getProxy: function(nameOrInstance, onBehalfOf) {
			var self = this;

			if(typeof nameOrInstance === 'string') {
				return this._resolveRefName(nameOrInstance, {}, onBehalfOf)
					.then(function (instance) {
						return self._getProxyForInstance(instance);
					});
			} else {
				return self._getProxyForInstance(nameOrInstance);
			}
		},

		_getProxyForInstance: function(instance) {
			var componentFactory = this.componentFactory;

			return getProxyRecursive(this, instance).otherwise(function() {
				// Last ditch, create a new proxy
				return componentFactory.createProxy(instance);
			});
		},

		_createResolver: function(plugins, pluginApi) {
			return new Resolver(plugins.resolvers, pluginApi);
		},

		_createComponentFactory: function(plugins, pluginApi) {
			var self, factory, init, lifecycle;

			self = this;

			lifecycle = new Lifecycle(plugins, pluginApi);
			factory = new ComponentFactory(lifecycle, plugins, pluginApi);

			init = factory.initInstance;
			factory.initInstance = function() {
				return when(init.apply(factory, arguments), function(proxy) {
					return self._makeResolvable(proxy.metadata, proxy);
				});
			};

			return factory;
		},

		_executeInitializers: function() {
			return sequence(this.initializers, this);
		},

		_executeDestroyers: function() {
			return sequence(this.destroyers, this);
		},

		_executePostDestroy: function() {
			return sequence(this.postDestroy, this);
		},

		_parseSpec: function(spec) {
			var self = this;

			// instantiate the imports graph
			var importsGraph = new DirectedGraph();

			return processImports(self, spec, importsGraph).then(function(specImports){
				// modules of importing spec overrides modules of imported spec.
				return processSpec(self, object.mixin(specImports, spec));
			});
		},

		_createComponentDef: function(id, spec, initialized, ready) {
			return {
				id: id,
				spec: spec,
				path: this._createPath(id, this.path),
				initialized: initialized,
				ready: ready
			};
		},

		_createComponents: function(parsed) {
			// Process/create each item in scope and resolve its
			// promise when completed.
			var self, components;

			self = this;
			components = parsed.components;
			return when.map(Object.keys(components), function(name) {
				return self._createScopeItem(components[name]);
			});
		},

		_awaitInstances: function(parsed) {
			var ready = parsed.ready;
			return when.map(Object.keys(ready), function(id) {
				return ready[id];
			});
		},

		_createScopeItem: function(component) {
			// NOTE: Order is important here.
			// The object & local property assignment MUST happen before
			// the chain resolves so that the concrete item is in place.
			// Otherwise, the whole scope can be marked as resolved before
			// the final item has been resolved.
			var self, item;

			self = this;
			item = this._resolveItem(component).then(function (resolved) {
				self._makeResolvable(component, resolved);
				return WireProxy.getTarget(resolved);
			});

			component.ready.resolve(item);
			return item;
		},

		_makeResolvable: function(component, instance) {
			var id, inst;

			id = component.id;
			if(id != null) {
				inst = WireProxy.getTarget(instance);
				this.instances[id] = inst;
				if(component.proxy) {
					this._instanceToProxy.set(inst, component.proxy);
				}
				if(component.initialized) {
					component.initialized.resolve(inst);
				}
			}

			return instance;
		},

		_resolveInstance: function(component) {
			return this._resolveItem(component).then(WireProxy.getTarget);
		},

		_resolveItem: function(component) {
			var item, spec;

			spec = component.spec;

			if (this.resolver.isRef(spec)) {
				// Reference
				item = this._resolveRef(spec, component.id);
			} else {
				// Component
				item = this._createItem(component);
			}

			return item;
		},

		_createItem: function(component) {
			var created, spec;

			spec = component.spec;

			if (Array.isArray(spec)) {
				// Array
				created = this._createArray(component);

			} else if (object.isObject(spec)) {
				// component spec, create the component
				created = this._createComponent(component);

			} else {
				// Plain value
				created = when.resolve(spec);
			}

			return created;
		},

		_createArray: function(component) {
			var self, id, i;

			self = this;
			id = component.id;
			i = 0;

			// Minor optimization, if it's an empty array spec, just return an empty array.
			return when.map(component.spec, function(item) {
				var componentDef = self._createComponentDef(id + '[' + (i++) + ']', item);
				return self._resolveInstance(componentDef);
			});
		},

		_createComponent: function(component) {
			var self = this;

			return this.componentFactory.create(component)
				.otherwise(function (reason) {
					if(reason !== component) {
						throw reason;
					}

					// No factory found, treat object spec as a nested scope
					return self._createNestedScope(component.spec)
						.then(function (childScope) {
							// TODO: find a lighter weight solution
							// We're paying the cost of creating a complete scope,
							// then discarding everything except the instance map.
							return object.mixin({}, childScope.instances);
						}
					);
				}
			);
		},

		_resolveRef: function(ref, onBehalfOf) {
			var scope;

			ref = this.resolver.parse(ref);
			scope = onBehalfOf == ref.name && this.parent.instances ? this.parent : this;

			return this._doResolveRef(ref, scope.instances, onBehalfOf);
		},

		_resolveRefName: function(refName, options, onBehalfOf) {
			var ref = this.resolver.create(refName, options);

			return this._doResolveRef(ref, this.instances, onBehalfOf);
		},

		_doResolveRef: function(ref, scope, onBehalfOf) {
			return ref.resolve(function (name) {
				return resolveDeepName(name, scope);
			}, onBehalfOf);
		},

		_createPath: function(name, basePath) {
			var path = basePath || this.path;
			return (path && name) ? (path + '.' + name) : name;
		}
	};

	return Scope;

	function resolveDeepName(name, scope) {
		var parts = name.split('.');

		return when.reduce(parts, function(scope, segment) {
			return segment in scope
				? scope[segment]
				: when.reject(new Error('Cannot resolve ref: ' + name));
		}, scope);
	}

	function getProxyRecursive(scope, instance) {
		var proxy;

		if(scope._instanceToProxy) {
			proxy = scope._instanceToProxy.get(instance);
		}

		if(!proxy) {
			if(scope.parent) {
				return getProxyRecursive(scope.parent, instance);
			} else {
				return when.reject(new Error('No proxy found'));
			}
		}

		return when.resolve(proxy);
	}

	function noop() {}

	function processImports(scope, spec, importsGraph, importingModuleId) {
		if(!spec || !spec.$imports) {
			return when({});
		}

		if(typeof spec.$imports === 'string') {
			spec.$imports = [spec.$imports];
		}

		importingModuleId = importingModuleId || (typeof spec === 'string' ? spec : undefined);

		return when.reduce(spec.$imports, function(currentSpecImports, importedModuleId){
			// make sure that there is no cycles
			cyclesTracker.ensureNoCycles(importsGraph, importedModuleId, importingModuleId);

			// go ahead with the import
			return when(scope.getModule(importedModuleId), function(importedSpec){
				return processImports(scope, importedSpec, importsGraph, importedModuleId).then(function(importedSpecImports){
					// modules of importing spec overrides modules of imported specs.
					var importedSpecAndItsImports = object.mixin(importedSpecImports, importedSpec);

					// modules in the right overrides modules in the left
					currentSpecImports = object.mixin(currentSpecImports, importedSpecAndItsImports);

					return currentSpecImports;
				});
			});
		}, {});
	}

	function processSpec(scope, spec) {
		var instances, components, ready, plugins, id, initialized;

		instances = scope.instances;
		components = scope.components;
		ready = {};

		// Setup a promise for each item in this scope
		for (id in spec) {
			if(id === '$plugins' || id === 'plugins') {
				plugins = spec[id];
			} else if(!object.hasOwn(instances, id)) {
				// An initializer may have inserted concrete components
				// into the context.  If so, they override components of the
				// same name from the input spec
				initialized = defer();
				ready = defer();
				components[id] = scope._createComponentDef(id, spec[id], initialized, ready);
				instances[id] = initialized.promise;
				ready[id] = ready.promise;
			}
		}

		return when.resolve({
			plugins: plugins,
			components: components,
			instances: instances,
			ready: ready
		});
	}
});
})(typeof define == 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }
);
/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Plugin that allows wire to be used as a plugin within a wire spec
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define) {
define('wire/lib/plugin/wirePlugin',['require','when','../object'],function(require) {

	var when, object;

	when = require('when');
	object = require('../object');

	return function(/* options */) {

		var ready = when.defer();

		return {
			context: {
				ready: function(resolver) {
					ready.resolve();
					resolver.resolve();
				}
			},
			resolvers: {
				wire: wireResolver
			},
			factories: {
				wire: wireFactory
			}
		};

		/**
		 * Factory that creates either a child context, or a *function* that will create
		 * that child context.  In the case that a child is created, this factory returns
		 * a promise that will resolve when the child has completed wiring.
		 *
		 * @param {Object} resolver used to resolve with the created component
		 * @param {Object} componentDef component spec for the component to be created
		 * @param {function} wire scoped wire function
		 */
		function wireFactory(resolver, componentDef, wire) {
			var options, module, provide, defer, waitParent, result;

			options = componentDef.options;

			// Get child spec and options
			if(object.isObject(options) && 'spec' in options) {
				module = options.spec;
				waitParent = options.waitParent;
				defer = options.defer;
				provide = options.provide;
			} else {
				module = options;
			}

			function init(context) {
				var initialized;

				if(provide) {
					initialized = when(wire(provide), function(provides) {
						object.mixin(context.instances, provides);
					});
				}

				return initialized;
			}

			/**
			 * Create a child context of the current context
			 * @param {object?} mixin additional spec to be mixed into
			 *  the child being wired
			 * @returns {Promise} promise for child context
			 */
			function createChild(/** {Object|String}? */ mixin) {
				var spec, config;

				spec = mixin ? [].concat(module, mixin) : module;
				config = { initializers: [init] };

				var child = wire.createChild(spec, config);
				return defer ? child
					: when(child, function(child) {
					return object.hasOwn(child, '$exports') ? child.$exports : child;
				});
			}

			if (defer) {
				// Resolve with the createChild *function* itself
				// which can be used later to wire the spec
				result = createChild;

			} else if(waitParent) {

				var childPromise = when(ready.promise, function() {
					// ensure nothing is passed to createChild here
					return createChild();
				});

				result = wrapChild(childPromise);

			} else {
				result = createChild();
			}

			resolver.resolve(result);
		}
	};

	function wrapChild(promise) {
		return { promise: promise };
	}

	/**
	 * Builtin reference resolver that resolves to the context-specific
	 * wire function.
	 */
	function wireResolver(resolver, _, __, wire) {
		resolver.resolve(wire.createChild);
	}

});
}(typeof define === 'function' ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2011-2013 original author or authors */

/**
 * @author Brian Cavalier
 * @author John Hann
 */

(function (define) { 'use strict';
define('wire/lib/asap',['require','when'],function (require) {

	var when = require('when');

	/**
	 * WARNING: This is not the function you're looking for. You
	 * probably want when().
	 * This function *conditionally* executes onFulfill synchronously
	 * if promiseOrValue is a non-promise, or calls when(promiseOrValue,
	 * onFulfill, onReject) otherwise.
	 * @return {Promise|*} returns a promise if promiseOrValue is
	 *  a promise, or the return value of calling onFulfill
	 *  synchronously otherwise.
	 */
	return function asap(promiseOrValue, onFulfill, onReject) {
		return when.isPromiseLike(promiseOrValue)
			? when(promiseOrValue, onFulfill, onReject)
			: onFulfill(promiseOrValue);
	};

});
})(typeof define == 'function' && define.amd ? define : function(factory) { module.exports = factory(require); });

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * functional
 * Helper library for working with pure functions in wire and wire plugins
 *
 * NOTE: This lib assumes Function.prototype.bind is available
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */
(function (define) { 'use strict';
define('wire/lib/functional',['require','./asap'],function (require) {

	var asap, slice;

	asap = require('./asap');
	slice = [].slice;

	/**
	 * Create a partial function
	 * @param f {Function}
	 * @param [args] {*} additional arguments will be bound to the returned partial
	 * @return {Function}
	 */
	function partial(f, args/*...*/) {
		// Optimization: return f if no args provided
		if(arguments.length == 1) {
			return f;
		}

		args = slice.call(arguments, 1);

		return function() {
			return f.apply(this, args.concat(slice.call(arguments)));
		};
	}

	/**
	 * Promise-aware function composition. If any function in
	 * the composition returns a promise, the entire composition
	 * will be lifted to return a promise.
	 * @param funcs {Array} array of functions to compose
	 * @return {Function} composed function
	 */
	function compose(funcs) {
		var first;

		first = funcs[0];
		funcs = funcs.slice(1);

		return function composed() {
			var context = this;
			return funcs.reduce(function(result, f) {
				return asap(result, function(result) {
					return f.call(context, result);
				});
			}, first.apply(this, arguments));
		};
	}

	return {
		compose: compose,
		partial: partial
	};

});
})(typeof define == 'function'
	// AMD
	? define
	// CommonJS
	: function(factory) { module.exports = factory(require); }
);

/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */

(function(define) { 'use strict';
define('wire/lib/pipeline',['require','when','./functional'],function(require) {

	var when, compose, pipelineSplitRx;

	when = require('when');
	compose = require('./functional').compose;
	pipelineSplitRx = /\s*\|\s*/;

	return function pipeline(proxy, composeString, wire) {

		var bindSpecs, resolveRef, getProxy;

		if(typeof composeString != 'string') {
			return wire(composeString).then(function(func) {
				return createProxyInvoker(proxy, func);
			});
		}

		bindSpecs = composeString.split(pipelineSplitRx);
		resolveRef = wire.resolveRef;
		getProxy = wire.getProxy;

		function createProxyInvoker(proxy, method) {
			return function() {
				return proxy.invoke(method, arguments);
			};
		}

		function createBound(proxy, bindSpec) {
			var target, method;

			target = bindSpec.split('.');

			if(target.length > 2) {
				throw new Error('Only 1 "." is allowed in refs: ' + bindSpec);
			}

			if(target.length > 1) {
				method = target[1];
				target = target[0];
				return when(getProxy(target), function(proxy) {
					return createProxyInvoker(proxy, method);
				});
			} else {
				if(proxy && typeof proxy.get(bindSpec) == 'function') {
					return createProxyInvoker(proxy, bindSpec);
				} else {
					return resolveRef(bindSpec);
				}
			}

		}

		// First, resolve each transform function, stuffing it into an array
		// The result of this reduce will an array of concrete functions
		// Then add the final context[method] to the array of funcs and
		// return the composition.
		return when.reduce(bindSpecs, function(funcs, bindSpec) {
			return when(createBound(proxy, bindSpec), function(func) {
				funcs.push(func);
				return funcs;
			});
		}, []).then(
			function(funcs) {
				var context = proxy && proxy.target;
				return (funcs.length == 1 ? funcs[0] : compose(funcs)).bind(context);
			}
		);
	};

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

(function(define) {
define('wire/lib/invoker',[],function() {

	return function(methodName, args) {
		return function(target) {
			return target[methodName].apply(target, args);
		};
	};

});
})(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(); });
/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Base wire plugin that provides properties, init, and destroy facets, and
 * a proxy for plain JS objects.
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define) { 'use strict';
define('wire/lib/plugin/basePlugin',['require','when','../object','../functional','../pipeline','../instantiate','../invoker'],function(require) {

	var when, object, functional, pipeline, instantiate, createInvoker,
		whenAll, obj, pluginInstance, undef;

	when = require('when');
	object = require('../object');
	functional = require('../functional');
	pipeline = require('../pipeline');
	instantiate = require('../instantiate');
	createInvoker = require('../invoker');

	whenAll = when.all;

	obj = {};

	function asArray(it) {
		return Array.isArray(it) ? it : [it];
	}

	function invoke(func, proxy, args, wire) {
        return when(wire(args, func, proxy.path),
			function (resolvedArgs) {
				return proxy.invoke(func, asArray(resolvedArgs));
			}
		);
	}

	function invokeAll(facet, wire) {
		var options = facet.options;

		if(typeof options == 'string') {
			return invoke(options, facet, [], wire);

		} else {
			var promises, funcName;
			promises = [];

			for(funcName in options) {
				promises.push(invoke(funcName, facet, options[funcName], wire));
			}

			return whenAll(promises);
		}
	}

	//
	// Mixins
	//

	function mixin(target, src) {
		var name, s;

		for(name in src) {
			s = src[name];
			if(!(name in target) || (target[name] !== s && (!(name in obj) || obj[name] !== s))) {
				target[name] = s;
			}
		}

		return target;
	}

	function doMixin(target, introduction, wire) {
		introduction = typeof introduction == 'string'
			? wire.resolveRef(introduction)
			: wire(introduction);

		return when(introduction, mixin.bind(null, target));
	}

	function mixinFacet(resolver, facet, wire) {
		var target, intros;

		target = facet.target;
		intros = facet.options;

		if(!Array.isArray(intros)) {
			intros = [intros];
		}

		resolver.resolve(when.reduce(intros, function(target, intro) {
			return doMixin(target, intro, wire);
		}, target));
	}

    /**
     * Factory that handles cases where you need to create an object literal
     * that has a property whose name would trigger another wire factory.
     * For example, if you need an object literal with a property named "create",
     * which would normally cause wire to try to construct an instance using
     * a constructor or other function, and will probably result in an error,
     * or an unexpected result:
     * myObject: {
     *      create: "foo"
     *    ...
     * }
     *
     * You can use the literal factory to force creation of an object literal:
     * myObject: {
     *    literal: {
     *      create: "foo"
     *    }
     * }
     *
     * which will result in myObject.create == "foo" rather than attempting
     * to create an instance of an AMD module whose id is "foo".
     */
	function literalFactory(resolver, spec /*, wire */) {
		resolver.resolve(spec.options);
	}

	/**
	 * @deprecated Use create (instanceFactory) instead
	 * @param resolver
	 * @param componentDef
	 * @param wire
	 */
	function protoFactory(resolver, componentDef, wire) {
		var parentRef, promise;

        parentRef = componentDef.options;

        promise = typeof parentRef === 'string'
                ? wire.resolveRef(parentRef)
                : wire(parentRef);

		resolver.resolve(promise.then(Object.create));
	}

	function propertiesFacet(resolver, facet, wire) {

		var properties, path, setProperty, propertiesSet;

		properties = facet.options;
		path = facet.path;
		setProperty = facet.set.bind(facet);

		propertiesSet = when.map(Object.keys(facet.options), function(key) {
			return wire(properties[key], facet.path)
				.then(function(wiredProperty) {
					setProperty(key, wiredProperty);
				}
			);
		});

		resolver.resolve(propertiesSet);
	}

	function invokerFactory(resolver, componentDef, wire) {

		var invoker = wire(componentDef.options).then(function (invokerContext) {
			// It'd be nice to use wire.getProxy() then proxy.invoke()
			// here, but that means the invoker must always return
			// a promise.  Not sure that's best, so for now, just
			// call the method directly
			return createInvoker(invokerContext.method, invokerContext.args);
		});

		resolver.resolve(invoker);
	}

	function invokerFacet(resolver, facet, wire) {
		resolver.resolve(invokeAll(facet, wire));
	}

	function cloneFactory(resolver, componentDef, wire) {
		var sourceRef, options, cloned;

		if (wire.resolver.isRef(componentDef.options.source)) {
			sourceRef = componentDef.options.source;
			options = componentDef.options;
		}
		else {
			sourceRef = componentDef.options;
			options = {};
		}

		cloned = wire(sourceRef).then(function (ref) {
			return when(wire.getProxy(ref), function (proxy) {
				if (!proxy.clone) {
					throw new Error('No clone function found for ' + componentDef.id);
				}

				return proxy.clone(options);
			});
		});

		resolver.resolve(cloned);
	}

	function getArgs(create, wire) {
		return create.args ? wire(asArray(create.args)) : [];
	}

	function moduleFactory(resolver, componentDef, wire) {
		resolver.resolve(wire.loadModule(componentDef.options));
	}

	/**
	 * Factory that uses an AMD module either directly, or as a
	 * constructor or plain function to create the resulting item.
	 *
	 * @param {Object} resolver resolver to resolve with the created component
	 * @param {Object} componentDef portion of the spec for the component to be created
	 * @param {function} wire
	 */
	function instanceFactory(resolver, componentDef, wire) {
		var create, args, isConstructor, module, instance;

		create = componentDef.options;

		if (typeof create == 'string') {
			module = wire.loadModule(create);
		} else if(wire.resolver.isRef(create)) {
			module = wire(create);
			args = getArgs(create, wire);
		} else if(object.isObject(create) && create.module) {
			module = wire.resolver.isRef(create.module)
				? wire(create.module)
				: wire.loadModule(create.module);
			args = getArgs(create, wire);
			isConstructor = create.isConstructor;
		} else {
			module = create;
		}

		instance = when.join(module, args).spread(createInstance);

		resolver.resolve(instance);

		// Load the module, and use it to create the object
		function createInstance(module, args) {
			// We'll either use the module directly, or we need
			// to instantiate/invoke it.
			return typeof module == 'function'
				? instantiate(module, args, isConstructor)
				: Object.create(module);
		}
	}

	function composeFactory(resolver, componentDef, wire) {
		var options, promise;

		options = componentDef.options;

		if(typeof options == 'string') {
			promise = pipeline(undef, options, wire);
		} else {
			// Assume it's an array of things that will wire to functions
			promise = when(wire(options), function(funcArray) {
				return functional.compose(funcArray);
			});
		}

		resolver.resolve(promise);
	}

	pluginInstance = {
		factories: {
			module: moduleFactory,
			create: instanceFactory,
			literal: literalFactory,
			prototype: protoFactory,
			clone: cloneFactory,
			compose: composeFactory,
			invoker: invokerFactory
		},
		facets: {
			// properties facet.  Sets properties on components
			// after creation.
			properties: {
				configure: propertiesFacet
			},
			mixin: {
				configure: mixinFacet
			},
			// init facet.  Invokes methods on components during
			// the "init" stage.
			init: {
				initialize: invokerFacet
			},
			// ready facet.  Invokes methods on components during
			// the "ready" stage.
			ready: {
				ready: invokerFacet
			},
			// destroy facet.  Registers methods to be invoked
			// on components when the enclosing context is destroyed
			destroy: {
				destroy: invokerFacet
			}
		}
	};

	// "introduce" is deprecated, but preserved here for now.
	pluginInstance.facets.introduce = pluginInstance.facets.mixin;

	return function(/* options */) {
		return pluginInstance;
	};
});
})(typeof define == 'function'
	? define
	: function(factory) { module.exports = factory(require); }
);

/**
 * defaultPlugins
 * @author: brian
 */
(function(define) {
define('wire/lib/plugin/defaultPlugins',['require','./wirePlugin','./basePlugin'],function(require) {

	return [
		require('./wirePlugin'),
		require('./basePlugin')
	];

});
}(typeof define === 'function' ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2011-2013 original author or authors */

/**
 * timeout.js
 *
 * Helper that returns a promise that rejects after a specified timeout,
 * if not explicitly resolved or rejected before that.
 *
 * @author Brian Cavalier
 * @author John Hann
 */

(function(define) {
define('when/timeout',['require','./when'],function(require) {

	var when = require('./when');

    /**
	 * @deprecated Use when(trigger).timeout(ms)
     */
    return function timeout(msec, trigger) {
		return when(trigger).timeout(msec);
    };
});
})(typeof define === 'function' && define.amd ? define : function (factory) { module.exports = factory(require); });



/**
 * trackInflightRefs
 * @author: brian@hovercraftstudios.com
 */
(function(define) {
define('wire/lib/graph/trackInflightRefs',['require','when/timeout','./tarjan','./formatCycles'],function(require) {

	var timeout, findStronglyConnected, formatCycles, refCycleCheckTimeout;

	timeout = require('when/timeout');
	findStronglyConnected = require('./tarjan');
	formatCycles = require('./formatCycles');

	refCycleCheckTimeout = 5000;

	/**
	 * Advice to track inflight refs using a directed graph
	 * @param {DirectedGraph} graph
	 * @param {Resolver} resolver
	 * @param {number} cycleTimeout how long to wait for any one reference to resolve
	 *  before performing cycle detection. This basically debounces cycle detection
	 */
	return function trackInflightRefs(graph, resolver, cycleTimeout) {
		var create = resolver.create;

		if(typeof cycleTimeout != 'number') {
			cycleTimeout = refCycleCheckTimeout;
		}

		resolver.create = function() {
			var ref, resolve;

			ref = create.apply(resolver, arguments);

			resolve = ref.resolve;
			ref.resolve = function() {
				var inflight = resolve.apply(ref, arguments);
				return trackInflightRef(graph, cycleTimeout, inflight, ref.name, arguments[1]);
			};

			return ref;
		};

		return resolver;
	};


	/**
	 * Add this reference to the reference graph, and setup a timeout that will fire if the refPromise
	 * has not resolved in a reasonable amount.  If the timeout fires, check the current graph for cycles
	 * and fail wiring if we find any.
	 * @param {DirectedGraph} refGraph graph to use to track cycles
	 * @param {number} cycleTimeout how long to wait for any one reference to resolve
	 *  before performing cycle detection. This basically debounces cycle detection
	 * @param {object} refPromise promise for reference resolution
	 * @param {string} refName reference being resolved
	 * @param {string} onBehalfOf some indication of another component on whose behalf this
	 *  reference is being resolved.  Used to build a reference graph and detect cycles
	 * @return {object} promise equivalent to refPromise but that may be rejected if cycles are detected
	 */
	function trackInflightRef(refGraph, cycleTimeout, refPromise, refName, onBehalfOf) {

		onBehalfOf = onBehalfOf||'?';
		refGraph.addEdge(onBehalfOf, refName);

		return timeout(cycleTimeout, refPromise).then(
			function(resolved) {
				refGraph.removeEdge(onBehalfOf, refName);
				return resolved;
			},
			function() {
				var stronglyConnected, cycles;

				stronglyConnected = findStronglyConnected(refGraph);
				cycles = stronglyConnected.filter(function(node) {
					return node.length > 1;
				});

				if(cycles.length) {
					// Cycles detected
					throw new Error('Possible circular refs:\n'
						+ formatCycles(cycles));
				}

				return refPromise;
			}
		);
	}

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

(function(define){ 'use strict';
define('wire/lib/Container',['require','when','./advice','./object','./WireContext','./scope','./plugin/registry','./plugin/defaultPlugins','./graph/DirectedGraph','./graph/trackInflightRefs'],function(require) {

	var when, advice, object, WireContext, Scope,
		PluginRegistry, defaultPlugins,
		DirectedGraph, trackInflightRefs, slice, scopeProto, undef;

	when = require('when');
	advice = require('./advice');
	object = require('./object');
	WireContext = require('./WireContext');
	Scope = require('./scope');
	PluginRegistry = require('./plugin/registry');
	defaultPlugins = require('./plugin/defaultPlugins');
	DirectedGraph = require('./graph/DirectedGraph');
	trackInflightRefs = require('./graph/trackInflightRefs');
	slice = Array.prototype.slice;

	scopeProto = Scope.prototype;

	function Container() {
		Scope.apply(this, arguments);
	}

	/**
	 * Container inherits from Scope, adding plugin support and
	 * context level events.
	 */
	Container.prototype = object.extend(scopeProto, {
		_inheritInstances: function(parent) {
			var publicApi = {
				wire: this._createChildContext.bind(this),
				destroy: this.destroy.bind(this),
				resolve: this._resolveRef.bind(this)
			};

			return WireContext.inherit(parent.instances, publicApi);
		},

		_init: advice.after(
			scopeProto._init,
			function() {
				this.plugins = new PluginRegistry();
				return this._installDefaultPlugins();
			}
		),

		_startup: advice.after(
			scopeProto._startup,
			function(started) {
				var self = this;
				return when.resolve(started).otherwise(function(e) {
					return self._contextEvent('error', e).yield(started);
				});
			}
		),

		_installDefaultPlugins: function() {
			return this._installPlugins(defaultPlugins);
		},

		_installPlugins: function(plugins) {
			if(!plugins) {
				return when.resolve();
			}

			var self, registry, installed;

			self = this;
			registry = this.plugins;

			if(Array.isArray(plugins)) {
				installed = plugins.map(function(plugin) {
					return installPlugin(plugin);
				});
			} else {
				installed = Object.keys(plugins).map(function(namespace) {
					return installPlugin(plugins[namespace], namespace);
				});
			}

			return when.all(installed);

			function installPlugin(pluginSpec, namespace) {
				var module, t;

				t = typeof pluginSpec;
				if(t == 'string') {
					module = pluginSpec;
					pluginSpec = {};
				} else if(typeof pluginSpec.module == 'string') {
					module = pluginSpec.module;
				} else {
					module = pluginSpec;
				}

				return self.getModule(module).then(function(plugin) {
					return registry.scanModule(plugin, pluginSpec, namespace);
				});
			}
		},

		_createResolver: advice.after(
			scopeProto._createResolver,
			function(resolver) {
				return trackInflightRefs(
					new DirectedGraph(), resolver, this.refCycleTimeout);
			}
		),

		_contextEvent: function (type, data) {
			var api, listeners;

			if(!this.contextEventApi) {
				this.contextEventApi = this._pluginApi.contextualize(this.path);
			}

			api = this.contextEventApi;
			listeners = this.plugins.contextListeners;

			return when.reduce(listeners, function(undef, listener) {
				var d;

				if(listener[type]) {
					d = when.defer();
					listener[type](d.resolver, api, data);
					return d.promise;
				}

				return undef;
			}, undef);
		},

		_createComponents: advice.beforeAsync(
			scopeProto._createComponents,
			function(parsed) {
				var self = this;
				return this._installPlugins(parsed.plugins)
					.then(function() {
						return self._contextEvent('initialize');
					});
			}
		),

		_awaitInstances: advice.afterAsync(
			scopeProto._awaitInstances,
			function() {
				return this._contextEvent('ready');
			}
		),

		_destroyComponents: advice.beforeAsync(
			scopeProto._destroyComponents,
			function() {
				return this._contextEvent('shutdown');
			}
		),

		_releaseResources: advice.beforeAsync(
			scopeProto._releaseResources,
			function() {
				return this._contextEvent('destroy');
			}
		)
	});

	return Container;

});
}(typeof define === 'function' ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2010-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author: Brian Cavalier
 * @author: John Hann
 */
(function(define){ 'use strict';
define('wire/lib/context',['require','when','./object','./loader/adapter','./loader/relative','./Container','./specUtils'],function(require) {

	var when, mixin, loaderAdapter, relativeLoader, Container, specUtils;

	when = require('when');
	mixin = require('./object').mixin;
	loaderAdapter = require('./loader/adapter');
	relativeLoader = require('./loader/relative');
	Container = require('./Container');
	specUtils = require('./specUtils');

	/**
	 * Creates a new context from the supplied specs, with the supplied
	 * parent context. If specs is an {Array}, it may be a mixed array
	 * of string module ids, and object literal specs.  All spec module
	 * ids will be loaded, and then all specs will be merged from
	 * left-to-right (rightmost wins), and the resulting, merged spec will
	 * be wired.
	 * @private
	 *
	 * @param {String|Object|String[]|Object[]} specs
	 * @param {Object} parent context
	 * @param {Object} [options]
	 *
	 * @return {Promise} a promise for the new context
	 */
	return function createContext(specs, parent, options) {
		// Do the actual wiring after all specs have been loaded

		if(!options) { options = {}; }
		if(!parent)  { parent  = {}; }

		options.createContext = createContext;

		var specLoader = createSpecLoader(parent.moduleLoader, options.require);

		return when(specs, function(specs) {
			options.moduleLoader =
				createContextLoader(specLoader, findBaseId(specs));

			return specUtils.mergeSpecs(specLoader, specs).then(function(spec) {

				var container = new Container(parent, options);

				// Expose only the component instances and controlled API
				return container.init(spec).then(function(context) {
					return context.instances;
				});
			});
		});
	};

	function createContextLoader(parentLoader, baseId) {
		return baseId ? relativeLoader(parentLoader, baseId) : parentLoader;
	}

	/**
	 * Create a module loader
	 * @param {function} [platformLoader] platform require function with which
	 *  to configure the module loader
	 * @param {function} [parentLoader] existing module loader from which
	 *  the new module loader will inherit, if provided.
	 * @return {Object} module loader with load() and merge() methods
	 */
	function createSpecLoader(parentLoader, platformLoader) {
		var loadModule = typeof platformLoader == 'function'
			? loaderAdapter(platformLoader)
			: parentLoader || loaderAdapter(require);

		return loadModule;
	}

	function findBaseId(specs) {
		var firstId;

		if(typeof specs === 'string') {
			return specs;
		}

		if(!Array.isArray(specs)) {
			return;
		}

		specs.some(function(spec) {
			if(typeof spec === 'string') {
				firstId = spec;
				return true;
			}
		});

		return firstId;
	}
});
}(typeof define === 'function' ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright 2011-2013 original author or authors */

/**
 * wire
 * Javascript IOC Container
 *
 * wire is part of the cujoJS family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author Brian Cavalier
 * @author John Hann
 * @version 0.10.11
 */
(function(rootSpec, define){ 'use strict';
define('wire/wire',['require','./lib/context'],function(require) {

	var createContext, rootContext, rootOptions;

	wire.version = '0.10.11';

	createContext = require('./lib/context');

	rootOptions = { require: require };

	/**
	 * Main Programmtic API.  The top-level wire function that wires contexts
	 * as direct children of the (possibly implicit) root context.  It ensures
	 * that the root context has been wired before wiring children.
	 *
	 * @public
	 *
	 * @param spec {Object|String|Array|Promise} can be any one of the following:
	 *  1. Object - wiring spec
	 *  2. String - module id of the wiring spec to load and then wire
	 *  3. Array - mixed array of Strings and Objects, each of which is either
	 *   a wiring spec, or the module id of a wiring spec
	 *  4. Promise - a promise for any of the above
	 *  @param options {Object} wiring options
	 *  @param [options.require] {Function} the platform loader function.  Wire will
	 *   attempt to automatically detect what loader to use (AMD, CommonJS, etc.), but
	 *   if you want to explicitly provide it, you can do so.  In some cases this can
	 *   be useful such as providing a local AMD require function so that module ids
	 *   *within the wiring spec* can be relative.
	 *  @return {Promise} a promise for the resulting wired context
	 */
	function wire(spec, options) {

		// If the root context is not yet wired, wire it first
		if (!rootContext) {
			rootContext = createContext(rootSpec, null, rootOptions);
		}

		// Use the rootContext to wire all new contexts.
		return rootContext.then(function (root) {
			return root.wire(spec, options);
		});
	}

	/**
	 * AMD Loader plugin API
	 * @param name {String} spec module id, or comma-separated list of module ids
	 * @param require {Function} loader-provided local require function
	 * @param done {Function} loader-provided callback to call when wiring
	 *  is completed. May have and error property that a function to call to
	 *  inform the AMD loader of an error.
	 *  See here:
	 *  https://groups.google.com/forum/?fromgroups#!topic/amd-implement/u0f161drdJA
	 */
	wire.load = function amdLoad(name, require, done /*, config */) {
		// If it's a string, try to split on ',' since it could be a comma-separated
		// list of spec module ids
		wire(name.split(','), { require: require })
			.then(done, done.error)
			.otherwise(crash);

		function crash(e) {
			// Throw uncatchable exception for loaders that don't support
			// AMD error handling.  This will propagate up to the host environment
			setTimeout(function() { throw e; }, 0);
		}
	};

	/**
	 * AMD Builder plugin API
	 */
	// pluginBuilder: './builder/rjs'
	wire['pluginBuilder'] = './builder/rjs';
	wire['cramPlugin'] = './builder/cram';

	return wire;

});
})(
	this['wire'] || {},
	typeof define == 'function' && define.amd
		? define : function(factory) { module.exports = factory(require); }
);

define('wire', ['wire/wire'], function (main) { return main; });

// Generated by CoffeeScript 1.9.2
define('src/js/spec',{
  $plugins: [
    {
      module: 'wire/debug',
      trace: true
    }, 'wire/on', 'wire/dom', 'wire/dom/render'
  ],
  mainView: {
    render: {
      template: '<h1>Helllo</h1>'
    },
    insert: {
      first: {
        $ref: 'dom.first!body'
      }
    }
  },
  navigation: {
    wire: {
      spec: "/src/js/components/spec"
    }
  }
});

/** @license MIT License (c) copyright B Cavalier & J Hann */

/*jshint sub:true*/
/*global Node:true*/

/**
 * debug
 * wire plugin that logs timing and debug information about wiring context and object
 * lifecycle events (e.g. creation, properties set, initialized, etc.).
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * Usage:
 * {
 *     module: 'wire/debug',
 *
 *     // verbose (Optional)
 *     // If set to true, even more (a LOT) info will be output.
 *     // Default is false if not specified.
 *     verbose: false,
 *
 *     // timeout (Optional)
 *     // Milliseconds to wait for wiring to finish before reporting
 *     // failed components.  There may be failures caused by 3rd party
 *     // wire plugins and components that wire.js cannot detect.  This
 *     // provides a last ditch way to try to report those failures.
 *     // Default is 5000ms (5 seconds)
 *     timeout: 5000,
 *
 *     // filter (Optional)
 *     // String or RegExp to match against a component's name.  Only
 *     // components whose path matches will be reported in the debug
 *     // diagnostic output.
 *     // All components will still be tracked for failures.
 *     // This can be useful in reducing the amount of diagnostic output and
 *     // focusing it on specific components.
 *     // Defaults to matching all components
 *     // Examples:
 *     //   filter: ".*View"
 *     //   filter: /.*View/
 *     //   filter: "[fF]oo[bB]ar"
 *     filter: ".*"
 *
 *     // trace (Optional)
 *     // Enables application component tracing that will log information about component
 *     // method calls while your application runs.  This provides a powerful way to watch
 *     // and debug your application as it runs.
 *     // To enable full tracing, which is a LOT of information:
 *     trace: true
 *     // Or, specify options to enable more focused tracing:
 *     trace: {
 *          // filter (Optional)
 *          // Similar to above, can be string pattern or RegExp
 *          // If not specified, the general debug filter is used (see above)
 *          filter: ".*View",
 *
 *          // pointcut (Optional)
 *          // Matches *method names*.  Can be used with or without specifying filter
 *          // When filter is not specified, this will match methods across all components.
 *          // For example, if all your components name their event emitters "on<Event>", e.g. "onClick"
 *          // you could trace all your event emitters:
 *          // Default: "^[^_]" (all methods not starting with '_')
 *          pointcut: "on.*",
 *
 *          // step (Optional)
 *          // At what step in the wiring process should tracing start.  This can be helpful
 *          // if you need to trace a component during wiring.
 *          // Values: 'create', 'configure', 'initialize', 'ready', 'destroy'
 *          // NOTE: This defines when tracing *begins*.  For example, if this is set to
 *          // 'configure' (the default), anything that happens to components during and
 *          // after the configure step, until that component is destroyed, will be traced.
 *          // Default: 'configure'
 *          step: 'configure'
 *     }
 * }
 */
(function(global, define) {
define('wire/debug',['require','meld'],function(require) {
	var meld, timer, defaultTimeout, logger, createTracer, ownProp;

	meld = require('meld');

	function noop() {}

	ownProp = Object.prototype.hasOwnProperty.call.bind(Object.prototype.hasOwnProperty);

	// Setup console for node, sane browsers, or IE
	logger = typeof console != 'undefined'
		? console
		: global['console'] || { log:noop, error:noop };

	// TODO: Consider using stacktrace.js
	// https://github.com/eriwen/javascript-stacktrace
	// For now, quick and dirty, based on how stacktrace.js chooses the appropriate field
	// and log using console.error
	function logStack(e) {
		var stack = e.stack || e.stacktrace;
		if(!stack) {
			// If e.sourceURL and e.line are available, this is probably Safari, so
			// we can build a clickable source:line
			// Fallback to message if available
			// If all else fails, just use e itself
			stack = e.sourceURL && e.line
				? e.sourceURL + ':' + e.line
				: e.message || e;
		}

		logger.error(stack);
	}

	timer = createTimer();

	// If we don't see any wiring progress in this amount of time
	// since the last time we saw something happen, then we'll log
	// an error.
	defaultTimeout = 5000;

	/**
	 * Builds a string with timing info and a message for debug output
	 *
	 * @param text {String} message
	 * @param contextTimer per-context timer information
	 *
	 * @returns A formatted string for output
	 */
	function time(text, contextTimer) {
		var all, timing;

		all = timer();
		timing = "(total: " +
				 (contextTimer
					 ? all.total + "ms, context: " + contextTimer()
					 : all)
			+ "): ";

		return "DEBUG " + timing + text;
	}

	/**
	 * Creates a timer function that, when called, returns an object containing
	 * the total elapsed time since the timer was created, and the split time
	 * since the last time the timer was called.  All times in milliseconds
	 *
	 * @returns timer
	 */
	function createTimer() {
		var start, split;

		start = new Date().getTime();
		split = start;

		/**
		 * Returns the total elapsed time since this timer was created, and the
		 * split time since this getTime was last called.
		 *
		 * @returns Object containing total and split times in milliseconds, plus a
		 * toString() function that is useful in logging the time.
		 */
		return function getTime() {
			var now, total, splitTime;

			now = new Date().getTime();
			total = now - start;
			splitTime = now - split;
			split = now;

			return {
				total:total,
				split:splitTime,
				toString:function () {
					return '' + splitTime + 'ms / ' + total + 'ms';
				}
			};
		};
	}

	function defaultFilter(path) {
		return !!path;
	}

	function createPathFilter(filter) {
		if (!filter) {
			return defaultFilter;
		}

		var rx = filter.test ? filter : new RegExp(filter);

		return function (path) {
			return rx.test(path);
		};

	}

	/**
	 * Returns true if it is a Node
	 * Adapted from: http://stackoverflow.com/questions/384286/javascript-isdom-how-do-you-check-if-a-javascript-object-is-a-dom-object
	 * @param it anything
	 * @return true iff it is a Node
	 */
	function isNode(it) {
		return typeof Node === "object"
			? it instanceof Node
			: it && typeof it === "object" && typeof it.nodeType === "number" && typeof it.nodeName==="string";
	}

	function isObject(it) {
		// In IE7 tos.call(null) is '[object Object]'
		// so we need to check to see if 'it' is
		// even set
		return it && Object.prototype.toString.call(it) == '[object Object]';
	}

	/**
	 * Function that applies tracing AOP to components being wired
	 * @function
	 * @param options {Object} tracing options
	 * @param plugin {Object} debug plugin instance to which to add tracing functionality
	 */
	createTracer = (function() {
		var depth, padding, defaultStep, defaultPointcut;

		/** Current trace depth */
		depth = 0;

		/** Padding character for indenting traces */
		padding =  '.';

		/** 2^8 padding = 128 */
		for(var i=0; i<8; i++) {
			padding += padding;
		}

		/** Default lifecycle step at which to begin tracing */
		defaultStep = 'configure';

		/** Default pointcut query to match methods that will be traced */
		defaultPointcut = /^[^_]/;

		function logAfter(context, tag, start, val) {
			console.log(context + tag + (new Date().getTime() - start.getTime()) + 'ms): ', val);
		}

		/**
		 * Creates an aspect to be applied to components that are being traced
		 * @param path {String} component path
		 */
		function createTraceAspect(path) {
			return {
				around:function (joinpoint) {
					var val, context, start, indent;

					// Setup current indent level
					indent = padding.substr(0, depth);
					// Form full path to invoked method
					context = indent + 'DEBUG: ' + path + '.' + joinpoint.method;

					// Increase the depth before proceeding so that nested traces will be indented
					++depth;

					logger.log(context, joinpoint.args);

					try {
						start = new Date();
						val = joinpoint.proceed();

						logAfter(context, ' RETURN (', start, val);

						// return result
						return val;

					} catch (e) {

						// rethrow
						logAfter(context, ' THROW (', start, e ? e.toString() : e);

						throw e;

					} finally {
						// And now decrease the depth after
						--depth;
					}
				}
			};
		}

		/**
		 * Implementation of createTracer
		 */
		return function(options, plugin, filter) {
			var trace, untrace, traceStep, traceFilter, tracePointcut, traceAspects;

			traceFilter = options.trace.filter ? createPathFilter(options.trace.filter) : filter;
			tracePointcut = options.trace.pointcut || defaultPointcut;
			traceStep = options.trace.step || defaultStep;

			function isTraceable(target, prop) {
				return isObject(target) && typeof target[prop] === 'function'
					&& prop !== 'wire$plugin'
					&& tracePointcut.test(prop);
			}

			/**
			 * Trace pointcut query function that filters out wire plugins
			 * @param target {Object} target object to query for methods to advise
			 */
			function pointcut(target) {
				var matches = [];

				if(isNode(target)) {
					return matches;
				}

				for (var p in target) {
					// Only match functions, exclude wire plugins, and then apply
					// the supplied tracePointcut regexp
					if (isTraceable(target, p)) {
						matches.push(p);
					}
				}

				return matches;
			}

			traceAspects = [];
			trace = function (path, target) {
				if (traceFilter(path)) {
					// Create the aspect, if the path matched
					traceAspects.push(meld.add(target, pointcut, createTraceAspect(path)));
				}
				// trace intentionally does not resolve the promise
				// trace relies on the existing plugin method to resolve it
			};

			untrace = function () {
				for (var i = traceAspects.length-1; i >= 0; --i) {
					traceAspects[i].remove();
				}
			};

			// Defend against changes to the plugin in future revs
			var orig = plugin[traceStep] || function (promise) { promise.resolve(); };

			// Replace the plugin listener method with one that will call trace()
			// and add traceAspect
			plugin[traceStep] = function (promise, proxy, wire) {
				trace(proxy.path, proxy.target);
				orig(promise, proxy, wire);
			};

			return { trace: trace, untrace: untrace };
		};

	})();

	function logSeparator() {
		logger.log('---------------------------------------------------');
	}

	return function wireDebug(options) {

		var contextTimer, timeout, paths, count, tag,
			logCreated, logDestroyed, checkPathsTimeout,
			verbose, filter, plugin, context, tracer;

		verbose = options.verbose;
		contextTimer = createTimer();

		count = 0;
		tag = "WIRING";

		tracer = { trace: noop, untrace: noop };

		filter = createPathFilter(options.filter);

		function contextTime(msg) {
			return time(msg, contextTimer);
		}

		logger.log(contextTime("Context debug"));

		context = {
			initialize: function(resolver) {
				logger.log(contextTime("Context init"));
				resolver.resolve();
			},
			ready: function(resolver) {
				cancelPathsTimeout();
				logger.log(contextTime("Context ready"));
				resolver.resolve();
			},
			destroy: function(resolver) {
				tracer.untrace();
				logger.log(contextTime("Context destroyed"));
				resolver.resolve();
			},
			error: function(resolver, api, err) {
				cancelPathsTimeout();
				console.error(contextTime("Context ERROR: ") + err, err);
				logStack(err);
				resolver.reject(err);
			}
		};

		function makeListener(step, verbose) {
			return function (promise, proxy /*, wire */) {
				cancelPathsTimeout();

				var path = proxy.path;

				if (paths[path]) {
					paths[path].status = step;
				}

				if (verbose && filter(path)) {
					var message = time(step + ' ' + (path || proxy.id || ''), contextTimer);
					if (proxy.target) {
						logger.log(message, proxy.target, proxy.metadata);
					} else {
						logger.log(message, proxy);
					}
				}

				if(count) {
					checkPathsTimeout = setTimeout(checkPaths, timeout);
				}

				promise.resolve();
			};
		}

		paths = {};
		timeout = options.timeout || defaultTimeout;
		logCreated = makeListener('created', verbose);
		logDestroyed = makeListener('destroyed', true);

		function cancelPathsTimeout() {
			clearTimeout(checkPathsTimeout);
			checkPathsTimeout = null;
		}

		function checkPaths() {
			if (!checkPathsTimeout) {
				return;
			}

			var p, component, msg, ready, notReady;

			logSeparator();
			if(count) {
				ready = [];
				notReady = [];
				logger.error(tag + ': No progress in ' + timeout + 'ms, status:');

				for (p in paths) {
					component = paths[p];
					msg = p + ': ' + component.status;

					(component.status == 'ready' ? ready : notReady).push(
						{ msg: msg, metadata: component.metadata }
					);
				}

				if(notReady.length > 0) {
					logSeparator();
					logger.log('Components that DID NOT finish wiring');
					for(p = notReady.length-1; p >= 0; --p) {
						component = notReady[p];
						logger.error(component.msg, component.metadata);
					}
				}

				if(ready.length > 0) {
					logSeparator();
					logger.log('Components that finished wiring');
					for(p = ready.length-1; p >= 0; --p) {
						component = ready[p];
						logger.log(component.msg, component.metadata);
					}
				}
			} else {
				logger.error(tag + ': No components created after ' + timeout + 'ms');
			}

			logSeparator();
		}

		/**
		 * Adds a named constructor function property to the supplied component
		 * so that the name shows up in debug inspectors.  Squelches all errors.
		 */
		function makeConstructor(name, component) {
			/*jshint evil:true*/
			var ctor;
			try {
				// Generate a named function to use as the constructor
				name = name.replace(/^[^a-zA-Z$_]|[^a-zA-Z0-9$_]+/g, '_');
				eval('ctor = function ' + name + ' () {}');

				// Be friendly and make configurable and writable just in case
				// some other library or application code tries to set constructor.
				Object.defineProperty(component, 'constructor', {
					configurable: true,
					writable: true,
					value: ctor
				});

			} catch(e) {
				// Oh well, ignore.
			}
		}

		plugin = {
			context: context,
			create:function (promise, proxy) {
				var path, component;

				path = proxy.path;
				component = proxy.target;

				count++;
				paths[path || ('(unnamed-' + count + ')')] = {
					metadata: proxy.metadata
				};

				if(component && typeof component == 'object'
					&& !ownProp(component, 'constructor')) {
					makeConstructor(proxy.id, component);
				}

				logCreated(promise, proxy);
			},
			configure:  makeListener('configured', verbose),
			initialize: makeListener('initialized', verbose),
			ready:      makeListener('ready', true),
			destroy:    function(promise, proxy) {
				// stop tracking destroyed components, since we don't
				// care anymore
				delete paths[proxy.path];
				count--;
				tag = "DESTROY";

				logDestroyed(promise, proxy);
			}
		};

		if (options.trace) {
			tracer = createTracer(options, plugin, filter);
		}

		checkPathsTimeout = setTimeout(checkPaths, timeout);

		return plugin;
	};

});
})(this, typeof define == 'function' && define.amd
	? define : function(factory) { module.exports = factory(require); }
);

/** @license MIT License (c) copyright 2011-2013 original author or authors */

/**
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * Helper module that parses incoming and outgoing method-call-based
 * connection specs. This module is used by wire plugins to parse connections.
 *
 * Incoming connection forms:
 *
 * 'srcComponent.triggerMethod': 'method'
 * 'srcComponent.triggerMethod': 'transforms | method'
 * srcComponent: {
 *   triggerMethod1: 'method',
 *   triggerMethod2: 'transforms | method',
 *   ...
 * }
 *
 * Outgoing connection forms:
 *
 * eventName: 'destComponent.method'
 * eventName: 'transforms | destComponent.method'
 * eventName: {
 *   destComponent1: 'method',
 *   destComponent2: 'transforms | method',
 *   ...
 * }
 *
 * @author Brian Cavalier
 * @author John Hann
 */

(function(define){ 'use strict';
define('wire/lib/connection',['require','when','./array','./pipeline'],function(require) {

	var when, array, pipeline;

	when = require('when');
	array = require('./array');
	pipeline = require('./pipeline');

	return {
		parse: parse,
		parseIncoming: parseIncoming,
		parseOutgoing: parseOutgoing,
		removeAll: removeAll
	};

	function removeAll(connections) {
		connections.forEach(function(c) {
			c.remove();
		});
	}

	/**
	 * Determines if the connections are incoming or outgoing, and invokes parseIncoming
	 * or parseOutgoing accordingly.
	 * @param proxy
	 * @param connect
	 * @param options
	 * @param wire {Function} wire function to use to wire, resolve references, and get proxies
	 * @param createConnection {Function} callback that will do the work of creating
	 *  the actual connection from the parsed information
	 * @return {Promise} promise that resolves when connections have been created, or
	 *  rejects if an error occurs.
	 */
	function parse(proxy, connect, options, wire, createConnection) {
		var source, eventName;

		// First, determine the direction of the connection(s)
		// If ref is a method on target, connect it to another object's method, i.e. calling a method on target
		// causes a method on the other object to be called.
		// If ref is a reference to another object, connect that object's method to a method on target, i.e.
		// calling a method on the other object causes a method on target to be called.

		source = connect.split('.');
		eventName = source[1];
		source = source[0];

		return when(wire.getProxy(source),
			function(srcProxy) {
				return parseIncoming(srcProxy, eventName, proxy, connect, options, wire, createConnection);
			},
			function() {
				return parseOutgoing(proxy, connect, options, wire, createConnection);
			}
		);
	}

	/**
	 * Parse incoming connections and call createConnection to do the work of
	 * creating the connection.
	 *
	 * @param source
	 * @param eventName
	 * @param targetProxy
	 * @param connect
	 * @param options
	 * @param wire {Function} wire function to use to wire, resolve references, and get proxies
	 * @param createConnection {Function} callback that will do the work of creating
	 *  the actual connection from the parsed information
	 * @return {Promise} promise that resolves when connections have been created, or
	 *  rejects if an error occurs.
	 */
	function parseIncoming(source, eventName, targetProxy, connect, options, wire, createConnection) {
		var promise, methodNames;

		if(eventName) {
			// 'component.eventName': 'methodName'
			// 'component.eventName': 'transform | methodName'

			methodNames = Array.isArray(options) ? options : [ options ];

			promise = when.map(methodNames, function(methodName) {
				return pipeline(targetProxy, methodName, wire).then(
					function(func) {
						var invoker = proxyInvoker(targetProxy, func);

						return createConnection(source, eventName, invoker);
					}
				);
			});

		} else {
			// componentName: {
			//   eventName: 'methodName'
			//   eventName: 'transform | methodName'
			// }

			promise = wire.getProxy(connect).then(function(srcProxy) {
				var name, promises;

				function createConnectionFactory(srcProxy, name, targetProxy) {
					return function(func) {
						var invoker = proxyInvoker(targetProxy, func);

						return createConnection(srcProxy, name, invoker);
					};
				}

				promises = [];
				for(name in options) {
					var connectionFactory, composed;

					connectionFactory = createConnectionFactory(srcProxy, name, targetProxy);
					composed = pipeline(targetProxy, options[name], wire);

					promises.push(composed.then(connectionFactory));
				}

				return when.all(promises);
			});
		}

		return promise;

	}

	/**
	 * Parse outgoing connections and call createConnection to do the actual work of
	 * creating the connection.  Supported forms:
	 *
	 * @param proxy
	 * @param connect
	 * @param options
	 * @param wire {Function} wire function to use to wire, resolve references, and get proxies
	 * @param createConnection {Function} callback that will do the work of creating
	 *  the actual connection from the parsed information
	 * @return {Promise} promise that resolves when connections have been created, or
	 *  rejects if an error occurs.
	 */
	function parseOutgoing(proxy, connect, options, wire, createConnection) {
		return createOutgoing(proxy, connect, proxy, options, wire, createConnection);
	}

	function createOutgoing(sourceProxy, eventName, targetProxy, options, wire, createConnection) {
		var promise, promises, resolveAndConnectOneOutgoing, name;

		function connectOneOutgoing(targetProxy, targetMethodSpec) {
			return when(pipeline(targetProxy, targetMethodSpec, wire),
				function(func) {
					var invoker = proxyInvoker(targetProxy, func);
					return createConnection(sourceProxy, eventName, invoker);
				});

		}

		if(typeof options == 'string') {
			// eventName: 'transform | componentName.methodName'
			promise = connectOneOutgoing(targetProxy, options);

		} else {
			promises = [];

			resolveAndConnectOneOutgoing = function(targetRef, targetMethodSpec) {
				return when(wire.getProxy(targetRef), function(targetProxy) {
					return connectOneOutgoing(targetProxy, targetMethodSpec);
				});
			};

			if (Array.isArray(options)) {
				// eventName: [ 'methodName1', 'methodName2' ]
				for (var i = 0, t = options.length; i < t; i++) {
					promises.push(connectOneOutgoing(targetProxy, options[i]));
				}

			} else {
				// eventName: {
				//   componentName: 'methodName'
				//   componentName: 'transform | methodName'
				// }
				for(name in options) {
					promises.push(resolveAndConnectOneOutgoing(name, options[name]));
				}
			}

			promise = when.all(promises);
		}

		return promise;
	}

	function proxyInvoker(proxy, method) {
		return function() {
			return proxy.invoke(method, arguments);
		};
	}

});
}(typeof define == 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));
/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * wire/plugin-base/on
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */
(function (define) {
define('wire/lib/plugin-base/on',['require','when','../functional','../connection'],function (require) {
'use strict';

	var when, functional, connection,
		theseAreNotEvents, thisLooksLikeCssRx, eventSplitterRx, undef;

	when = require('when');
	functional = require('../functional');
	connection = require('../connection');

	theseAreNotEvents = {
		selector: 1,
		transform: 1,
		preventDefault: 1,
		stopPropagation: 1
	};

	thisLooksLikeCssRx = /#|\.|-|[^,]\s[^,]/;
	eventSplitterRx = /\s*,\s*/;

	return function createOnPlugin (options) {
		var on;

		on = options.on;

		return function eventsPlugin (options) {

			var removers = [];

			if (!options) {
				options = {};
			}

			function createConnection(nodeProxy, eventsString, handler) {
				var events, node, prevent, stop;

				events = splitEventSelectorString(eventsString);
				node = nodeProxy.target;
				prevent = options.preventDefault;
				stop = options.stopPropagation;

				removers = removers.concat(
					registerHandlers(events, node, handler, prevent, stop)
				);
			}

			function parseIncomingOn(srcProxy, targetProxy, connections, wire) {

				// NOTE: Custom parsing for incoming connections

				// target is the node to which to connect, and
				// right hand side is a specification of an event
				// and a handler method on the current component
				//
				//	component: {
				//		on: {
				//			otherComponent: {
				//				selector: 'a.nav',
				//				transform: { $ref: 'myTransformFunc' }, // optional
				//				click: 'handlerMethodOnComponent',
				//				keypress: 'anotherHandlerOnComponent'
				//			}
				//		}
				//	}
				var target, event, events, selector, prevent, stop, method, transform, promises;

				target = targetProxy.target;
				promises = [];

				// Extract options
				selector = connections.selector;
				transform = connections.transform;
				prevent = connections.preventDefault || options.preventDefault;
				stop = connections.stopPropagation || options.stopPropagation;

				/**
				 * Compose a transform pipeline and then pass it to addConnection
				 */
				function createTransformedConnection(events, targetMethod, transformPromise) {
					return when(transformPromise, function(transform) {
						var composed, node;

						node = srcProxy.target;
						composed = functional.compose([transform, targetMethod]);
							//.bind(targetProxy.target);

						removers = removers.concat(
							registerHandlers(events, node, function() {
								return targetProxy.invoke(composed, arguments);
							}, prevent, stop)
						);
					});
				}

				for (event in connections) {
					// Skip reserved names, such as 'selector'
					if (!(event in theseAreNotEvents)) {
						// If there's an explicit transform, compose a transform pipeline manually,
						// Otherwise, let the connection lib do it's thing
						if(transform) {
							// TODO: Remove this long form?  It'd simplify the code a lot
							events = splitEventSelectorString(event, selector);
							method = connections[event];
							promises.push(createTransformedConnection(events, target[method], wire(transform)));
						} else {
							promises.push(connection.parseIncoming(srcProxy, event, targetProxy, options, connections[event], wire, createConnection));
						}
					}
				}

				return when.all(promises);
			}

			function parseOn (proxy, refName, connections, wire) {
				// First, figure out if the left-hand-side is a ref to
				// another component, or an event/delegation string
				return when(wire.getProxy(refName),
					function (srcProxy) {
						// It's an incoming connection, parse it as such
						return parseIncomingOn(srcProxy, proxy, connections, wire);
					},
					function () {
						// Failed to resolve refName as a reference, assume it
						// is an outgoing event with the current component (which
						// must be a Node) as the source
						return connection.parseOutgoing(proxy, refName, connections, wire, createConnection);
					}
				);

			}

			function onFacet (wire, facet) {
				var promises, connections;

				connections = facet.options;
				promises = [];

				for (var ref in connections) {
					promises.push(parseOn(facet, ref, connections[ref], wire));
				}

				return when.all(promises);
			}

			return {
				context: {
					destroy: function(resolver) {
						removers.forEach(function(remover) {
							remover();
						});
						resolver.resolve();
					}
				},
				facets: {
					on: {
						connect: function (resolver, facet, wire) {
							resolver.resolve(onFacet(wire, facet));
						}
					}
				},
				resolvers: {
					on: function(resolver, name /*, refObj, wire*/) {
						resolver.resolve(name ? createOnResolver(name) : on);
					}
				}
			};
		};

		function registerHandlers (events, node, callback, prevent, stop) {
			var removers, handler;
			removers = [];
			for (var i = 0, len = events.length; i < len; i++) {
				handler = makeEventHandler(callback, prevent, stop);
				removers.push(on(node, events[i], handler, events.selector));
			}
			return removers;
		}

		/**
		 * Returns a function that creates event handlers.  The event handlers
		 * are pre-configured with one or more selectors and one
		 * or more event types.  The syntax is identical to the "on" facet.
		 * Note that the returned handler does not auto-magically call
		 * event.preventDefault() or event.stopPropagation() like the "on"
		 * facet does.
		 * @private
		 * @param eventSelector {String} event/selector string that can be
		 *   parsed by splitEventSelectorString()
		 * @return {Function} a function that can be used to create event
		 *   handlers. It returns an "unwatch" function and takes any of
		 *   the following argument signatures:
		 *     function (handler) {}
		 *     function (rootNode, handler) {}
		 */
		function createOnResolver (eventSelector) {
			var events;
			// split event/selector string
			events = splitEventSelectorString(eventSelector, '');
			return function () {
				var args, node, handler, unwatches;
				// resolve arguments
				args = Array.prototype.slice.call(arguments, 0, 3);
				node = args.length > 1 ? args.shift() : document;
				handler = args[0];

				unwatches = [];
				events.forEach(function (event) {
					// create a handler for each event
					unwatches.push(on(node, event, handler, events.selector));
				});
				// return unwatcher of all events
				return function () {
					unwatches.forEach(function (unwatch) { unwatch(); });
				};
			};
		}

	};

	function preventDefaultIfNav (e) {
		var node, nodeName, nodeType, isNavEvent;
		node = e.selectorTarget || e.target || e.srcElement;
		if (node) {
			nodeName = node.tagName;
			nodeType = node.type && node.type.toLowerCase();
			// catch links and submit buttons/inputs in forms
			isNavEvent = ('click' == e.type && 'A' == nodeName)
				|| ('click' == e.type && 'submit' == nodeType && node.form)
				|| ('submit' == e.type && 'FORM' == nodeName);
			if (isNavEvent) {
				preventDefaultAlways(e);
			}
		}
	}

	function preventDefaultAlways (e) {
		e.preventDefault();
	}

	function stopPropagationAlways (e) {
		e.stopPropagation();
	}

	function never () {}

	function makeEventHandler (handler, prevent, stop) {
		var preventer, stopper;
		preventer = prevent == undef || prevent == 'auto'
			? preventDefaultIfNav
			: prevent ? preventDefaultAlways : never;
		stopper = stop ? stopPropagationAlways : never;

		// Use proxy.invoke instead of trying to call methods
		// directly on proxy.target
		return function (e) {
			preventer(e);
			stopper(e);
			return handler.apply(this, arguments);
		};
	}

	/**
	 * Splits an event-selector string into one or more combinations of
	 * selectors and event types.
	 * Examples:
	 *   ".target:click" --> {selector: '.target', event: 'click' }
	 *   ".mylist:first-child:click, .mylist:last-child:click" --> [
	 *     { selector: '.mylist:first-child', event: 'click' },
	 *     { selector: '.mylist:last-child', event: 'click' }
	 *   ]
	 *   ".mylist:first-child, .mylist:last-child:click" --> {
	 *     selector: '.mylist:first-child, .mylist:last-child',
	 *     event: 'click'
	 *   }
	 * @private
	 * @param string {String}
	 * @param defaultSelector {String}
	 * @returns {Array} an array of event names. if a selector was specified
	 *   the array has a selectors {String} property
	 */
	function splitEventSelectorString (string, defaultSelector) {
		var split, events, selectors;

		// split on first colon to get events and selectors
		split = string.split(':', 2);
		events = split[0];
		selectors = split[1] || defaultSelector;

		// look for css stuff in event (dev probably forgot event?)
		// css stuff: hash, dot, spaces without a comma
		if (thisLooksLikeCssRx.test(events)) {
			throw new Error('on! resolver: malformed event-selector string (event missing?)');
		}

		// split events
		events = events.split(eventSplitterRx);
		if (selectors) {
			events.selector = selectors;
		}

		return events;
	}

});
}(typeof define == 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * wire/dom/base
 * provides basic dom creation capabilities for plugins.
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */
(function (define) {
define('wire/lib/dom/base',['require','../WireProxy','../plugin/priority'],function (require) {

	var WireProxy, priority, classRx, trimLeadingRx, splitClassNamesRx, nodeProxyInvoke;

	WireProxy = require('../WireProxy');
	priority = require('../plugin/priority');

	classRx = '(\\s+|^)(classNames)(\\b(?![\\-_])|$)';
	trimLeadingRx = /^\s+/;
	splitClassNamesRx = /(\b\s+\b)|(\s+)/g;

	/**
	 * Adds one or more css classes to a dom element.
	 * @param el {HTMLElement}
	 * @param className {String} a single css class or several, space-delimited
	 *   css classes.
	 */
	function addClass (el, className) {
		var newClass;

		newClass = _stripClass(el.className, className);

		el.className = newClass + (newClass && className ? ' ' : '') + className;
	}

	/**
	 * Removes one or more css classes from a dom element.
	 * @param el {HTMLElement}
	 * @param className {String} a single css class or several, space-delimited
	 *   css classes.
	 */
	function removeClass (el, className) {
		el.className = _stripClass(el.className, className);
	}

	/**
	 * Adds or removes one or more css classes from a dom element.
	 * @param el {HTMLElement}
	 * @param className {String} a single css class or several, space-delimited
	 *   css classes.
	 */
	function toggleClass (el, className) {
		var unalteredClass;

		// save copy of what _stripClass would return if className
		// was not found
		unalteredClass = el.className.replace(trimLeadingRx, '');

		// remove className
		el.className = _stripClass(el.className, className);

		// add className if it wasn't removed
		if (unalteredClass == el.className) {
			el.className = unalteredClass + (unalteredClass && className ? ' ' : '') + className;
		}
	}

	/**
	 * Super fast, one-pass, non-looping routine to remove one or more
	 * space-delimited tokens from another space-delimited set of tokens.
	 * @private
	 * @param tokens
	 * @param removes
	 */
	function _stripClass (tokens, removes) {
		var rx;

		if (!removes) {
			return tokens;
		}

		// convert space-delimited tokens with bar-delimited (regexp `or`)
		removes = removes.replace(splitClassNamesRx, function (m, inner, edge) {
			// only replace inner spaces with |
			return edge ? '' : '|';
		});

		// create one-pass regexp
		rx = new RegExp(classRx.replace('classNames', removes), 'g');

		// remove all tokens in one pass (wish we could trim leading
		// spaces in the same pass! at least the trim is not a full
		// scan of the string)
		return tokens.replace(rx, '').replace(trimLeadingRx, '');
	}

	if (document && document.appendChild.apply) {
		// normal browsers
		nodeProxyInvoke = function jsInvoke (node, method, args) {
			if(typeof method == 'string') {
				method = node[method];
			}
			return method.apply(node, args);
		};
	}
	else {
		// IE 6-8 ('native' methods don't have .apply()) so we have
		// to use eval())
		nodeProxyInvoke = function evalInvoke (node, method, args) {
			var argsList;

			if(typeof method == 'function') {
				return method.apply(node, args);
			}

			// iirc, no node methods have more than 4 parameters
			// (addEventListener), so 5 should be safe. Note: IE needs
			// the exact number of arguments or it will throw!
			argsList = ['a', 'b', 'c', 'd', 'e'].slice(0, args.length).join(',');

			// function to execute eval (no need for global eval here
			// since the code snippet doesn't reference out-of-scope vars).
			function invoke (a, b, c, d, e) {
				/*jshint evil:true*/
				/*jshint unused:false*/
				return eval('node.' + method + '(' + argsList + ');');
			}

			// execute and return result
			return invoke.apply(this, args);
		};
	}

	function byId(id) {
		return document.getElementById(id);
	}

	function queryAll(selector, root) {
		return (root||document).querySelectorAll(selector);
	}

	function query(selector, root) {
		return (root||document).querySelector(selector);
	}

	/**
	 * Places a node into the DOM at the location specified around
	 * a reference node.
	 * Note: replace is problematic if the dev expects to use the node
	 * as a wire component.  The component reference will still point
	 * at the node that was replaced.
	 * @param node {HTMLElement}
	 * @param refNode {HTMLElement}
	 * @param location {String} or {Number} 'before', 'after', 'first', 'last',
	 *   or the position within the children of refNode
	 */
	function placeAt(node, refNode, location) {
		var parent, i;

		if ('length' in refNode) {
			for (i = 0; i < refNode.length; i++) {
				placeAt(i === 0 ? node : node.cloneNode(true), refNode[i], location);
			}
			return node;
		}

		parent = refNode.parentNode;

		// `if else` is more compressible than switch
		if (!isNaN(location)) {
			if (location < 0) {
				location = 0;
			}
			_insertBefore(refNode, node, refNode.childNodes[location]);
		}
		else if(location == 'at') {
			refNode.innerHTML = '';
			_appendChild(refNode, node);
		}
		else if(location == 'last') {
			_appendChild(refNode, node);
		}
		else if(location == 'first') {
			_insertBefore(refNode, node, refNode.firstChild);
		}
		else if(location == 'before') {
			// TODO: throw if parent missing?
			_insertBefore(parent, node, refNode);
		}
		else if(location == 'after') {
			// TODO: throw if parent missing?
			if (refNode == parent.lastChild) {
				_appendChild(parent, node);
			}
			else {
				_insertBefore(parent, node, refNode.nextSibling);
			}
		}
		else {
			throw new Error('Unknown dom insertion command: ' + location);
		}

		return node;
	}

	// these are for better compressibility since compressors won't
	// compress native DOM methods.
	function _insertBefore(parent, node, refNode) {
		parent.insertBefore(node, refNode);
	}

	function _appendChild(parent, node) {
		parent.appendChild(node);
	}

	function isNode(it) {
		return typeof Node === 'object'
			? it instanceof Node
			: it && typeof it === 'object' && typeof it.nodeType === 'number' && typeof it.nodeName==='string';
	}

	function NodeProxy() {}

	NodeProxy.prototype = {
		get: function (name) {
			var node = this.target;

			if (name in node) {
				return node[name];
			}
			else {
				return node.getAttribute(name);
			}
		},

		set: function (name, value) {
			var node = this.target;

			if (name in node) {
				return node[name] = value;
			}
			else {
				return node.setAttribute(name, value);
			}
		},

		invoke: function (method, args) {
			return nodeProxyInvoke(this.target, method, args);
		},

		destroy: function () {
			var node = this.target;

			// if we added a destroy method on the node, call it.
			// TODO: find a better way to release events instead of using this mechanism
			if (node.destroy) {
				node.destroy();
			}
			// removal from document will destroy node as soon as all
			// references to it go out of scope.
			var parent = node.parentNode;
			if (parent) {
				parent.removeChild(node);
			}
		},

		clone: function (options) {
			if (!options) {
				options = {};
			}
			// default is to clone deep (when would anybody not want deep?)
			return this.target.cloneNode(!('deep' in options) || options.deep);
		}
	};

	proxyNode.priority = priority.basePriority;
	function proxyNode (proxy) {

		if (!isNode(proxy.target)) {
			return proxy;
		}

		return WireProxy.extend(proxy, NodeProxy.prototype);
	}

	return {

		byId: byId,
		querySelector: query,
		querySelectorAll: queryAll,
		placeAt: placeAt,
		addClass: addClass,
		removeClass: removeClass,
		toggleClass: toggleClass,
		proxyNode: proxyNode

	};

});
}(
	typeof define == 'function' && define.amd
		? define
		: function (factory) { module.exports = factory(require); }
));

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * wire/on plugin
 * wire plugin that provides an "on" facet to connect to dom events,
 * and includes support for delegation
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */
(function (define) {
define('wire/on',['./lib/plugin-base/on', './lib/dom/base'], function (createOnPlugin, base) {
'use strict';

	var contains;

	/**
	 * Listens for dom events at the given node.  If a selector is provided,
	 * events are filtered to only nodes matching the selector.  Note, however,
	 * that children of the matching nodes can also fire events that bubble.
	 * To determine the matching node, use the event object's selectorTarget
	 * property instead of it's target property.
	 * @param node {HTMLElement} element at which to listen
	 * @param event {String} event name ('click', 'mouseenter')
	 * @param handler {Function} handler function with the following signature: function (e) {}
	 * @param [selector] {String} optional css query string to use to
	 * @return {Function} removes the event handler
	 */
	function on (node, event, handler /*, selector */) {
		var selector = arguments[3];

		if (selector) {
			handler = filteringHandler(node, selector, handler);
		}

		node.addEventListener(event, handler, false);

		return function remove () {
			node.removeEventListener(node, handler, false);
		};
	}

	on.wire$plugin = createOnPlugin({
		on: on
	});

	if (document && document.compareDocumentPosition) {
		contains = function w3cContains (refNode, testNode) {
			return (refNode.compareDocumentPosition(testNode) & 16) == 16;
		};
	}
	else {
		contains = function oldContains (refNode, testNode) {
			return refNode.contains(testNode);
		};
	}

	return on;

	/**
	 * This is a brute-force method of checking if an event target
	 * matches a query selector.
	 * @private
	 * @param node {Node}
	 * @param selector {String}
	 * @param handler {Function} function (e) {}
	 * @returns {Function} function (e) {}
	 */
	function filteringHandler (node, selector, handler) {
		return function (e) {
			var target, matches, i, len, match;
			// if e.target matches the selector, call the handler
			target = e.target;
			matches = base.querySelectorAll(selector, node);
			for (i = 0, len = matches.length; i < len; i++) {
				match = matches[i];
				if (target == match || contains(match, target)) {
					e.selectorTarget = match;
					return handler(e);
				}
			}
		};
	}

});
}(
	typeof define == 'function' && define.amd
		? define
		: function (deps, factory) { module.exports = factory.apply(this, deps.map(require)); }
));

/** @license MIT License (c) copyright 2011-2013 original author or authors */

/**
 * wire/domReady
 * A base wire/domReady module that plugins can use if they need domReady.  Simply
 * add 'wire/domReady' to your plugin module dependencies
 * (e.g. require(['wire/domReady', ...], function(domReady, ...) { ... })) and you're
 * set.
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * Returns a function that accepts a callback to be called when the DOM is ready.
 *
 * You can also use your AMD loader's paths config to map wire/domReady to whatever
 * domReady function you might want to use.  See documentation for your AMD loader
 * for specific instructions.  For curl.js and requirejs, it will be something like:
 *
 *  paths: {
 *      'wire/domReady': 'path/to/my/domReady'
 *  }
 *
 * @author Brian Cavalier
 * @author John Hann
 */

(function(global) {
define('wire/domReady',['require'], function(req) {

	// Try require.ready first
	return (global.require && global.require.ready) || function (cb) {
		// If it's not available, assume a domReady! plugin is available
		req(['domReady!'], function () {
			// Using domReady! as a plugin will automatically wait for domReady
			// so we can just call the callback.
			cb();
		});
	};

});
})(this);

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * dom plugin helper
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */
define('wire/lib/plugin-base/dom',['wire/domReady', 'when', '../dom/base', '../object'], function(domReady, when, base, object) {

	function getElementFactory (resolver, componentDef, wire) {
		when(wire(componentDef.options), function (element) {

			if (!element || !element.nodeType || !element.tagName) {
				throw new Error('dom: non-element reference provided to element factory');
			}

			return element;
		}).then(resolver.resolve, resolver.reject);
	}

	return function createDomPlugin(options) {

		var getById, query, first, addClass, removeClass, placeAt,
			doById, doPlaceAt, resolveQuery;

		getById = options.byId || base.byId;
		query = options.query || base.querySelectorAll;
		first = options.first || base.querySelector;
		addClass = options.addClass;
		placeAt = options.placeAt || base.placeAt;
		removeClass = options.removeClass;

		function doByIdImpl(resolver, name) {
			var node;

			// if dev omitted name, they're looking for the resolver itself
			if (!name) {
				return resolver.resolve(getById);
			}

			node = getById(name);
			if (node) {
				resolver.resolve(node);
			} else {
				resolver.reject(new Error('No DOM node with id: ' + name));
			}
		}

		doById = function(resolver, name /*, refObj, wire*/) {
			domReady(function() {
				doById = doByIdImpl;
				doByIdImpl(resolver, name);
			});
		};

		function doQuery(name, refObj, root, queryFunc) {
			var result, i;

			result = queryFunc(name, root);

			// if dev supplied i, try to use it
			if (typeof refObj.i != 'undefined') {
				i = refObj.i;
				if (result[i]) { // do not use `i in result` since IE gives a false positive
					return result[i];
				} else {
					throw new Error('Query "' + name + '" did not find an item at position ' + i);
				}
			} else if (queryFunc == first && !result) {
				throw new Error('Query "' + name + '" did not find anything');
			} else {
				return result;
			}
		}

		function doPlaceAtImpl(resolver, facet, wire) {
			var futureRefNode, node, options, operation;

			options = facet.options;
			node = facet.target;

			// get first property and use it as the operation
			for (var p in options) {
				if (object.hasOwn(options, p)) {
					operation = p;
					break;
				}
			}

			futureRefNode = wire(makeQueryRef(options[operation]));

			when(futureRefNode, function (refNode) {
				return placeAt(node, refNode, operation);
			}).then(resolver.resolve, resolver.reject);
		}

		doPlaceAt = function(resolver, facet, wire) {
			domReady(function() {
				doPlaceAt = doPlaceAtImpl;
				doPlaceAtImpl(resolver, facet, wire);
			});
		};

		function resolveQueryImpl(resolver, name, refObj, wire, queryFunc) {
			var futureRoot;

			if (!queryFunc) {
				queryFunc = query;
			}

			// if dev omitted name, they're looking for the resolver itself
			if (!name) {
				return resolver.resolve(queryFunc);
			}

			// get string ref or object ref
			if (refObj.at && !refObj.isRoot) {
				futureRoot = wire(makeQueryRoot(refObj.at));
			}

			// sizzle will default to document if refObj.at is unspecified
			when(futureRoot, function (root) {
				return doQuery(name, refObj, root, queryFunc);
			}).then(resolver.resolve, resolver.reject);
		}

		/**
		 *
		 * @param resolver {Resolver} resolver to notify when the ref has been resolved
		 * @param name {String} the dom query
		 * @param refObj {Object} the full reference object, including options
		 * @param wire {Function} wire()
		 * @param [queryFunc] {Function} the function to use to query the dom
		 */
		resolveQuery = function(resolver, name, refObj, wire, queryFunc) {

			domReady(function() {
				resolveQuery = resolveQueryImpl;
				resolveQueryImpl(resolver, name, refObj, wire, queryFunc);
			});

		};

		/**
		 * dom.first! resolver.
		 *
		 * @param resolver {Resolver} resolver to notify when the ref has been resolved
		 * @param name {String} the dom query
		 * @param refObj {Object} the full reference object, including options
		 * @param wire {Function} wire()
		 */
		function resolveFirst(resolver, name, refObj, wire) {
			resolveQuery(resolver, name, refObj, wire, first);
		}

		function makeQueryRoot(ref) {

			var root = makeQueryRef(ref);

			if(root) {
				root.isRoot = true;
			}

			return root;
		}

		function makeQueryRef(ref) {
			return typeof ref == 'string' ? { $ref: ref } : ref;
		}

		function createResolver(resolverFunc, options) {
			return function(resolver, name, refObj, wire) {
				if(!refObj.at) {
					refObj.at = options.at;
				} else {
					refObj.at = makeQueryRoot(refObj.at);
				}

				return resolverFunc(resolver, name, refObj, wire);
			};
		}

		function handleClasses(node, add, remove) {
			if(add) {
				addClass(node, add);
			}

			if(remove) {
				removeClass(node, remove);
			}
		}

		/**
		 * DOM plugin factory
		 */
		return function(options) {
			var classes, resolvers, facets, factories, context, htmlElement;

			options.at = makeQueryRoot(options.at);
			classes = options.classes;
			context = {};

			if(classes) {
				domReady(function() {
					htmlElement = document.getElementsByTagName('html')[0];
				});

				context.initialize = function (resolver) {
					domReady(function () {
						handleClasses(htmlElement, classes.init);
						resolver.resolve();
					});
				};
				context.ready = function (resolver) {
					domReady(function () {
						handleClasses(htmlElement, classes.ready, classes.init);
						resolver.resolve();
					});
				};
				if(classes.ready) {
					context.destroy = function (resolver) {
						domReady(function () {
							handleClasses(htmlElement, null, classes.ready);
							resolver.resolve();
						});
					};
				}
			}

			factories = {
				element: getElementFactory
			};

			facets = {
				insert: {
					initialize: doPlaceAt
				}
			};

			resolvers = {};
			// id and dom are synonyms
			// dom is deprecated and for backward compat only
			resolvers.id = resolvers.dom = doById;

			if (query) {
				// dom.first is deprecated
				resolvers.first = createResolver(resolveFirst, options);
				resolvers['dom.first'] = function() {
					// TODO: Deprecation warning
					resolvers.first.apply(resolvers, arguments);
				};

				// all and query are synonyms
				resolvers.all = resolvers.query = createResolver(resolveQuery, options);
				resolvers['dom.all'] = resolvers['dom.query'] = function() {
					// TODO: Deprecation warning
					resolvers.query.apply(resolvers, arguments);
				};
			}

			return {
				context: context,
				resolvers: resolvers,
				facets: facets,
				factories: factories,
				proxies: [
					base.proxyNode
				]
			};

		};
	};
});

/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * wire/dom plugin
 * wire plugin that provides a resource resolver for dom nodes, by id, in the
 * current page.  This allows easy wiring of page-specific dom references into
 * generic components that may be page-independent, i.e. makes it easier to write
 * components that can be used on multiple pages, but still require a reference
 * to one or more nodes on the page.
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

define('wire/dom',['./lib/plugin-base/dom', './lib/dom/base'], function(createDomPlugin, base) {

	return createDomPlugin({
		addClass: base.addClass,
		removeClass: base.removeClass
	});

});
/** @license MIT License (c) copyright B Cavalier & J Hann */

/**
 * wire/dom/render plugin
 * wire plugin that provides a factory for dom nodes via a simple html
 * template.
 *
 * wire is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 */

define('wire/dom/render',['./../lib/dom/base', 'when'], function (base, when) {

	var parentTypes, parseTemplateRx, getFirstTagNameRx, isPlainTagNameRx,
		pluginInstance, undef;

	// elements that could be used as root nodes and their natural parent type
	parentTypes = {
		'li': 'ul',
		'td': 'tr',
		'tr': 'tbody',
		'tbody': 'table',
		'thead': 'table',
		'tfoot': 'table',
		'caption': 'table',
		'col': 'table',
		'colgroup': 'table',
		'option': 'select'
	};

	parseTemplateRx = /\$\{([^}]*)\}/g;
	getFirstTagNameRx = /<\s*(\w+)/;
	isPlainTagNameRx = /^[A-Za-z]\w*$/;

	/**
	 * Constructs a DOM node and child nodes from a template string.
	 * Information contained in a hashmap is merged into the template
	 * via tokens (${name}) before rendering into DOM nodes.
	 * Nothing is done with the css parameter at this time.
	 * @param template {String} html template
	 * @param hashmap {Object} string replacements hash
	 * @param optRefNode {HTMLElement} node to replace with root node of rendered template
	 * @returns {HTMLElement}
	 */
	function render (template, hashmap, optRefNode /*, optCss */) {
		var node;

		// replace tokens (before attempting to find top tag name)
		template = replaceTokens('' + template, hashmap);

		if (isPlainTagNameRx.test(template)) {
			// just 'div' or 'a' or 'tr', for example
			node = document.createElement(template);
		}
		else {
			// create node from template
			node = createElementFromTemplate(template);
		}

		if (optRefNode) {
			node = safeReplaceElement(node, optRefNode);
		}

		return node;
	}

	pluginInstance = {
		factories: {
			render: domRenderFactory
		},
		proxies: [
			base.proxyNode
		]
	};

	render.wire$plugin = function (/* options */) {
		return pluginInstance;
	};

	/**
	 * Finds the first html element in a string, extracts its tag name,
	 * and looks up the natural parent element tag name for this element.
	 * @private
	 * @param template {String}
	 * @returns {String} the parent tag name, or 'div' if none was found.
	 */
	function getParentTagName (template) {
		var matches;

		// TODO: throw if no element was ever found?
		matches = template.match(getFirstTagNameRx);

		return parentTypes[matches && matches[1]] || 'div';
	}

	/**
	 * Creates an element from a text template.  This function does not
	 * support multiple elements in a template.  Leading and trailing
	 * text and/or comments are also ignored.
	 * @private
	 * @param template {String}
	 * @returns {HTMLElement} the element created from the template
	 */
	function createElementFromTemplate (template) {
		var parentTagName, parent, first, tooMany, node;

		parentTagName = getParentTagName(template);
		parent = document.createElement(parentTagName);
		parent.innerHTML = template;

		// we just want to return first element (nodelists and fragments
		// are tricky), so we ensure we only have one.
		// TODO: try using DocumentFragments to allow multiple root elements

		// try html5-ish API
		if ('firstElementChild' in parent) {
			first = parent.firstElementChild;
			tooMany = first != parent.lastElementChild;
		}
		else {
			// loop through nodes looking for elements
			node = parent.firstChild;
			while (node && !tooMany) {
				if (node.nodeType == 1 /* 1 == element */) {
					if (!first) first = node;
					else tooMany = true;
				}
				node = node.nextSibling;
			}
		}

		if (!first) {
			throw new Error('render: no element found in template.');
		}
		else if (tooMany) {
			throw new Error('render: only one root element per template is supported.');
		}

		return first;
	}

	/**
	 * Creates rendered dom trees for the "render" factory.
	 * @param resolver
	 * @param componentDef
	 * @param wire
	 */
	function domRenderFactory (resolver, componentDef, wire) {
		when(wire(componentDef.options), function (options) {
			var template;
			template = options.template || options;
			return render(template, options.replace, options.at, options.css);
		}).then(resolver.resolve, resolver.reject);
	}

	/**
	 * Replaces a dom node, while preserving important attributes
	 * of the original.
	 * @private
	 * @param oldNode {HTMLElement}
	 * @param newNode {HTMLElement}
	 * @returns {HTMLElement} newNode
	 */
	function safeReplaceElement (newNode, oldNode) {
		var i, attr, parent;

		for (i = 0; i < oldNode.attributes.length; i++) {
			attr = oldNode.attributes[i];
			if ('class' == attr.name) {
				// merge css classes
				// TODO: if we want to be smart about not duplicating classes, implement spliceClassNames from cola/dom/render
				newNode.className = (oldNode.className ? oldNode.className + ' ' : '')
					+ newNode.className;
			}
			// Note: IE6&7 don't support node.hasAttribute() so we're using node.attributes
			else if (!newNode.attributes[attr.name]) {
				newNode.setAttribute(attr.name, oldNode.getAttribute(attr.name));
			}
		}
		parent = oldNode.parentNode;
		if (parent) {
			parent.replaceChild(newNode, oldNode);
		}
		return newNode;
	}

	/**
	 * Replaces simple tokens in a string.  Tokens are in the format ${key}.
	 * Tokens are replaced by values looked up in an associated hashmap.
	 * If a token's key is not found in the hashmap, an empty string is
	 * inserted instead.
	 * @private
	 * @param template
	 * @param hashmap {Object} the names of the properties of this object
	 * are used as keys. The values replace the token in the string.
	 * @param [missing] {Function} callback that deals with missing properties
	 * @returns {String}
	 */
	function replaceTokens (template, hashmap, missing) {
		if (!hashmap) {
			return template;
		}

		if (!missing) {
			missing = blankIfMissing;
		}
		
		return template.replace(parseTemplateRx, function (m, token) {
			return missing(findProperty(hashmap, token));
		});
	}

	function findProperty (obj, propPath) {
		var props, prop;
		props = propPath.split('.');
		while (obj && (prop = props.shift())) {
			obj = obj[prop];
		}
		return obj;
	}

	function blankIfMissing (val) { return val == undef ? '' : val; }

	return render;

});

/**
 * @license RequireJS domReady 2.0.1 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/domReady for details
 */
/*jslint */
/*global require: false, define: false, requirejs: false,
  window: false, clearInterval: false, document: false,
  self: false, setInterval: false */


define('domReady/domReady',[],function () {
    'use strict';

    var isTop, testDiv, scrollIntervalId,
        isBrowser = typeof window !== "undefined" && window.document,
        isPageLoaded = !isBrowser,
        doc = isBrowser ? document : null,
        readyCalls = [];

    function runCallbacks(callbacks) {
        var i;
        for (i = 0; i < callbacks.length; i += 1) {
            callbacks[i](doc);
        }
    }

    function callReady() {
        var callbacks = readyCalls;

        if (isPageLoaded) {
            //Call the DOM ready callbacks
            if (callbacks.length) {
                readyCalls = [];
                runCallbacks(callbacks);
            }
        }
    }

    /**
     * Sets the page as loaded.
     */
    function pageLoaded() {
        if (!isPageLoaded) {
            isPageLoaded = true;
            if (scrollIntervalId) {
                clearInterval(scrollIntervalId);
            }

            callReady();
        }
    }

    if (isBrowser) {
        if (document.addEventListener) {
            //Standards. Hooray! Assumption here that if standards based,
            //it knows about DOMContentLoaded.
            document.addEventListener("DOMContentLoaded", pageLoaded, false);
            window.addEventListener("load", pageLoaded, false);
        } else if (window.attachEvent) {
            window.attachEvent("onload", pageLoaded);

            testDiv = document.createElement('div');
            try {
                isTop = window.frameElement === null;
            } catch (e) {}

            //DOMContentLoaded approximation that uses a doScroll, as found by
            //Diego Perini: http://javascript.nwbox.com/IEContentLoaded/,
            //but modified by other contributors, including jdalton
            if (testDiv.doScroll && isTop && window.external) {
                scrollIntervalId = setInterval(function () {
                    try {
                        testDiv.doScroll();
                        pageLoaded();
                    } catch (e) {}
                }, 30);
            }
        }

        //Check if document already complete, and if so, just trigger page load
        //listeners. Latest webkit browsers also use "interactive", and
        //will fire the onDOMContentLoaded before "interactive" but not after
        //entering "interactive" or "complete". More details:
        //http://dev.w3.org/html5/spec/the-end.html#the-end
        //http://stackoverflow.com/questions/3665561/document-readystate-of-interactive-vs-ondomcontentloaded
        //Hmm, this is more complicated on further use, see "firing too early"
        //bug: https://github.com/requirejs/domReady/issues/1
        //so removing the || document.readyState === "interactive" test.
        //There is still a window.onload binding that should get fired if
        //DOMContentLoaded is missed.
        if (document.readyState === "complete") {
            pageLoaded();
        }
    }

    /** START OF PUBLIC API **/

    /**
     * Registers a callback for DOM ready. If DOM is already ready, the
     * callback is called immediately.
     * @param {Function} callback
     */
    function domReady(callback) {
        if (isPageLoaded) {
            callback(doc);
        } else {
            readyCalls.push(callback);
        }
        return domReady;
    }

    domReady.version = '2.0.1';

    /**
     * Loader Plugin API method
     */
    domReady.load = function (name, req, onLoad, config) {
        if (config.isBuild) {
            onLoad(null);
        } else {
            domReady(onLoad);
        }
    };

    /** END OF PUBLIC API **/

    return domReady;
});

define('domReady', ['domReady/domReady'], function (main) { return main; });

// Generated by CoffeeScript 1.9.2
define('src/js/assets',["wire/debug", "wire/on", "wire/dom", "wire/dom/render", "domReady"], function() {});

// Generated by CoffeeScript 1.9.2
require(['wire', '../../src/js/spec', "../../src/js/assets"], function(wire, spec) {
  return wire(spec);
});

define("src/js/app", function(){});

