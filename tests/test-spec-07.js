// tests/test-spec-07.js

// ============================================================================
// Spec-тесты для VDOM библиотеки tyaff — Часть 7: Portal + memo-skip + update()
//
// Тесты для бага #1 (Portal в memo-skip поддереве) и его сателлитов.
// Проверяют observable behavior: отсутствие крэшей, переиспользование DOM,
// корректное разрешение Promise при ошибках.
//
// Запуск: node --test tests/test-spec-07.js
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
    describe('Баг #1 — memo-skip + Portal', () => {

        test('update() без смены зависимостей при memo() + Portal не крашится', async () => {
            const container = createContainer();
            let renderCount = 0;

            // Portal target
            const portalContainer = document.createElement('div');
            document.body.appendChild(portalContainer);

            // Дочерний компонент внутри портала
            const PortalChild = Component({
                text: 'hello',
                render() {
                    renderCount++;
                    return h('div', null, this.text);
                }
            });

            // Родительский компонент с memo() и порталом в поддереве
            const App = Component({
                memoDep: 'stable',
                otherDep: 0,
                memo() { return [this.memoDep]; },
                render() {
                    return h('div', null,
                        'parent',
                        createPortal(
                            h(PortalChild, { key: 'pc' }),
                            () => portalContainer
                        )
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(renderCount, 1, 'PortalChild должен отререндериться при первом mount');

            // Вызываем update() без изменения memoDep — memo() должен заблокировать render
            // родителя, но Portal должен корректно обработать memo-skip
            renderCount = 0;
            const result = await app.update({ otherDep: 1 });

            // Должен отработать без ReferenceError
            assert.equal(result, false, 'update должен вернуть false (memo-skip)');
            assert.equal(renderCount, 0, 'PortalChild не должен перерендериться');

            // Проверяем что DOM портала на месте
            assert.equal(portalContainer.children.length, 1, 'портал должен иметь один дочерний элемент');
            assert.equal(portalContainer.children[0].textContent, 'hello');

            document.body.removeChild(portalContainer);
            _cleanupAll();
        });

        test('Сателлит 1: Portal использует родительский keyMap при memo-skip (DOM переиспользуется)', async () => {
            const container = createContainer();
            const portalContainer = document.createElement('div');
            document.body.appendChild(portalContainer);

            const instances = [];
            const PortalChild = Component({
                init() { instances.push(this); },
                render() { return h('span', null, 'portal-content'); }
            });

            const App = Component({
                stable: 'yes',
                other: 0,
                memo() { return [this.stable]; },
                render() {
                    return h('div', null,
                        createPortal(h(PortalChild, { key: 'p1' }), () => portalContainer)
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 1, 'один instance создан');
            const firstInstance = instances[0];
            const portalSpan = portalContainer.querySelector('span');

            // Memo-skip update
            await app.update({ other: 1 });
            await delay(10);

            // Instance не должен пересоздаться
            assert.equal(instances.length, 1, 'instance не должен пересоздаваться');
            assert.equal(instances[0], firstInstance, 'тот же instance');

            // DOM-узел должен переиспользоваться (не пересоздан)
            const portalSpanAfter = portalContainer.querySelector('span');
            assert.equal(portalSpanAfter, portalSpan,
                'DOM-узел внутри портала должен переиспользоваться при memo-skip (keyMap общий с родителем)');

            document.body.removeChild(portalContainer);
            _cleanupAll();
        });

        test('Сателлит 2: update() не зависает при ошибке в render', async () => {
            const container = createContainer();
            let shouldThrow = false;
            const errors = [];
            const origError = console.error;
            console.error = (...args) => errors.push(args.join(' '));

            try {
                const Broken = Component({
                    render() {
                        if (shouldThrow) throw new Error('render failed');
                        return h('div', null, 'ok');
                    }
                });

                const App = Component({
                    render() { return h(Broken); }
                });

                const vnode = mount(App, container);
                const app = vnode._instance;
                await delay(10);

                shouldThrow = true;

                // update() должен резолвиться, а не висеть вечно
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('update() завис - Promise не разрешился за 500мс')), 500)
                );

                const updatePromise = app.update();
                const result = await Promise.race([updatePromise, timeoutPromise]);

                // Promise должен разрешиться (не зависнуть)
                assert.ok(true, 'update() Promise разрешился');

            } finally {
                console.error = origError;
                _cleanupAll();
            }
        });

        test('Сателлит 2: множественные update() после ошибки не блокируют очередь', async () => {
            const container = createContainer();
            let shouldThrow = false;
            let renderCount = 0;
            const errors = [];
            const origError = console.error;
            console.error = (...args) => errors.push(args.join(' '));

            try {
                const Broken = Component({
                    render() {
                        renderCount++;
                        if (shouldThrow) throw new Error('render failed');
                        return h('div', null, 'ok');
                    }
                });

                const App = Component({
                    render() { return h(Broken); }
                });

                const vnode = mount(App, container);
                const app = vnode._instance;
                await delay(10);
                renderCount = 0;

                // Первый update с ошибкой
                shouldThrow = true;
                await Promise.race([
                    app.update(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
                ]);

                // Выключаем ошибку и пробуем ещё update
                shouldThrow = false;
                const result = await Promise.race([
                    app.update(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('update завис после ошибки')), 500))
                ]);

                assert.equal(result, true, 'update после ошибки должен работать');
                assert.ok(renderCount > 0, 'render должен был выполниться после отключения ошибки');

            } finally {
                console.error = origError;
                _cleanupAll();
            }
        });

    });

    describe('refresh() и Fragment', () => {
        test('refresh() находит компоненты внутри Fragment (корень-массив)', async () => {
            const c = createContainer();
            let renderCount = 0;

            const Child = Component({
                name: 'Child',
                render() {
                    renderCount++;
                    return h('span', null, 'Child ' + renderCount);
                }
            });

            // 1. Монтируем массив (который становится Fragment) с компонентом внутри
            mount([h(Child, { key: 'c' })], c);

            assert.equal(renderCount, 1, 'первый render должен быть вызван');
            assert.equal(c.firstChild.tagName, 'SPAN');
            assert.equal(c.firstChild.textContent, 'Child 1');

            // 2. Вызываем refresh()
            await refresh();

            // Ожидаем, что refresh() обойдет Fragment и найдет Child, вызвав его update()
            assert.equal(renderCount, 2, 'refresh() должен вызвать render компонента внутри Fragment');
            assert.equal(c.firstChild.textContent, 'Child 2');
        });
    });

}

console.log('\n✅ Test-spec-07 инициализирован\n');
