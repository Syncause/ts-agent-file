function calculate(a, b) {
    return add(a, b) + multiply(a, b);
}

function add(x, y) {
    return x + y;
}

function multiply(x, y) {
    return square(x) * y;
}

function square(n) {
    return n * n;
}

const asyncOperation = async (delay) => {
    await sleep(delay);
    return process(delay);
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const process = (value) => {
    return transform(value * 2);
};

const transform = (input) => {
    return input + 100;
};

module.exports = { calculate, add, multiply, square, asyncOperation };
