// ============================================================================
// Test for Bug 3: Raw strings/numbers in nested arrays are silently dropped
// ============================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

let hasDOM = false;
try {
    const happyDom = await import('happy-dom');
    const window = new happyDom.Window({ url: 'http://localhost' });
    global.window = window;
    global.document = window.document;
    global.HTMLElement = window.HTMLElement;
    global.Node = window.Node;
    global.Text = window.Text;
    global.SVGElement = window.SVGElement;
    global.performance = window.performance;
    hasDOM = true;
} catch (e) {
    console.warn('⚠️  happy-dom не установлен. DOM-тесты будут пропущены.');
}

const { h, Component, Fragment, mount } = await import('../src/core.js');

function createContainer() {
    if (!hasDOM) throw new Error('DOM недоступен');
    return document.createElement('div');
}

if (hasDOM) {
    describe('Bug 3 — Raw strings/numbers in nested arrays', () => {
        test('strings in array should be rendered', () => {
            const container = createContainer();
            mount(h('div', null, ['a', 'b']), container);
            assert.equal(container.textContent, 'ab', 'Strings in array should be rendered');
        });

        test('numbers in array should be rendered', () => {
            const container = createContainer();
            mount(h('div', null, [1, 2, 3]), container);
            assert.equal(container.textContent, '123', 'Numbers in array should be rendered');
        });

        test('mixed strings and numbers in array should be rendered', () => {
            const container = createContainer();
            mount(h('div', null, ['a', 'b', 42]), container);
            assert.equal(container.textContent, 'ab42', 'Mixed strings and numbers should be rendered');
        });

        test('deeply nested arrays with strings should be rendered', () => {
            const container = createContainer();
            mount(h('div', null, [['a', 'b'], ['c', 'd']]), container);
            assert.equal(container.textContent, 'abcd', 'Deeply nested strings should be rendered');
        });

        test('array with elements and strings should be rendered', () => {
            const container = createContainer();
            mount(h('div', null, [h('span', null, 'x'), 'y', h('span', null, 'z')]), container);
            assert.equal(container.textContent, 'xyz', 'Array with elements and strings should be rendered');
        });

        test('array passed as child should work', () => {
            const container = createContainer();
            const children = ['hello', ' ', 'world'];
            mount(h('div', null, children), container);
            assert.equal(container.textContent, 'hello world', 'Array passed as child should work');
        });
    });
}
