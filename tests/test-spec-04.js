// ============================================================================
// Spec-тесты для VDOM библиотеки tyaff — Часть 4: продвинутые механизмы
//
// Spec-тесты проверяют observable behavior (DOM API, instance identity, lifecycle
// hooks) — то что пользователь может наблюдать через публичный API библиотеки.
// Тесты деталей реализации (internal caches, frozen shared references) живут
// в test-dev-*.js.
//
// Запуск: node --test tests/test-spec-04.js
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

const { h, Component, Fragment, createPortal, mount } = await import('../src/core.js');

function createContainer() {
    if (!hasDOM) throw new Error('DOM недоступен');
    return document.createElement('div');
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

if (hasDOM) {
    // =========================================================================
    // CONTEXT
    // =========================================================================
    describe('Context — продвинутые сценарии', () => {
        test('i18n: переключение языка в runtime', async () => {
            const container = createContainer();

            const messages = {
                ru: { hello: 'Привет', bye: 'Пока' },
                en: { hello: 'Hello', bye: 'Bye' }
            };

            const providerRef = { current: null };

            const I18nProvider = Component({
                lang: 'ru',
                context: {
                    t(key) { return messages[this.lang][key] || key; },
                    getLang() { return this.lang; }
                },
                render(props) {
                    return h('div', null, props.children);
                }
            });

            const Greeting = Component({
                render() {
                    return h('span', null,
                        this.context('t', 'hello'), ' / ', this.context('t', 'bye')
                    );
                }
            });

            mount(
                h(I18nProvider, { ref: (inst) => { providerRef.current = inst; } },
                    h(Greeting)
                ),
                container
            );
            await delay(10);

            assert.equal(container.querySelector('span').textContent, 'Привет / Пока');

            providerRef.current.update({ lang: 'en' });
            await delay(10);
            assert.equal(container.querySelector('span').textContent, 'Hello / Bye');

            providerRef.current.update({ lang: 'ru' });
            await delay(10);
            assert.equal(container.querySelector('span').textContent, 'Привет / Пока');
        });

        test('Theme context с memo() — правильный deps', async () => {
            const container = createContainer();
            let themedRenderCount = 0;
            let plainRenderCount = 0;
            const providerRef = { current: null };

            const ThemeProvider = Component({
                theme: 'light',
                context: {
                    theme() { return this.theme; }
                },
                render(props) { return h('div', null, props.children); }
            });

            const ThemedBox = Component({
                memo(props) {
                    return [props.title, this.context('theme')];
                },
                render(props) {
                    themedRenderCount++;
                    return h('div', {
                        className: 'box ' + this.context('theme')
                    }, props.title);
                }
            });

            const PlainBox = Component({
                memo(props) { return [props.title]; },
                render(props) {
                    plainRenderCount++;
                    return h('div', { className: 'plain' }, props.title);
                }
            });

            mount(
                h(ThemeProvider, { ref: (inst) => { providerRef.current = inst; } },
                    h(ThemedBox, { title: 'Themed' }),
                    h(PlainBox, { title: 'Plain' })
                ),
                container
            );
            await delay(10);

            assert.equal(themedRenderCount, 1);
            assert.equal(plainRenderCount, 1);

            providerRef.current.update({ theme: 'dark' });
            await delay(10);

            assert.equal(themedRenderCount, 2, 'ThemedBox должен перерендериться');
            assert.equal(plainRenderCount, 1, 'PlainBox не должен перерендериться');
            assert.ok(container.querySelector('.box').className.includes('dark'));
        });

        test('несколько провайдеров одного ключа — ближайший выигрывает', () => {
            const container = createContainer();
            let receivedValue = null;

            const Leaf = Component({
                render() {
                    receivedValue = this.context('value');
                    return h('span', null, receivedValue);
                }
            });

            const Middle = Component({
                context: { value() { return 'middle'; } },
                render() { return h('div', null, h(Leaf)); }
            });

            const Outer = Component({
                context: { value() { return 'outer'; } },
                render() { return h('div', null, h(Middle)); }
            });

            mount(Outer, container);
            assert.equal(receivedValue, 'middle');
        });

        test('context с аргументами — функция-геттер', () => {
            const container = createContainer();
            let result = null;

            const Calc = Component({
                context: {
                    add(a, b) { return a + b; },
                    multiply(a, b) { return a * b; }
                },
                render(props) { return h('div', null, props.children); }
            });

            const Consumer = Component({
                render() {
                    result = this.context('add', 5, 3) + this.context('multiply', 2, 4);
                    return h('span', null, result);
                }
            });

            mount(h(Calc, null, h(Consumer)), container);
            assert.equal(result, 16);
        });
    });

    // =========================================================================
    // PORTALS
    // =========================================================================
    describe('Portals — продвинутые сценарии', () => {
        test('модальное окно с context propagation', async () => {
            const container = createContainer();
            document.body.appendChild(container);
            const modalRoot = document.createElement('div');
            modalRoot.id = 'modal-root';
            document.body.appendChild(modalRoot);

            const ThemeProvider = Component({
                theme: 'dark',
                context: { theme() { return this.theme; } },
                render(props) { return h('div', null, props.children); }
            });

            const ModalContent = Component({
                render() {
                    const theme = this.context('theme');
                    return h('div', { className: 'modal ' + theme }, 'Modal content');
                }
            });

            const App = Component({
                showModal: false,
                render() {
                    return h(ThemeProvider, null,
                        h('button', {
                            onClick: () => this.update({ showModal: !this.showModal })
                        }, 'Toggle'),
                        this.showModal && createPortal(
                            h(ModalContent),
                            () => modalRoot
                        )
                    );
                }
            });

            mount(App, container);
            await delay(10);
            assert.equal(modalRoot.innerHTML, '');

            container.querySelector('button').click();
            await delay(10);
            assert.ok(modalRoot.querySelector('.modal'));
            assert.ok(modalRoot.querySelector('.modal').className.includes('dark'));

            container.querySelector('button').click();
            await delay(10);
            assert.equal(modalRoot.innerHTML, '');

            document.body.removeChild(container);
            document.body.removeChild(modalRoot);
        });

        test('несколько порталов в одном render', async () => {
            const container = createContainer();
            document.body.appendChild(container);
            const target1 = document.createElement('div');
            const target2 = document.createElement('div');
            document.body.appendChild(target1);
            document.body.appendChild(target2);

            mount(
                h('div', null,
                    createPortal(h('span', { id: 'p1' }, 'Portal 1'), () => target1),
                    createPortal(h('span', { id: 'p2' }, 'Portal 2'), () => target2),
                    h('span', { id: 'main' }, 'Main')
                ),
                container
            );
            await delay(10);

            assert.equal(target1.querySelector('#p1').textContent, 'Portal 1');
            assert.equal(target2.querySelector('#p2').textContent, 'Portal 2');
            assert.equal(container.querySelector('#main').textContent, 'Main');

            document.body.removeChild(container);
            document.body.removeChild(target1);
            document.body.removeChild(target2);
        });
    });

    // =========================================================================
    // CONCURRENT UPDATES
    // =========================================================================
    describe('Concurrent updates', () => {
        test('несколько компонентов обновляются в одном тике', async () => {
            const container = createContainer();
            const renders = { a: 0, b: 0, c: 0 };
            const refs = { a: null, b: null, c: null };

            const Counter = Component({
                count: 0,
                render(props) {
                    renders[props.name]++;
                    return h('div', { 'data-name': props.name }, this.count);
                }
            });

            mount(
                h('div', null,
                    h(Counter, { name: 'a', ref: (i) => { refs.a = i; } }),
                    h(Counter, { name: 'b', ref: (i) => { refs.b = i; } }),
                    h(Counter, { name: 'c', ref: (i) => { refs.c = i; } })
                ),
                container
            );
            await delay(10);

            renders.a = 0; renders.b = 0; renders.c = 0;

            refs.a.update({ count: 10 });
            refs.b.update({ count: 20 });
            refs.c.update({ count: 30 });
            await delay(20);

            assert.equal(renders.a, 1);
            assert.equal(renders.b, 1);
            assert.equal(renders.c, 1);
        });

        test('parent и child обновляются в одном тике', async () => {
            const container = createContainer();
            let parentRenders = 0;
            let childRenders = 0;
            const parentRef = { current: null };

            const Child = Component({
                render(props) {
                    childRenders++;
                    return h('span', null, props.value);
                }
            });

            const Parent = Component({
                value: 0,
                render() {
                    parentRenders++;
                    return h(Child, { value: this.value });
                }
            });

            mount(h(Parent, { ref: (i) => { parentRef.current = i; } }), container);
            await delay(10);
            parentRenders = 0;
            childRenders = 0;

            parentRef.current.update({ value: 42 });
            await delay(20);

            assert.equal(parentRenders, 1);
            assert.equal(childRenders, 1);
        });
    });

    // =========================================================================
    // EDGE CASES
    // =========================================================================
    describe('Edge cases', () => {
        test('очень глубокое дерево (100 уровней)', () => {
            const container = createContainer();

            const Wrapper = Component({
                render(props) {
                    return h('div', { className: 'level' }, props.children);
                }
            });

            let tree = h('span', null, 'leaf');
            for (let i = 0; i < 100; i++) {
                tree = h(Wrapper, null, tree);
            }

            mount(tree, container);

            let depth = 0;
            let node = container.firstChild;
            while (node && node.tagName === 'DIV') {
                depth++;
                node = node.firstChild;
            }
            assert.equal(depth, 100);
            assert.equal(node.textContent, 'leaf');
        });

        test('условный рендер с разными типами', async () => {
            const container = createContainer();
            let unmounted = false;

            const CompA = Component({
                onUnmounted() { unmounted = true; },
                render() { return h('div', { className: 'a' }, 'A'); }
            });

            const App = Component({
                flag: true,
                render() {
                    return h('div', null,
                        this.flag ? h(CompA) : h('span', null, 'B')
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;

            assert.equal(container.querySelector('.a').textContent, 'A');

            app.update({ flag: false });
            await delay(10);

            assert.ok(unmounted);
            assert.equal(container.querySelector('span').textContent, 'B');
        });

        test('условный рендер через &&', async () => {
            const container = createContainer();
            const appRef = { current: null };

            const App = Component({
                show: true,
                render() {
                    return h('div', { id: 'wrapper' },
                        this.show && h('div', { className: 'content' }, 'visible')
                    );
                }
            });

            mount(h(App, { ref: (inst) => { appRef.current = inst; } }), container);
            await delay(20);

            const wrapper = container.querySelector('#wrapper');
            assert.ok(wrapper.querySelector('.content'), 'контент должен быть виден');
            assert.equal(wrapper.querySelector('.content').textContent, 'visible');

            appRef.current.update({ show: false });
            await delay(20);
            assert.equal(wrapper.querySelector('.content'), null, 'контент должен исчезнуть');
            assert.equal(wrapper.innerHTML, '');

            appRef.current.update({ show: true });
            await delay(20);
            assert.ok(wrapper.querySelector('.content'), 'контент должен вернуться');
            assert.equal(wrapper.querySelector('.content').textContent, 'visible');
        });

        test('Fragment внутри Fragment', () => {
            const container = createContainer();

            mount(
                h(Fragment, null,
                    h(Fragment, null,
                        h('span', null, '1'),
                        h('span', null, '2')
                    ),
                    h(Fragment, null,
                        h('span', null, '3'),
                        h('span', null, '4')
                    )
                ),
                container
            );

            assert.equal(container.querySelectorAll('span').length, 4);
        });

        test('массив детей с null-плейсхолдерами', async () => {
            const container = createContainer();

            const App = Component({
                items: [1, null, 3, null, 5],
                render() {
                    return h('div', null,
                        this.items.map((item, i) =>
                            item ? h('span', { key: i }, item) : null
                        )
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;

            assert.equal(container.querySelectorAll('span').length, 3);

            app.update({ items: [1, 2, 3, 4, 5] });
            await delay(10);
            assert.equal(container.querySelectorAll('span').length, 5);

            app.update({ items: [null, null, null] });
            await delay(10);
            assert.equal(container.querySelectorAll('span').length, 0);
        });
    });

    // =========================================================================
    // STRESS TESTS
    // =========================================================================
    describe('Stress tests', () => {
        test('100 последовательных updates одного компонента', async () => {
            const container = createContainer();
            let renders = 0;

            const Counter = Component({
                count: 0,
                render() { renders++; return h('div', null, this.count); }
            });

            const vnode = mount(Counter, container);
            const inst = vnode._instance;
            renders = 0;

            for (let i = 0; i < 100; i++) {
                inst.update({ count: i });
            }
            await delay(50);

            assert.ok(renders < 100, `должно быть меньше 100 renders (было ${renders})`);
            assert.equal(inst.count, 99);
        });

        test('быстрое переключение 1000 элементов', async () => {
            const container = createContainer();

            const Item = Component({
                render(props) { return h('div', { key: props.id }, props.id); }
            });

            const App = Component({
                items: Array.from({ length: 1000 }, (_, i) => i),
                render() {
                    return h('div', null,
                        this.items.map(id => h(Item, { key: id, id }))
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;

            const start = performance.now();

            for (let i = 0; i < 10; i++) {
                app.update({ items: [...app.items].reverse() });
            }
            await delay(100);

            const time = performance.now() - start;
            assert.ok(time < 500, `10 реверсов 1000 элементов должны быть <500ms (было ${time}ms)`);
        });
    });

    // =========================================================================
    // MEMORY & CLEANUP
    // =========================================================================
    describe('Memory & cleanup', () => {
        test('onUnmounted вызывается для всех вложенных компонентов', async () => {
            const container = createContainer();
            const unmounted = [];

            const Leaf = Component({
                onUnmounted() { unmounted.push('leaf-' + this.props.id); },
                render(props) { return h('span', null, props.id); }
            });

            const Branch = Component({
                onUnmounted() { unmounted.push('branch-' + this.props.id); },
                render(props) {
                    return h('div', null,
                        h(Leaf, { id: props.id + '-a' }),
                        h(Leaf, { id: props.id + '-b' })
                    );
                }
            });

            const Root = Component({
                onUnmounted() { unmounted.push('root'); },
                render() {
                    return h('div', null,
                        h(Branch, { id: '1' }),
                        h(Branch, { id: '2' })
                    );
                }
            });

            mount(Root, container);
            await delay(10);

            mount(null, container);
            await delay(10);

            assert.ok(unmounted.includes('root'));
            assert.ok(unmounted.includes('branch-1'));
            assert.ok(unmounted.includes('branch-2'));
            assert.ok(unmounted.includes('leaf-1-a'));
            assert.ok(unmounted.includes('leaf-1-b'));
            assert.ok(unmounted.includes('leaf-2-a'));
            assert.ok(unmounted.includes('leaf-2-b'));
            assert.equal(unmounted.length, 7);
        });

        test('refs обнуляются при unmount', async () => {
            const container = createContainer();
            let lastRef = 'not-called';

            const MyComp = Component({
                render() {
                    return h('input', {
                        ref: (node) => { lastRef = node; }
                    });
                }
            });

            mount(MyComp, container);
            await delay(10);
            assert.ok(lastRef && lastRef.tagName === 'INPUT');

            mount(null, container);
            await delay(10);
            assert.equal(lastRef, null);
        });
    });
}

console.log('\n✅ Test-spec-04 инициализирован (17 тестов)\n');