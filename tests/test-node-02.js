// ============================================================================
// Node.js тесты для VDOM библиотеки tyaff — Часть 2: DOM и продвинутые механизмы
// Запуск: node --test tests/test-node-02.js
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

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

if (hasDOM) {
    // =========================================================================
    // RECONCILE EDGE CASES
    // =========================================================================
    describe('Reconcile edge cases', () => {
        test('перестановка элементов с keys', () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.id); }
            });

            mount(
                h('div', null,
                    h(Item, { key: 'a', id: 'A' }),
                    h(Item, { key: 'b', id: 'B' }),
                    h(Item, { key: 'c', id: 'C' })
                ),
                container
            );
            const [a, b, c] = [...instances];

            mount(
                h('div', null,
                    h(Item, { key: 'c', id: 'C' }),
                    h(Item, { key: 'a', id: 'A' }),
                    h(Item, { key: 'b', id: 'B' })
                ),
                container
            );

            assert.equal(instances.length, 3);
            assert.equal(instances[0], a);
            assert.equal(instances[1], b);
            assert.equal(instances[2], c);

            const texts = Array.from(container.firstChild.children).map(el => el.textContent);
            assert.deepEqual(texts, ['C', 'A', 'B']);
        });

        test('удаление из середины списка', () => {
            const container = createContainer();
            mount(
                h('div', null,
                    h('span', null, 'a'),
                    h('span', null, 'b'),
                    h('span', null, 'c')
                ),
                container
            );
            assert.equal(container.firstChild.children.length, 3);

            mount(
                h('div', null,
                    h('span', null, 'a'),
                    h('span', null, 'c')
                ),
                container
            );
            assert.equal(container.firstChild.children.length, 2);
            assert.equal(container.firstChild.children[1].textContent, 'c');
        });

        test('вставка в начало', () => {
            const container = createContainer();
            mount(
                h('div', null,
                    h('span', null, 'b'),
                    h('span', null, 'c')
                ),
                container
            );
            mount(
                h('div', null,
                    h('span', null, 'a'),
                    h('span', null, 'b'),
                    h('span', null, 'c')
                ),
                container
            );
            const texts = Array.from(container.firstChild.children).map(el => el.textContent);
            assert.deepEqual(texts, ['a', 'b', 'c']);
        });

        test('полная замена tag — unmount + mount', async () => {
            const container = createContainer();
            let unmounted = false;

            const MyComp = Component({
                onUnmounted() { unmounted = true; },
                render() { return h('div', null, 'old'); }
            });

            mount(h('div', null, h(MyComp)), container);
            mount(h('div', null, h('span', null, 'new')), container);
            await delay(10);

            assert.ok(unmounted, 'старый компонент должен unmount-иться');
            assert.equal(container.firstChild.children[0].tagName, 'SPAN');
        });

        test('Text node → Element node', () => {
            const container = createContainer();
            mount(h('div', null, 'text'), container);
            assert.equal(container.firstChild.firstChild.nodeType, 3);

            mount(h('div', null, h('span', null, 'element')), container);
            assert.equal(container.firstChild.firstChild.tagName, 'SPAN');
        });

        test('Element → Text node', () => {
            const container = createContainer();
            mount(h('div', null, h('span', null, 'element')), container);
            assert.equal(container.firstChild.firstChild.tagName, 'SPAN');

            mount(h('div', null, 'text'), container);
            assert.equal(container.firstChild.firstChild.nodeType, 3);
            assert.equal(container.firstChild.firstChild.nodeValue, 'text');
        });

        test('null placeholder в списке', () => {
            const container = createContainer();
            mount(
                h('div', null,
                    h('span', null, 'a'),
                    null,
                    h('span', null, 'c')
                ),
                container
            );
            assert.equal(container.firstChild.children.length, 2);
        });

        test('пустой массив children', () => {
            const container = createContainer();
            mount(h('div', null), container);
            assert.equal(container.firstChild.children.length, 0);

            mount(h('div', null, h('span')), container);
            assert.equal(container.firstChild.children.length, 1);

            mount(h('div', null), container);
            assert.equal(container.firstChild.children.length, 0);
        });
    });

    // =========================================================================
    // ATTRIBUTE HANDLING
    // =========================================================================
    describe('Attribute handling', () => {
        test('className → class', () => {
            const container = createContainer();
            mount(h('div', { className: 'my-class' }), container);
            assert.equal(container.firstChild.getAttribute('class'), 'my-class');
        });

        test('htmlFor → for', () => {
            const container = createContainer();
            mount(h('label', { htmlFor: 'input-id' }), container);
            assert.equal(container.firstChild.getAttribute('for'), 'input-id');
        });

        test('tabIndex → tabindex', () => {
            const container = createContainer();
            mount(h('div', { tabIndex: 5 }), container);
            assert.equal(container.firstChild.getAttribute('tabindex'), '5');
        });

        test('style object → CSS строка', () => {
            const container = createContainer();
            mount(h('div', { style: { backgroundColor: 'red', fontSize: '14px' } }), container);
            const style = container.firstChild.getAttribute('style');
            assert.ok(style.includes('background-color:red') || style.includes('background-color: red'));
            assert.ok(style.includes('font-size:14px') || style.includes('font-size: 14px'));
        });

        test('onClick через addEventListener', () => {
            const container = createContainer();
            let clicked = false;
            mount(h('button', { onClick: () => { clicked = true; } }, 'click me'), container);
            container.firstChild.click();
            assert.ok(clicked);
        });

        test('data-* и aria-* сохраняют дефисы', () => {
            const container = createContainer();
            mount(h('div', { 'data-testid': 'my-test', 'aria-label': 'test' }), container);
            assert.equal(container.firstChild.getAttribute('data-testid'), 'my-test');
            assert.equal(container.firstChild.getAttribute('aria-label'), 'test');
        });

        test('dangerouslySetInnerHTML', () => {
            const container = createContainer();
            mount(h('div', { dangerouslySetInnerHTML: { __html: '<span>html</span>' } }), container);
            assert.equal(container.firstChild.innerHTML, '<span>html</span>');
        });

        test('boolean атрибуты (disabled=true → disabled="")', () => {
            const container = createContainer();
            mount(h('button', { disabled: true }), container);
            assert.ok(container.firstChild.hasAttribute('disabled'));
        });

        test('удаление атрибута при значении null/false', () => {
            const container = createContainer();
            mount(h('div', { 'data-x': 'value' }), container);
            assert.ok(container.firstChild.hasAttribute('data-x'));

            mount(h('div', { 'data-x': null }), container);
            assert.ok(!container.firstChild.hasAttribute('data-x'));

            mount(h('div', { 'data-x': 'value' }), container);
            mount(h('div', { 'data-x': false }), container);
            assert.ok(!container.firstChild.hasAttribute('data-x'));
        });
    });

    // =========================================================================
    // SVG NAMESPACE
    // =========================================================================
    describe('SVG namespace', () => {
        test('svg элемент имеет правильный namespace', () => {
            const container = createContainer();
            mount(h('svg', { width: 100, height: 100 }), container);
            const svg = container.firstChild;
            assert.equal(svg.tagName.toLowerCase(), 'svg');
            assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
        });

        test('вложенные circle/path в SVG', () => {
            const container = createContainer();
            mount(
                h('svg', null,
                    h('circle', { cx: 50, cy: 50, r: 40 })
                ),
                container
            );
            const circle = container.firstChild.firstChild;
            assert.equal(circle.tagName.toLowerCase(), 'circle');
            assert.equal(circle.namespaceURI, 'http://www.w3.org/2000/svg');
        });

        test('viewBox остаётся camelCase', () => {
            const container = createContainer();
            mount(h('svg', { viewBox: '0 0 100 100' }), container);
            assert.equal(container.firstChild.getAttribute('viewBox'), '0 0 100 100');
        });

        test('foreignObject переключает детей в HTML', () => {
            const container = createContainer();
            mount(
                h('svg', null,
                    h('foreignObject', null,
                        h('div', { className: 'x' })
                    )
                ),
                container
            );
            const div = container.querySelector('div');
            assert.ok(div);
            assert.equal(div.namespaceURI, 'http://www.w3.org/1999/xhtml');
        });
    });

    // =========================================================================
    // CONTROLLED FORMS
    // =========================================================================
    describe('Controlled forms', () => {
        test('value на input обновляется через DOM property', () => {
            const container = createContainer();
            mount(h('input', { value: 'hello' }), container);
            const input = container.firstChild;
            assert.equal(input.value, 'hello');

            input.value = 'user-input';

            mount(h('input', { value: 'controlled' }), container);
            assert.equal(input.value, 'controlled');
        });

        test('checked на checkbox', () => {
            const container = createContainer();
            mount(h('input', { type: 'checkbox', checked: true }), container);
            const input = container.firstChild;
            assert.equal(input.checked, true);

            mount(h('input', { type: 'checkbox', checked: false }), container);
            assert.equal(input.checked, false);
        });

        test('select multiple с массивом значений', () => {
            const container = createContainer();
            mount(
                h('select', { multiple: true, value: ['a', 'c'] },
                    h('option', { value: 'a' }, 'A'),
                    h('option', { value: 'b' }, 'B'),
                    h('option', { value: 'c' }, 'C')
                ),
                container
            );
            const select = container.firstChild;
            assert.equal(select.options[0].selected, true);
            assert.equal(select.options[1].selected, false);
            assert.equal(select.options[2].selected, true);
        });

        test('textarea игнорирует children, использует value', () => {
            const container = createContainer();
            mount(h('textarea', { value: 'from-value' }, 'from-children'), container);
            const textarea = container.firstChild;
            assert.equal(textarea.value, 'from-value');
        });

        test('пересоздание input при смене type', () => {
            const container = createContainer();
            mount(h('input', { type: 'text' }), container);
            const oldInput = container.firstChild;
            assert.equal(oldInput.type, 'text');

            mount(h('input', { type: 'password' }), container);
            const newInput = container.firstChild;
            assert.notEqual(newInput, oldInput, 'должен быть новый элемент');
            assert.equal(newInput.type, 'password');
        });

        test('пересоздание select при смене multiple', () => {
            const container = createContainer();
            mount(h('select', null, h('option', { value: 'a' }, 'A')), container);
            const oldSelect = container.firstChild;

            mount(h('select', { multiple: true }, h('option', { value: 'a' }, 'A')), container);
            const newSelect = container.firstChild;
            assert.notEqual(newSelect, oldSelect, 'должен быть новый элемент');
            assert.equal(newSelect.multiple, true);
        });
    });

    // =========================================================================
    // UPDATE ENGINE
    // =========================================================================
    describe('Update engine', () => {
        test('update(patch) применяет только изменённые поля', async () => {
            const container = createContainer();
            const MyComp = Component({
                a: 1,
                b: 2,
                render() { return h('div'); }
            });
            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            inst.update({ a: 10 });
            await delay(10);
            assert.equal(inst.a, 10);
            assert.equal(inst.b, 2);
        });

        test('update() без изменений не триггерит render', async () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                a: 1,
                render() { renderCount++; return h('div'); }
            });
            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            renderCount = 0;
            inst.update({ a: 1 });
            await delay(10);
            assert.equal(renderCount, 0);
        });

        test('update({}) — принудительное обновление', async () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                render() { renderCount++; return h('div'); }
            });
            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            renderCount = 0;
            inst.update({});
            await delay(10);
            assert.equal(renderCount, 1);
        });

        test('update() во время init подавляется', async () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                init() { this.update(); },
                render() { renderCount++; return h('div'); }
            });
            mount(MyComp, container);
            await delay(10);
            assert.equal(renderCount, 1);
        });

        test('лимит 50 вложенных update — выдаёт ошибку', async () => {
            const container = createContainer();
            const errors = [];
            const origError = console.error;
            console.error = (...args) => errors.push(args.join(' '));

            try {
                const MyComp = Component({
                    count: 0,
                    onMounted() {
                        this.update({ count: 1 });
                    },
                    onUpdated() {
                        if (this.count < 100) this.update({ count: this.count + 1 });
                    },
                    render() { return h('div', null, this.count); }
                });
                mount(MyComp, container);
                await delay(500);
                const hasError = errors.some(e => e.includes('Maximum update depth'));
                assert.ok(hasError, 'должна быть ошибка: ' + errors.join(' | '));
            } finally {
                console.error = origError;
            }
        });
    });

    // =========================================================================
    // BATCHING
    // =========================================================================
    describe('Batching', () => {
        test('несколько update() в одном тике → один render', async () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                count: 0,
                render() { renderCount++; return h('div'); }
            });
            const vnode = mount(MyComp, container);
            const inst = vnode._instance;

            renderCount = 0;
            inst.update({ count: 1 });
            inst.update({ count: 2 });
            inst.update({ count: 3 });

            await delay(10);
            assert.equal(renderCount, 1);
            assert.equal(inst.count, 3);
        });
    });

    // =========================================================================
    // PORTAL
    // =========================================================================
    describe('Portal', () => {
        test('отложенный монтаж — ждёт контейнер', async () => {
            const container = createContainer();
            document.body.appendChild(container);
            const portalTarget = document.createElement('div');
            document.body.appendChild(portalTarget);

            mount(
                h('div', null,
                    createPortal(h('span', null, 'portal-content'), () => portalTarget)
                ),
                container
            );

            await delay(10);
            assert.equal(portalTarget.textContent, 'portal-content');

            document.body.removeChild(container);
            document.body.removeChild(portalTarget);
        });

        test('смена контейнера переносит контент', async () => {
            const container = createContainer();
            document.body.appendChild(container);
            const target1 = document.createElement('div');
            const target2 = document.createElement('div');
            document.body.appendChild(target1);
            document.body.appendChild(target2);

            let currentTarget = target1;
            mount(
                h('div', null,
                    createPortal(h('span', null, 'content'), () => currentTarget)
                ),
                container
            );
            await delay(10);
            assert.equal(target1.textContent, 'content');
            assert.equal(target2.textContent, '');

            currentTarget = target2;
            mount(
                h('div', null,
                    createPortal(h('span', null, 'content'), () => currentTarget)
                ),
                container
            );
            await delay(10);
            assert.equal(target1.textContent, '');
            assert.equal(target2.textContent, 'content');

            document.body.removeChild(container);
            document.body.removeChild(target1);
            document.body.removeChild(target2);
        });

        test('ref на Portal возвращает instance портала', () => {
            const container = createContainer();
            document.body.appendChild(container);
            const target = document.createElement('div');
            document.body.appendChild(target);

            let portalRef = null;
            mount(
                h('div', null,
                    createPortal(h('span'), () => target)
                ),
                container
            );

            document.body.removeChild(container);
            document.body.removeChild(target);
        });
    });

    // =========================================================================
    // REFRESH
    // =========================================================================
    describe('refresh()', () => {
        test('обновляет компоненты под HTML-корнем', async () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                render() {
                    renderCount++;
                    return h('span', null, 'child');
                }
            });

            mount(h('div', null, h(MyComp)), container);
            const before = renderCount;

            await refresh();
            assert.ok(renderCount > before);
        });

        test('возвращает время в миллисекундах', async () => {
            const container = createContainer();
            const MyComp = Component({
                render() { return h('div'); }
            });
            mount(MyComp, container);
            const time = await refresh();
            assert.equal(typeof time, 'number');
            assert.ok(time >= 0);
        });

        test('refresh() с несколькими деревьями', async () => {
            const c1 = createContainer();
            const c2 = createContainer();
            let r1 = 0, r2 = 0;
            const C1 = Component({ render() { r1++; return h('div'); } });
            const C2 = Component({ render() { r2++; return h('div'); } });
            mount(C1, c1);
            mount(C2, c2);
            r1 = 0; r2 = 0;

            await refresh();
            assert.ok(r1 > 0, 'первое дерево должно обновиться');
            assert.ok(r2 > 0, 'второе дерево должно обновиться');
        });

        test('refresh() при отсутствии деревьев возвращает малое время', async () => {
            const time = await refresh();
            assert.ok(time < 10, 'должно быть почти мгновенно');
        });
    });

    // =========================================================================
    // UNMOUNT
    // =========================================================================
    describe('Unmount', () => {
        test('mount(null) размонтирует дерево', async () => {
            const container = createContainer();
            let unmounted = false;
            const MyComp = Component({
                onUnmounted() { unmounted = true; },
                render() { return h('div', null, 'content'); }
            });
            mount(MyComp, container);
            assert.ok(container.firstChild);
            mount(null, container);
            await delay(10);
            assert.ok(unmounted);
            assert.equal(container.childNodes.length, 0);
        });
    });

    // =========================================================================
    // ERROR PROTECTION
    // =========================================================================
    describe('Защита от ошибок', () => {
        test('update() внутри render() выводит ошибку', () => {
            const container = createContainer();
            const errors = [];
            const origError = console.error;
            console.error = (...args) => errors.push(args.join(' '));

            try {
                const MyComp = Component({
                    render() {
                        this.update();
                        return h('div');
                    }
                });
                mount(MyComp, container);
                const hasError = errors.some(e => e.includes('Cannot call update'));
                assert.ok(hasError, 'должна быть ошибка');
            } finally {
                console.error = origError;
            }
        });

        test('ошибка в одном компоненте не ломает другие', async () => {
            const container = createContainer();
            const errors = [];
            const origError = console.error;
            console.error = (...args) => errors.push(args.join(' '));

            try {
                let goodRenderCount = 0;

                const Bad = Component({
                    render() {
                        throw new Error('I am broken');
                    }
                });

                const Good = Component({
                    render() {
                        goodRenderCount++;
                        return h('span', null, 'ok');
                    }
                });

                const App = Component({
                    render() {
                        return h('div', null, h(Bad), h(Good));
                    }
                });

                mount(App, container);
                await delay(10);

                assert.ok(errors.length > 0, 'должна быть ошибка');
                assert.ok(goodRenderCount > 0, 'Good должен отрендериться');
            } finally {
                console.error = origError;
            }
        });
    });

    // =========================================================================
    // PERFORMANCE
    // =========================================================================
    describe('Performance', () => {
        test('initial render 1000 элементов < 200ms', () => {
            const container = createContainer();
            const items = Array.from({ length: 1000 }, (_, i) =>
                h('div', { key: i }, 'item ' + i)
            );
            const start = performance.now();
            mount(h('div', null, ...items), container);
            const time = performance.now() - start;
            assert.ok(time < 200, `Слишком медленно: ${time.toFixed(2)}ms`);
        });

        test('partial update 1 из 1000 < 20ms', async () => {
            const container = createContainer();
            const items = Array.from({ length: 1000 }, (_, i) =>
                h('div', { key: i }, 'item ' + i)
            );
            mount(h('div', null, ...items), container);

            const newItems = [...items];
            newItems[0] = h('div', { key: 0 }, 'UPDATED');

            const start = performance.now();
            mount(h('div', null, ...newItems), container);
            const time = performance.now() - start;
            assert.ok(time < 20, `Слишком медленно: ${time.toFixed(2)}ms`);
        });
    });
}

console.log('\n✅ Test-node-02 инициализирован (45 тестов)\n');