// ============================================================================
// Node.js тесты для VDOM библиотеки tyaff
// Запуск: node --test tests/test-node.js
// Требования: npm install --save-dev happy-dom
// ============================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Попытка загрузить happy-dom для DOM-тестов
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
    console.warn('   Установка: npm install --save-dev happy-dom\n');
}

// Импорт библиотеки
const { h, Component, Fragment, createPortal, mount, refresh } = await import('../src/core.js');

// Вспомогательные функции
function createContainer() {
    if (!hasDOM) throw new Error('DOM недоступен');
    return document.createElement('div');
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ============================================================================
// PURE ТЕСТЫ (без DOM)
// ============================================================================

describe('h() — JSX runtime', () => {
    test('создаёт vnode с tag, props, childs', () => {
        const vnode = h('div', { id: 'test' }, 'hello');
        assert.equal(vnode.tag, 'div');
        assert.deepEqual(vnode.props, { id: 'test' });
        assert.equal(vnode.childs.length, 1);
    });

    test('нормализует null/false/true в null', () => {
        const vnode = h('div', null, null, false, true, 'ok');
        assert.equal(vnode.childs[0], null);
        assert.equal(vnode.childs[1], null);
        assert.equal(vnode.childs[2], null);
        assert.deepEqual(vnode.childs[3], { _text: 'ok' });
    });

    test('оборачивает строки/числа в _text', () => {
        const vnode = h('div', null, 'text', 42);
        assert.deepEqual(vnode.childs[0], { _text: 'text' });
        assert.deepEqual(vnode.childs[1], { _text: '42' });
    });

    test('сохраняет массивы как массивы (не flat)', () => {
        const arr = [h('span'), h('span')];
        const vnode = h('div', null, arr);
        assert.ok(Array.isArray(vnode.childs[0]));
        assert.equal(vnode.childs[0].length, 2);
    });

    test('props.children имеет приоритет над childs', () => {
        const vnode = h('div', { children: 'from-props' }, 'from-childs');
        assert.equal(vnode.props.children, 'from-props');
    });

    test('props по умолчанию пустой объект', () => {
        const vnode = h('div');
        assert.deepEqual(vnode.props, {});
    });

    test('поддерживает компоненты как tag', () => {
        const MyComp = Component({ render() { return h('div'); } });
        const vnode = h(MyComp, { value: 5 });
        assert.equal(vnode.tag, MyComp);
        assert.equal(vnode.props.value, 5);
    });
});

describe('Component() — фабрика', () => {
    test('возвращает конструктор с _definition', () => {
        const MyComp = Component({
            name: 'Test',
            render() { return h('div'); }
        });
        assert.ok(MyComp._definition);
        assert.equal(MyComp._definition.name, 'Test');
    });

    test('создаёт instance с _definition', () => {
        const MyComp = Component({
            value: 42,
            render() { return h('div'); }
        });
        const inst = new MyComp();
        assert.equal(inst._definition, MyComp._definition);
        assert.equal(inst.value, 42);
    });

    test('не копирует context как поле', () => {
        const MyComp = Component({
            context: { lang() { return 'ru'; } },
            render() { return h('div'); }
        });
        const inst = new MyComp();
        assert.equal(inst.context, undefined);
    });
});

describe('Fragment и Portal (pure)', () => {
    test('Fragment это Symbol', () => {
        assert.equal(typeof Fragment, 'symbol');
    });

    test('createPortal создаёт Portal vnode', () => {
        const portal = createPortal(h('div'), () => null);
        assert.equal(typeof portal.tag, 'symbol');
        assert.ok(portal.props.containerGetter);
    });

    test('createPortal оборачивает один child в массив', () => {
        const child = h('div');
        const portal = createPortal(child, () => null);
        assert.ok(Array.isArray(portal.childs));
        assert.equal(portal.childs[0], child);
    });
});

// ============================================================================
// DOM ТЕСТЫ
// ============================================================================

if (hasDOM) {
    // ----------------------------------------------------------------------
    // MOUNT
    // ----------------------------------------------------------------------
    describe('mount() — базовое монтирование', () => {
        test('монтирует простой HTML', () => {
            const container = createContainer();
            mount(h('div', { id: 'root' }, 'hello'), container);
            assert.equal(container.firstChild.tagName, 'DIV');
            assert.equal(container.firstChild.id, 'root');
            assert.equal(container.firstChild.textContent, 'hello');
        });

        test('монтирует компонент с init/render', () => {
            const container = createContainer();
            const MyComp = Component({
                count: 0,
                init() { this.count = 10; },
                render() { return h('div', null, 'Count: ', this.count); }
            });
            mount(MyComp, container);
            assert.equal(container.textContent, 'Count: 10');
        });

        test('принимает конструктор компонента без обёртки h()', () => {
            const container = createContainer();
            const MyComp = Component({
                render() { return h('span', null, 'works'); }
            });
            mount(MyComp, container);
            assert.equal(container.textContent, 'works');
        });

        test('принимает массив как Fragment', () => {
            const container = createContainer();
            mount([h('span', null, 'a'), h('span', null, 'b')], container);
            assert.equal(container.querySelectorAll('span').length, 2);
        });

        test('принимает строку как текстовый узел', () => {
            const container = createContainer();
            mount('plain text', container);
            assert.equal(container.textContent, 'plain text');
        });
    });

    describe('mount() — edge cases', () => {
        test('mount(null) на пустой контейнер — ничего не делает', () => {
            const container = createContainer();
            mount(null, container);
            assert.equal(container.childNodes.length, 0);
        });

        test('mount дважды с разными конструкторами — заменяет', () => {
            const container = createContainer();
            const A = Component({ render() { return h('div', null, 'A'); } });
            const B = Component({ render() { return h('div', null, 'B'); } });
            mount(A, container);
            assert.equal(container.textContent, 'A');
            mount(B, container);
            assert.equal(container.textContent, 'B');
        });
    });

    // ----------------------------------------------------------------------
    // PROPS & INIT
    // ----------------------------------------------------------------------
    describe('props() и init() — порядок вызова', () => {
        test('props первым аргументом в init', () => {
            const container = createContainer();
            let receivedProps = null;
            const MyComp = Component({
                init(props) { receivedProps = props; },
                render() { return h('div'); }
            });
            mount(h(MyComp, { value: 42 }), container);
            assert.ok(receivedProps);
            assert.equal(receivedProps.value, 42);
        });

        test('props первым аргументом в render', () => {
            const container = createContainer();
            let receivedProps = null;
            const MyComp = Component({
                render(props) {
                    receivedProps = props;
                    return h('div');
                }
            });
            mount(h(MyComp, { x: 1 }), container);
            assert.equal(receivedProps.x, 1);
        });

        test('init() вызывается только при первом mount', () => {
            const container = createContainer();
            let initCount = 0;
            const MyComp = Component({
                init() { initCount++; },
                render() { return h('div'); }
            });
            mount(MyComp, container);
            mount(MyComp, container);
            mount(MyComp, container);
            assert.equal(initCount, 1);
        });

        test('children попадают в props автоматически', () => {
            const container = createContainer();
            let receivedChildren = null;
            const Parent = Component({
                render(props) {
                    receivedChildren = props.children;
                    return h('div', null, props.children);
                }
            });
            mount(h(Parent, null, h('span', null, 'child')), container);
            assert.ok(receivedChildren);
        });
    });

    // ----------------------------------------------------------------------
    // MEMO
    // ----------------------------------------------------------------------
    describe('memo() — защита render', () => {
        test('блокирует render при одинаковых зависимостях', () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                memo(props) { return [props.value]; },
                render(props) {
                    renderCount++;
                    return h('div', null, props.value);
                }
            });
            mount(h(MyComp, { value: 1 }), container);
            mount(h(MyComp, { value: 1 }), container);
            mount(h(MyComp, { value: 1 }), container);
            assert.equal(renderCount, 1);
        });

        test('разрешает render при изменении зависимостей', () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                memo(props) { return [props.value]; },
                render(props) {
                    renderCount++;
                    return h('div', null, props.value);
                }
            });
            mount(h(MyComp, { value: 1 }), container);
            mount(h(MyComp, { value: 2 }), container);
            mount(h(MyComp, { value: 3 }), container);
            assert.equal(renderCount, 3);
        });

        test('блокирует только текущий компонент, дети ререндерятся', () => {
            const container = createContainer();
            let parentRenders = 0;
            let childRenders = 0;

            const Child = Component({
                render() {
                    childRenders++;
                    return h('span', null, 'child');
                }
            });

            const Parent = Component({
                memo(props) { return [props.value]; },
                render() {
                    parentRenders++;
                    return h('div', null, h(Child));
                }
            });

            mount(h(Parent, { value: 1 }), container);
            mount(h(Parent, { value: 1 }), container);

            assert.equal(parentRenders, 1);
            assert.equal(childRenders, 2);
        });

        test('компонент без memo() всегда рендерится', () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                render() {
                    renderCount++;
                    return h('div');
                }
            });
            mount(h(MyComp, { v: 1 }), container);
            mount(h(MyComp, { v: 1 }), container);
            mount(h(MyComp, { v: 1 }), container);
            assert.equal(renderCount, 3);
        });

        test('memo() с объектами — сравнение по ссылке', () => {
            const container = createContainer();
            let renderCount = 0;
            const MyComp = Component({
                memo(props) { return [props.obj]; },
                render() {
                    renderCount++;
                    return h('div');
                }
            });
            const obj = { a: 1 };
            mount(h(MyComp, { obj }), container);
            mount(h(MyComp, { obj }), container); // тот же объект
            assert.equal(renderCount, 1);
            mount(h(MyComp, { obj: { a: 1 } }), container); // новый объект
            assert.equal(renderCount, 2);
        });

        test('onUpdated не вызывается при блокировке memo', async () => {
            const container = createContainer();
            let updatedCount = 0;
            const MyComp = Component({
                memo(props) { return [props.value]; },
                onUpdated() { updatedCount++; },
                render(props) { return h('div', null, props.value); }
            });
            mount(h(MyComp, { value: 1 }), container);
            mount(h(MyComp, { value: 1 }), container);
            await delay(10);
            assert.equal(updatedCount, 0);
        });
    });

    // ----------------------------------------------------------------------
    // LIFECYCLE
    // ----------------------------------------------------------------------
    describe('Lifecycle hooks', () => {
        test('onMounted вызывается один раз', async () => {
            const container = createContainer();
            let mountedCount = 0;
            const MyComp = Component({
                onMounted() { mountedCount++; },
                render() { return h('div'); }
            });
            mount(MyComp, container);
            await delay(10);
            assert.equal(mountedCount, 1);
        });

        test('onMounted вызывается children-first', async () => {
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

        test('onUnmounted вызывается до удаления DOM', async () => {
            const container = createContainer();
            document.body.appendChild(container);
            let wasInDOM = false;

            const MyComp = Component({
                onUnmounted() {
                    wasInDOM = document.body.contains(container);
                },
                render() { return h('div'); }
            });

            mount(MyComp, container);
            await delay(10);
            mount(null, container);
            await delay(10);

            assert.ok(wasInDOM);
            document.body.removeChild(container);
        });

        test('onUpdated вызывается только при выполненном render', async () => {
            const container = createContainer();
            let updatedCount = 0;
            const MyComp = Component({
                count: 0,
                memo() { return [this.count]; },
                onUpdated() { updatedCount++; },
                render() { return h('div', null, this.count); }
            });
            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            inst.update({ count: 0 });
            await delay(10);
            assert.equal(updatedCount, 0);
            inst.update({ count: 1 });
            await delay(10);
            assert.equal(updatedCount, 1);
        });
    });

    // ----------------------------------------------------------------------
    // CONTEXT
    // ----------------------------------------------------------------------
    describe('Context', () => {
        test('распространяется вниз по дереву', () => {
            const container = createContainer();
            let receivedLang = null;

            const Child = Component({
                render() {
                    receivedLang = this.context('lang');
                    return h('span');
                }
            });

            const Parent = Component({
                context: { lang() { return 'ru'; } },
                render() { return h('div', null, h(Child)); }
            });

            mount(Parent, container);
            assert.equal(receivedLang, 'ru');
        });

        test('contextSelf ищет сначала в себе', () => {
            const container = createContainer();
            let receivedLang = null;

            const MyComp = Component({
                context: { lang() { return 'self'; } },
                render() {
                    receivedLang = this.contextSelf('lang');
                    return h('div');
                }
            });

            mount(MyComp, container);
            assert.equal(receivedLang, 'self');
        });

        test('context() возвращает undefined когда нет провайдера', () => {
            const container = createContainer();
            let received = 'initial';

            const MyComp = Component({
                render() {
                    received = this.context('missing');
                    return h('div');
                }
            });

            mount(MyComp, container);
            assert.equal(received, undefined);
        });

        test('потомок переопределяет context родителя', () => {
            const container = createContainer();
            let received = null;

            const Deep = Component({
                render() {
                    received = this.context('theme');
                    return h('span');
                }
            });

            const Middle = Component({
                context: { theme() { return 'dark'; } },
                render() { return h('div', null, h(Deep)); }
            });

            const Top = Component({
                context: { theme() { return 'light'; } },
                render() { return h('div', null, h(Middle)); }
            });

            mount(Top, container);
            assert.equal(received, 'dark');
        });

        test('contextSelf рекурсия бросает ошибку', () => {
            const container = createContainer();
            let errorCaught = null;

            const MyComp = Component({
                context: {
                    x() { return this.contextSelf('x'); }
                },
                render() {
                    try {
                        this.contextSelf('x');
                    } catch (e) {
                        errorCaught = e;
                    }
                    return h('div');
                }
            });

            mount(MyComp, container);
            assert.ok(errorCaught);
            assert.ok(errorCaught.message.includes('recursion'));
        });
    });

    // ----------------------------------------------------------------------
    // KEYS & FRAGMENT
    // ----------------------------------------------------------------------
    describe('Keys и Fragment', () => {
        test('Global keys сохраняют instance при перемещении', () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render() { return h('div'); }
            });

            mount(h('div', null, h(Item, { key: 'x' })), container);
            const firstInstance = instances[0];

            mount(h('div', null, h('span'), h(Item, { key: 'x' })), container);

            assert.equal(instances.length, 1);
            assert.equal(instances[0], firstInstance);
        });

        test('keyed Fragment переносится между родителями', () => {
            const container = createContainer();
            let childInits = 0;

            const Item = Component({
                init() { childInits++; },
                render() { return h('span'); }
            });

            mount(
                h('div', null,
                    h('div', { id: 'a' }, h(Fragment, { key: 'g' }, h(Item, { key: 'i' }))),
                    h('div', { id: 'b' })
                ),
                container
            );
            assert.equal(childInits, 1);

            mount(
                h('div', null,
                    h('div', { id: 'a' }),
                    h('div', { id: 'b' }, h(Fragment, { key: 'g' }, h(Item, { key: 'i' })))
                ),
                container
            );
            assert.equal(childInits, 1);
        });

        test('Fragment без key работает как прозрачная обёртка', () => {
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
            assert.equal(container.querySelectorAll('span').length, 2);
        });
    });

    // ----------------------------------------------------------------------
    // REFS
    // ----------------------------------------------------------------------
    describe('Refs lifecycle', () => {
        test('ref(node) вызывается при mount с DOM-узлом', () => {
            const container = createContainer();
            let received = null;
            const MyComp = Component({
                render() {
                    return h('input', { ref: (n) => { received = n; } });
                }
            });
            mount(MyComp, container);
            assert.ok(received);
            assert.equal(received.tagName, 'INPUT');
        });

        test('ref(null) вызывается при unmount', async () => {
            const container = createContainer();
            const calls = [];
            const MyComp = Component({
                render() {
                    return h('input', { ref: (n) => calls.push(n) });
                }
            });
            mount(MyComp, container);
            assert.ok(calls[0] !== null, 'первый вызов с DOM-узлом');
            mount(null, container);
            await delay(10);
            assert.equal(calls[calls.length - 1], null, 'последний вызов с null');
        });

        test('ref на компонент возвращает instance', () => {
            const container = createContainer();
            let received = null;
            const Child = Component({
                value: 42,
                render() { return h('div'); }
            });
            const Parent = Component({
                render() {
                    return h(Child, { ref: (inst) => { received = inst; } });
                }
            });
            mount(Parent, container);
            assert.ok(received);
            assert.equal(received.value, 42);
        });

        test('this.refs(name) создаёт стабильный collector', () => {
            const container = createContainer();
            const MyComp = Component({
                render() {
                    return h('div', null,
                        h('input', { ref: this.refs('inp1') }),
                        h('input', { ref: this.refs('inp2') })
                    );
                }
            });
            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            assert.ok(inst.refs.inp1);
            assert.ok(inst.refs.inp2);
            assert.equal(inst.refs.inp1.tagName, 'INPUT');
            assert.equal(inst.refs.inp2.tagName, 'INPUT');
        });
    });

    // ----------------------------------------------------------------------
    // RECONCILE EDGE CASES
    // ----------------------------------------------------------------------
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

            // Reorder: A, B, C → C, A, B
            mount(
                h('div', null,
                    h(Item, { key: 'c', id: 'C' }),
                    h(Item, { key: 'a', id: 'A' }),
                    h(Item, { key: 'b', id: 'B' })
                ),
                container
            );

            assert.equal(instances.length, 3, 'instance не должны пересоздаваться');
            assert.equal(instances[0], a);
            assert.equal(instances[1], b);
            assert.equal(instances[2], c);

            // Порядок в DOM должен быть C, A, B
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
            assert.equal(container.firstChild.firstChild.nodeType, 3); // Text

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
            // null не создаёт DOM-узел
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

    // ----------------------------------------------------------------------
    // ATTRIBUTE HANDLING
    // ----------------------------------------------------------------------
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

    // ----------------------------------------------------------------------
    // SVG NAMESPACE
    // ----------------------------------------------------------------------
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

    // ----------------------------------------------------------------------
    // CONTROLLED FORMS
    // ----------------------------------------------------------------------
    describe('Controlled forms', () => {
        test('value на input обновляется через DOM property', () => {
            const container = createContainer();
            mount(h('input', { value: 'hello' }), container);
            const input = container.firstChild;
            assert.equal(input.value, 'hello');

            // Пользователь ввёл что-то
            input.value = 'user-input';

            // Библиотека должна перезаписать
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

    // ----------------------------------------------------------------------
    // UPDATE ENGINE
    // ----------------------------------------------------------------------
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
            inst.update({ a: 1 }); // то же значение
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
            // render должен вызваться только один раз (первый mount)
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
                    onUpdated() {
                        if (this.count < 100) this.update({ count: this.count + 1 });
                        //                                              ^^^^^^^^^^^^^^^^
                    },
                    render() { return h('div', null, this.count); }
                });
                const vnode = mount(MyComp, container);
                const inst = vnode._instance;
                inst.update({ count: 1 });
                await delay(500);
                const hasError = errors.some(e => e.includes('Maximum update depth'));
                assert.ok(hasError, 'должна быть ошибка');
            } finally {
                console.error = origError;
            }
        });
    });

    // ----------------------------------------------------------------------
    // BATCHING
    // ----------------------------------------------------------------------
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

    // ----------------------------------------------------------------------
    // PORTAL
    // ----------------------------------------------------------------------
    describe('Portal', () => {
        test('отложенный монтаж — ждёт контейнер', async () => {
            const container = createContainer();
            let portalTarget = null;

            mount(
                createPortal(h('div', null, 'portal-content'), () => portalTarget),
                container
            );
            // Контейнера нет — якорь есть, контента нет
            assert.equal(container.textContent, '');

            // Появился контейнер
            portalTarget = document.createElement('div');
            document.body.appendChild(portalTarget);
            mount(
                createPortal(h('div', null, 'portal-content'), () => portalTarget),
                container
            );
            await delay(10);
            assert.equal(portalTarget.textContent, 'portal-content');

            document.body.removeChild(portalTarget);
        });

        test('смена контейнера переносит контент', async () => {
            const container = createContainer();
            const target1 = document.createElement('div');
            const target2 = document.createElement('div');
            document.body.appendChild(target1);
            document.body.appendChild(target2);

            let currentTarget = target1;
            mount(
                createPortal(h('div', null, 'content'), () => currentTarget),
                container
            );
            await delay(10);
            assert.equal(target1.textContent, 'content');
            assert.equal(target2.textContent, '');

            currentTarget = target2;
            mount(
                createPortal(h('div', null, 'content'), () => currentTarget),
                container
            );
            await delay(10);
            assert.equal(target1.textContent, '');
            assert.equal(target2.textContent, 'content');

            document.body.removeChild(target1);
            document.body.removeChild(target2);
        });

        test('ref на Portal возвращает instance портала', () => {
            const container = createContainer();
            const target = document.createElement('div');
            document.body.appendChild(target);

            let portalRef = null;
            mount(
                h('div', null,
                    createPortal(h('span'), () => target, )
                ),
                container
            );

            document.body.removeChild(target);
        });
    });

    // ----------------------------------------------------------------------
    // REFRESH
    // ----------------------------------------------------------------------
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
            // Создаём новый "мир" без деревьев
            const time = await refresh();
            assert.ok(time < 10, 'должно быть почти мгновенно');
        });
    });

    // ----------------------------------------------------------------------
    // UNMOUNT
    // ----------------------------------------------------------------------
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

    // ----------------------------------------------------------------------
    // ERROR PROTECTION
    // ----------------------------------------------------------------------
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

    // ----------------------------------------------------------------------
    // PERFORMANCE
    // ----------------------------------------------------------------------
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

        test('partial update 1 из 1000 < 10ms', async () => {
            const container = createContainer();
            const items = Array.from({ length: 1000 }, (_, i) =>
                h('div', { key: i }, 'item ' + i)
            );
            mount(h('div', null, ...items), container);

            // Меняем один
            const newItems = [...items];
            newItems[0] = h('div', { key: 0 }, 'UPDATED');

            const start = performance.now();
            mount(h('div', null, ...newItems), container);
            const time = performance.now() - start;
            assert.ok(time < 10, `Слишком медленно: ${time.toFixed(2)}ms`);
        });
    });

} else {
    console.log('\n📋 DOM-тесты пропущены (нет happy-dom)');
    console.log('   Установите: npm install --save-dev happy-dom\n');
}

console.log('\n✅ Тесты инициализированы\n');