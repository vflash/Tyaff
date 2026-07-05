// tests/test-node-06.js

// ============================================================================
// Node.js тесты для VDOM библиотеки tyaff — Часть 6: Key inheritance
// Запуск: node --test tests/test-node-06.js
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

const { h, Component, Fragment, createPortal, mount, refresh, _cleanupAll } = await import('../src/core.js');

function createContainer() {
    if (!hasDOM) throw new Error('DOM недоступен');
    return document.createElement('div');
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

if (hasDOM) {
    describe('Key inheritance — наследование UID от родителя с key', () => {
        test('текстовый узел внутри элемента с key переиспользуется при reorder', () => {
            const container = createContainer();

            // Первый рендер: [div(key=a, 'AAA'), div(key=b, 'BBB')]
            mount([
                h('div', { key: 'a' }, 'AAA'),
                h('div', { key: 'b' }, 'BBB')
            ], container);

            // Запоминаем текстовый узел внутри div'a с key='a'
            const divA = container.children[0];
            const textNodeA = divA.firstChild;

            assert.strictEqual(divA.textContent, 'AAA');
            assert.strictEqual(textNodeA.nodeType, 3); // TEXT_NODE

            // Второй рендер: меняем порядок — [div(key=b, 'BBB'), div(key=a, 'AAA')]
            mount([
                h('div', { key: 'b' }, 'BBB'),
                h('div', { key: 'a' }, 'AAA')
            ], container);

            // Проверяем, что div с key='a' переместился
            const divAMoved = container.children[1];
            assert.strictEqual(divAMoved, divA, 'div с key=a должен быть тем же DOM-элементом');

            // ⚡ КЛЮЧЕВАЯ ПРОВЕРКА: текстовый узел должен переиспользоваться
            const textNodeAMoved = divAMoved.firstChild;
            assert.strictEqual(textNodeAMoved, textNodeA,
                'Текстовый узел внутри элемента с key должен переиспользоваться при reorder родителя');

            assert.strictEqual(container.children[0].textContent, 'BBB');
            assert.strictEqual(container.children[1].textContent, 'AAA');

            _cleanupAll();
        });

        test('элемент без key внутри элемента с key наследует UID родителя', () => {
            const container = createContainer();

            // Первый рендер
            mount(
                h('div', { key: 'parent' },
                    h('span', null, 'child1'),
                    h('span', null, 'child2')
                ),
                container
            );

            const parentDiv = container.children[0];
            const span1 = parentDiv.children[0];
            const span2 = parentDiv.children[1];

            // Второй рендер — тот же vnode
            mount(
                h('div', { key: 'parent' },
                    h('span', null, 'child1'),
                    h('span', null, 'child2')
                ),
                container
            );

            const parentDivNew = container.children[0];
            assert.strictEqual(parentDivNew, parentDiv, 'parent div должен быть тем же');

            // ⚡ Дети должны переиспользоваться
            assert.strictEqual(parentDivNew.children[0], span1, 'первый span должен быть тем же');
            assert.strictEqual(parentDivNew.children[1], span2, 'второй span должен быть тем же');

            _cleanupAll();
        });

        test('вложенные элементы с key сохраняют UID при перемещении', () => {
            const container = createContainer();

            mount(
                h('div', { key: 'outer' },
                    h('div', { key: 'inner' }, 'content')
                ),
                container
            );

            const outerDiv = container.children[0];
            const innerDiv = outerDiv.children[0];
            const textNode = innerDiv.firstChild;

            // Перемещаем outer в другое место (симулируем conditional rendering)
            mount(
                h('div', null,
                    h('div', { key: 'wrapper' },
                        h('div', { key: 'outer' },
                            h('div', { key: 'inner' }, 'content')
                        )
                    )
                ),
                container
            );

            // outerDiv должен сохраниться
            const wrapperDiv = container.children[0].children[0];
            const outerDivMoved = wrapperDiv.children[0];

            assert.strictEqual(outerDivMoved, outerDiv, 'outer div должен сохраниться');
            assert.strictEqual(outerDivMoved.children[0], innerDiv, 'inner div должен сохраниться');
            assert.strictEqual(outerDivMoved.children[0].firstChild, textNode, 'text node должен сохраниться');

            _cleanupAll();
        });
    });
}
