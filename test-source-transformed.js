var _regeneratorRuntime = require("@babel/runtime/regenerator");
var _asyncToGenerator = require("@babel/runtime/helpers/asyncToGenerator");
import { __probe_wrap } from "./test-probe-runtime";
function __probe_calculate(a, b) {
  return add(a, b) + multiply(a, b);
}
var calculate = __probe_wrap(__probe_calculate, "calculate", "test-source.js:1:0");
function __probe_add(x, y) {
  return x + y;
}
var add = __probe_wrap(__probe_add, "add", "test-source.js:5:0");
function __probe_multiply(x, y) {
  return square(x) * y;
}
var multiply = __probe_wrap(__probe_multiply, "multiply", "test-source.js:9:0");
function __probe_square(n) {
  return n * n;
}
var square = __probe_wrap(__probe_square, "square", "test-source.js:13:0");
var asyncOperation = __probe_wrap(/*#__PURE__*/__probe_wrap(function () {
  var _ref = _asyncToGenerator(__probe_wrap(/*#__PURE__*/_regeneratorRuntime.mark(function _callee(delay) {
    return _regeneratorRuntime.wrap(__probe_wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          _context.next = 2;
          return sleep(delay);
        case 2:
          return _context.abrupt("return", process(delay));
        case 3:
        case "end":
          return _context.stop();
      }
    }, "_callee$", "test-source.js"), _callee);
  }), "anonymous", "test-source.js:17:23"));
  return __probe_wrap(function (_x) {
    return _ref.apply(this, arguments);
  }, "anonymous", "test-source.js");
}, "anonymous", "test-source.js")(), "asyncOperation", "test-source.js:17:23");
var sleep = __probe_wrap(function (ms) {
  return new Promise(__probe_wrap(function (resolve) {
    return setTimeout(resolve, ms);
  }, "anonymous", "test-source.js:22:34"));
}, "sleep", "test-source.js:22:14");
var process = __probe_wrap(function (value) {
  return transform(value * 2);
}, "process", "test-source.js:24:16");
var transform = __probe_wrap(function (input) {
  return input + 100;
}, "transform", "test-source.js:28:18");
module.exports = {
  calculate: calculate,
  add: add,
  multiply: multiply,
  square: square,
  asyncOperation: asyncOperation
};