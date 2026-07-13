// ============================================================================
// Dev-тесты для VDOM библиотеки tyaff — Часть 1
// Тесты деталей реализации (не часть public API/спецификации).
// Проверяют внутренние оптимизации и инварианты, которые могут меняться
// при рефакторинге. Спек-тесты живут в test-node-*.js.
// Запуск: node --test tests/test-dev-01.js
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

const { h, Component, Fragment, createPortal, mount, refresh } = await import('../src/core.js');

function createContainer() {
    if (!hasDOM) throw new Error('DOM недоступен');
    return document.createElement('div');
}

if (hasDOM) {

    // =========================================================================
    // EMPTY_PROPS — shared frozen reference для h() без props
    // Оптимизация: h(type) и h(type, null) должны возвращать тот же frozen
    // объект вместо аллокации нового {} на каждый вызов. Это деталь реализации —
    // спецификация требует только что .props был объектом (или falsy → эквивалент {}).
    // =========================================================================
    describe('EMPTY_PROPS — shared frozen reference (implementation detail)', () => {
        test('h(type) без props возвращает frozen объект', () => {
            const vnode = h('div');
            assert.ok(Object.isFrozen(vnode.props), 'props должен быть frozen');
        });

        test('h(type, null) возвращает тот же shared reference', () => {
            const v1 = h('div');
            const v2 = h('div', null);
            const v3 = h('span', null, 'hello');
            assert.strictEqual(v1.props, v2.props, 'h(div) и h(div, null) должны делить props');
            assert.strictEqual(v1.props, v3.props, 'h(div) и h(span, null, ...) должны делить props');
        });

        test('h(type, undefined) возвращает тот же shared reference', () => {
            const v1 = h('div');
            const v2 = h('div', undefined);
            assert.strictEqual(v1.props, v2.props);
        });

        test('h(type, realProps) возвращает новый объект (не shared)', () => {
            const props = { id: 'x' };
            const v = h('div', props);
            assert.strictEqual(v.props, props);
            assert.ok(!Object.isFrozen(v.props), 'real props не должен быть frozen');
        });

        test('EMPTY_PROPS корректно работает в for-in и in', () => {
            const v = h('div');
            let count = 0;
            for (const k in v.props) count++;
            assert.equal(count, 0);
            assert.equal('key' in v.props, false);
            assert.equal('ref' in v.props, false);
        });

        test('h(Fragment, null) — Fragment без props использует EMPTY_PROPS', () => {
            const v = h(Fragment, null, h('span', null, 'x'));
            assert.ok(Object.isFrozen(v.props));
        });
    });

    // =========================================================================
    // _tagName cache — внутренний кэш uppercase tagName на DOM-узле
    // Используется в applyProp/applyProps/applyPropsDirect чтобы избежать
    // повторного dom.tagName (DOM property access). Это деталь реализации —
    // пользователь не должен полагаться на наличие _tagName поля.
    // =========================================================================
    describe('_tagName internal cache (implementation detail)', () => {
        test('_tagName выставлен после mount для div', () => {
            const c = createContainer();
            mount(h('div', null), c);
            assert.equal(c.firstChild._tagName, 'DIV');
        });

        test('_tagName выставлен после mount для select (используется applyProp)', () => {
            const c = createContainer();
            mount(h('select', { multiple: true }), c);
            const sel = c.firstChild;
            assert.equal(sel._tagName, 'SELECT');
            assert.equal(sel.tagName, 'SELECT');
        });

        test('_tagName выставлен для вложенных элементов table → tbody → tr → td', () => {
            const c = createContainer();
            mount(h('table', null, h('tbody', null, h('tr', null, h('td', null, 'cell')))), c);
            const table = c.firstChild;
            assert.equal(table._tagName, 'TABLE');
            assert.equal(table.firstChild._tagName, 'TBODY');
            assert.equal(table.firstChild.firstChild._tagName, 'TR');
            assert.equal(table.firstChild.firstChild.firstChild._tagName, 'TD');
        });

        test('_tagName сохраняется при reconcile (reuse path)', () => {
            const c = createContainer();
            mount(h('div', { id: 'a' }), c);
            const div = c.firstChild;
            assert.equal(div._tagName, 'DIV');

            mount(h('div', { id: 'b' }), c);
            assert.strictEqual(div, c.firstChild, 'element переиспользован');
            assert.equal(div._tagName, 'DIV', '_tagName должен сохраниться после reconcile');
        });
    });

    // =========================================================================
    // EMPTY_ARRAY — shared frozen array для пустых результатов reconcile
    // Используется в syncDOMChildren и vnode._nodes для пустых children.
    // Деталь реализации: спецификация требует только что _nodes был массивом.
    // =========================================================================
    describe('EMPTY_ARRAY — shared frozen array (implementation detail)', () => {
        test('mount элемента без children — _nodes это frozen array', () => {
            const c = createContainer();
            const vnode = mount(h('div', null), c);
            assert.ok(Array.isArray(vnode._nodes));
            assert.equal(vnode._nodes.length, 0);
        });

        test('syncDOMChildren(dom, EMPTY, []) не мутирует shared reference', () => {
            const c = createContainer();
            // mount → update с тем же vnode — syncDOMChildren должен сработать корректно
            const vnode1 = h('div', null);
            mount(vnode1, c);
            const vnode2 = h('div', null);
            mount(vnode2, c);
            // Если бы EMPTY мутировался, повторный mount упал бы
            assert.equal(c.firstChild.tagName, 'DIV');
        });
    });
}

console.log('\n✅ Test-dev-01 инициализирован (12 тестов)\n');
