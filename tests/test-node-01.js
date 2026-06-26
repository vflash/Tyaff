// ============================================================================
// Node.js тесты для VDOM библиотеки tyaff — Часть 1
// Базовые возможности: h(), Component, lifecycle, reconciliation
// Запуск: node --test tests/test-node-01.js
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
    // h() — создание VDOM узлов
    // =========================================================================
    describe('h() — создание VDOM узлов', () => {
        test('создаёт vnode с tag, props, childs', () => {
            const vnode = h('div', { id: 'test' }, 'hello');
            assert.equal(vnode.tag, 'div');
            assert.deepEqual(vnode.props, { id: 'test' });
            assert.equal(vnode.childs.length, 1);
            assert.equal(vnode.childs[0]._text, 'hello');
        });

        test('null props становится пустым объектом', () => {
            const vnode = h('div', null, 'text');
            assert.deepEqual(vnode.props, {});
        });

        test('null/undefined/false в children игнорируются', () => {
            const vnode = h('div', null, null, undefined, false, 'text');
            assert.equal(vnode.childs.length, 4);
            assert.equal(vnode.childs[0], null);
            assert.equal(vnode.childs[1], null);
            assert.equal(vnode.childs[2], null);
            assert.equal(vnode.childs[3]._text, 'text');
        });

        test('числа преобразуются в текстовые узлы', () => {
            const vnode = h('div', null, 42);
            assert.equal(vnode.childs[0]._text, '42');
        });

        test('массивы в children не flattening-уются', () => {
            const arr = [h('span'), h('span')];
            const vnode = h('div', null, arr);
            assert.equal(vnode.childs.length, 1);
            assert.ok(Array.isArray(vnode.childs[0]));
            assert.equal(vnode.childs[0].length, 2);
        });

        test('вложенные vnode', () => {
            const vnode = h('div', null,
                h('span', null, 'a'),
                h('span', null, 'b')
            );
            assert.equal(vnode.childs.length, 2);
            assert.equal(vnode.childs[0].tag, 'span');
            assert.equal(vnode.childs[1].tag, 'span');
        });
    });

    // =========================================================================
    // Component factory
    // =========================================================================
    describe('Component factory', () => {
        test('создаёт конструктор с _definition', () => {
            const MyComp = Component({
                render() { return h('div'); }
            });
            assert.ok(MyComp._definition);
            assert.equal(typeof MyComp._definition.render, 'function');
        });

        test('копирует свойства на instance', () => {
            const MyComp = Component({
                count: 5,
                name: 'test',
                render() { return h('div'); }
            });
            const inst = new MyComp();
            assert.equal(inst.count, 5);
            assert.equal(inst.name, 'test');
        });

        test('методы автобиндятся к instance', () => {
            const MyComp = Component({
                value: 10,
                getValue() { return this.value; },
                render() { return h('div'); }
            });
            const inst = new MyComp();
            const fn = inst.getValue;
            assert.equal(fn(), 10);
        });
    });

    // =========================================================================
    // mount — базовые возможности
    // =========================================================================
    describe('mount — базовые возможности', () => {
        test('монтирует простой HTML-элемент', () => {
            const container = createContainer();
            mount(h('div', { id: 'test' }, 'hello'), container);
            assert.equal(container.children.length, 1);
            assert.equal(container.children[0].tagName, 'DIV');
            assert.equal(container.children[0].id, 'test');
            assert.equal(container.children[0].textContent, 'hello');
        });

        test('монтирует компонент', () => {
            const container = createContainer();
            const MyComp = Component({
                render() { return h('div', null, 'component'); }
            });
            mount(MyComp, container);
            assert.equal(container.children.length, 1);
            assert.equal(container.textContent, 'component');
        });

        test('монтирует массив vnode', () => {
            const container = createContainer();
            mount([h('span', null, 'a'), h('span', null, 'b')], container);
            assert.equal(container.children.length, 2);
            assert.equal(container.children[0].textContent, 'a');
            assert.equal(container.children[1].textContent, 'b');
        });

        test('монтирует строку как текстовый узел', () => {
            const container = createContainer();
            mount('hello', container);
            assert.equal(container.textContent, 'hello');
        });

        test('монтирует число как текстовый узел', () => {
            const container = createContainer();
            mount(42, container);
            assert.equal(container.textContent, '42');
        });

        test('повторный mount с тем же vnode — diff', () => {
            const container = createContainer();
            mount(h('div', null, 'a'), container);
            assert.equal(container.textContent, 'a');
            mount(h('div', null, 'b'), container);
            assert.equal(container.textContent, 'b');
            assert.equal(container.children.length, 1);
        });

        test('mount(null) размонтирует дерево', () => {
            const container = createContainer();
            mount(h('div', null, 'hello'), container);
            assert.equal(container.children.length, 1);
            mount(null, container);
            assert.equal(container.children.length, 0);
        });
    });

    // =========================================================================
    // Lifecycle hooks
    // =========================================================================
    describe('Lifecycle hooks', () => {
        test('init() вызывается один раз при первом mount', async () => {
            const container = createContainer();
            let initCount = 0;

            const MyComp = Component({
                init() { initCount++; },
                render() { return h('div'); }
            });

            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            assert.equal(initCount, 1);

            inst.update({});
            await delay(10);
            assert.equal(initCount, 1, 'init не должен вызываться повторно');
        });

        test('onMounted() вызывается после вставки в DOM', async () => {
            const container = createContainer();
            let mounted = false;

            const MyComp = Component({
                onMounted() { mounted = true; },
                render() { return h('div'); }
            });

            mount(MyComp, container);
            assert.equal(mounted, true);
        });

        test('onMounted() вызывается children-first', async () => {
            const container = createContainer();
            const order = [];

            const Child = Component({
                onMounted() { order.push('child'); },
                render() { return h('span'); }
            });

            const Parent = Component({
                onMounted() { order.push('parent'); },
                render() { return h('div', null, h(Child)); }
            });

            mount(Parent, container);
            await delay(10);
            assert.deepEqual(order, ['child', 'parent']);
        });

        test('onUpdated() вызывается при update', async () => {
            const container = createContainer();
            let updateCount = 0;

            const MyComp = Component({
                value: 0,
                onUpdated() { updateCount++; },
                render() { return h('div', null, this.value); }
            });

            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            assert.equal(updateCount, 0, 'onUpdated не вызывается при первом mount');

            inst.update({ value: 1 });
            await delay(10);
            assert.equal(updateCount, 1);
        });

        test('onUnmounted() вызывается при удалении', async () => {
            const container = createContainer();
            let unmounted = false;

            const MyComp = Component({
                onUnmounted() { unmounted = true; },
                render() { return h('div'); }
            });

            mount(MyComp, container);
            assert.equal(unmounted, false);
            mount(null, container);
            assert.equal(unmounted, true);
        });
    });

    // =========================================================================
    // Props
    // =========================================================================
    describe('Props', () => {
        test('props передаются в render', () => {
            const container = createContainer();
            const MyComp = Component({
                render(props) { return h('div', null, props.text); }
            });
            mount(h(MyComp, { text: 'hello' }), container);
            assert.equal(container.textContent, 'hello');
        });

        test('props() функция трансформирует входящие props', () => {
            const container = createContainer();
            const MyComp = Component({
                props(incoming) {
                    return { text: incoming.text.toUpperCase() };
                },
                render() { return h('div', null, this.props.text); }
            });
            mount(h(MyComp, { text: 'hello' }), container);
            assert.equal(container.textContent, 'HELLO');
        });

        test('children доступны через this.props.children', () => {
            const container = createContainer();
            const MyComp = Component({
                render() {
                    return h('div', { id: 'wrapper' }, this.props.children);
                }
            });
            mount(h(MyComp, null, h('span', null, 'child')), container);
            const wrapper = container.querySelector('#wrapper');
            assert.equal(wrapper.children.length, 1);
            assert.equal(wrapper.children[0].tagName, 'SPAN');
            assert.equal(wrapper.children[0].textContent, 'child');
        });
    });

    // =========================================================================
    // Reconciliation
    // =========================================================================
    describe('Reconciliation', () => {
        test('изменение текста обновляет DOM-узел', () => {
            const container = createContainer();
            mount(h('div', null, 'old'), container);
            const div = container.firstChild;
            mount(h('div', null, 'new'), container);
            assert.equal(container.firstChild, div, 'тот же DOM-узел');
            assert.equal(div.textContent, 'new');
        });

        test('изменение tag пересоздаёт элемент', () => {
            const container = createContainer();
            mount(h('div', null, 'text'), container);
            const div = container.firstChild;
            mount(h('span', null, 'text'), container);
            assert.notEqual(container.firstChild, div, 'новый DOM-узел');
            assert.equal(container.firstChild.tagName, 'SPAN');
        });

        test('изменение атрибутов обновляет элемент', () => {
            const container = createContainer();
            mount(h('div', { id: 'a', class: 'old' }), container);
            const div = container.firstChild;
            mount(h('div', { id: 'b', class: 'new' }), container);
            assert.equal(container.firstChild, div, 'тот же DOM-узел');
            assert.equal(div.id, 'b');
            assert.equal(div.className, 'new');
        });

        test('удаление атрибутов при отсутствии в новых props', () => {
            const container = createContainer();
            mount(h('div', { id: 'a', title: 'hello' }), container);
            const div = container.firstChild;
            mount(h('div', { id: 'b' }), container);
            assert.equal(div.id, 'b');
            assert.equal(div.hasAttribute('title'), false);
        });
    });

    // =========================================================================
    // Fragment
    // =========================================================================
    describe('Fragment', () => {
        test('Fragment без key — прозрачная обёртка', () => {
            const container = createContainer();
            mount(
                h('div', null,
                    h(Fragment, null,
                        h('span', null, 'a'),
                        h('span', null, 'b')
                    )
                ),
                container
            );
            const div = container.firstChild;
            assert.equal(div.children.length, 2);
            assert.equal(div.children[0].textContent, 'a');
            assert.equal(div.children[1].textContent, 'b');
        });

        test('Fragment как корень mount', () => {
            const container = createContainer();
            mount(
                h(Fragment, null,
                    h('span', null, 'a'),
                    h('span', null, 'b')
                ),
                container
            );
            assert.equal(container.children.length, 2);
            assert.equal(container.children[0].textContent, 'a');
            assert.equal(container.children[1].textContent, 'b');
        });

        test('Fragment с key сохраняет children при reorder', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('span', null, props.id); }
            });

            const App = Component({
                order: [1, 2, 3],
                render() {
                    return h(Fragment, { key: 'group' },
                        ...this.order.map(id => h(Item, { key: id, id }))
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 3);

            app.update({ order: [3, 1, 2] });
            await delay(10);

            assert.equal(instances.length, 3, 'instance не должны пересоздаваться');
        });
    });

    // =========================================================================
    // Keys — базовое поведение
    // =========================================================================
    describe('Keys — базовое поведение', () => {
        test('элементы с key сохраняются при reorder', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.id); }
            });

            const App = Component({
                order: [1, 2, 3],
                render() {
                    return h('div', null,
                        this.order.map(id => h(Item, { key: id, id }))
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 3);

            app.update({ order: [3, 1, 2] });
            await delay(10);

            assert.equal(instances.length, 3, 'instance не должны пересоздаваться');
        });

        test('key позволяет перемещать элемент между родителями внутри render', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.id); }
            });

            const App = Component({
                position: 'left',
                render() {
                    return h('div', null,
                        h('div', { id: 'left' },
                            this.position === 'left' && h(Item, { key: 'movable', id: 'item' })
                        ),
                        h('div', { id: 'right' },
                            this.position === 'right' && h(Item, { key: 'movable', id: 'item' })
                        )
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 1);
            const firstInstance = instances[0];

            app.update({ position: 'right' });
            await delay(10);

            assert.equal(instances.length, 1, 'instance не должен пересоздаваться');
            assert.equal(instances[0], firstInstance, 'тот же instance после перемещения');
        });

        test('добавление элемента в конец списка с key', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.id); }
            });

            const App = Component({
                items: ['a', 'b'],
                render() {
                    return h('div', null,
                        ...this.items.map(id => h(Item, { key: id, id }))
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 2);
            const [instA, instB] = [...instances];

            // Добавляем элемент в КОНЕЦ
            app.update({ items: ['a', 'b', 'c'] });
            await delay(10);

            assert.equal(instances.length, 3);
            assert.equal(instances[0], instA, 'a сохранён');
            assert.equal(instances[1], instB, 'b сохранён');
        });

        test('удаление элемента из середины списка с key', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.id); }
            });

            const App = Component({
                items: ['a', 'b', 'c'],
                render() {
                    return h('div', null,
                        ...this.items.map(id => h(Item, { key: id, id }))
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 3);
            const [instA, instB, instC] = [...instances];

            // Удаляем 'b' из середины
            app.update({ items: ['a', 'c'] });
            await delay(10);

            // instance 'a' и 'c' сохранены, 'b' остался в массиве instances но больше не рендерится
            assert.equal(instances.length, 3, 'instance не пересоздавались');
            assert.equal(instances[0], instA, 'a сохранён');
            assert.equal(instances[2], instC, 'c сохранён');
        });
    });

    // =========================================================================
    // Refresh
    // =========================================================================
    describe('refresh()', () => {
        test('обновляет все корневые компоненты', async () => {
            const container = createContainer();
            let renderCount = 0;

            const MyComp = Component({
                render() { renderCount++; return h('div'); }
            });

            mount(MyComp, container);
            renderCount = 0;

            await refresh();
            assert.ok(renderCount > 0, 'render должен выполниться');
        });

        test('возвращает время выполнения', async () => {
            const container = createContainer();
            const MyComp = Component({
                render() { return h('div'); }
            });

            mount(MyComp, container);
            const time = await refresh();
            assert.equal(typeof time, 'number');
            assert.ok(time >= 0);
        });
    });
}

console.log('\n✅ Test-node-01 инициализирован\n');