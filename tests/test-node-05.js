// ============================================================================
// Node.js тесты для VDOM библиотеки tyaff — Часть 5
// update() Promise<boolean> + Key identifiers
// Запуск: node --test tests/test-node-05.js
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

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

if (hasDOM) {
    // =========================================================================
    // update() возвращает Promise<boolean>
    // =========================================================================
    describe('update() возвращает Promise<boolean>', () => {
        test('возвращает true когда render выполнился', async () => {
            const container = createContainer();
            const MyComp = Component({
                count: 0,
                render() { return h('div', null, this.count); }
            });

            const vnode = mount(MyComp, container);
            const inst = vnode._instance;

            const result = await inst.update({ count: 1 });
            assert.equal(result, true);
            assert.equal(inst.count, 1);
        });

        test('возвращает false когда patch не изменил значений', async () => {
            const container = createContainer();
            const MyComp = Component({
                count: 5,
                render() { return h('div', null, this.count); }
            });

            const vnode = mount(MyComp, container);
            const inst = vnode._instance;

            const result = await inst.update({ count: 5 });
            assert.equal(result, false);
            assert.equal(inst.count, 5);
        });

        test('возвращает false когда memo() заблокировал render', async () => {
            const container = createContainer();
            const MyComp = Component({
                memo(props) { return [props.value]; },
                render(props) { return h('div', null, props.value); }
            });

            const vnode = mount(h(MyComp, { value: 1 }), container);
            const inst = vnode._instance;

            const result = await inst.update({ value: 1 });
            assert.equal(result, false);
        });

        test('возвращает false при update() во время init', async () => {
            const container = createContainer();
            let initResult = null;

            const MyComp = Component({
                init() {
                    this.update({ count: 10 }).then(r => { initResult = r; });
                },
                render() { return h('div'); }
            });

            mount(MyComp, container);
            await delay(10);

            assert.equal(initResult, false);
        });

        test('batching: все update() получают один результат', async () => {
            const container = createContainer();
            let renderCount = 0;

            const MyComp = Component({
                a: 0, b: 0, c: 0,
                render() { renderCount++; return h('div'); }
            });

            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            renderCount = 0;

            const [r1, r2, r3] = await Promise.all([
                inst.update({ a: 1 }),
                inst.update({ b: 2 }),
                inst.update({ c: 3 })
            ]);

            assert.equal(r1, true);
            assert.equal(r2, true);
            assert.equal(r3, true);
            assert.equal(renderCount, 1, 'должен быть один render на всех');
        });

        test('update() без patch — принудительный render', async () => {
            const container = createContainer();
            let renderCount = 0;

            const MyComp = Component({
                render() { renderCount++; return h('div'); }
            });

            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            renderCount = 0;

            const result = await inst.update();
            assert.equal(result, true);
            assert.equal(renderCount, 1);
        });

        test('принудительный update({}) с memo() может вернуть false', async () => {
            const container = createContainer();
            let renderCount = 0;

            const MyComp = Component({
                value: 1,
                memo() { return [this.value]; },
                render() { renderCount++; return h('div'); }
            });

            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            renderCount = 0;

            const result = await inst.update({});
            assert.equal(result, false);
            assert.equal(renderCount, 0);
        });

        test('async chain: последовательные updates', async () => {
            const container = createContainer();
            const log = [];

            const MyComp = Component({
                count: 0,
                render() {
                    log.push('render:' + this.count);
                    return h('div', null, this.count);
                }
            });

            const vnode = mount(MyComp, container);
            const inst = vnode._instance;
            log.length = 0;

            const r1 = await inst.update({ count: 1 });
            const r2 = await inst.update({ count: 2 });
            const r3 = await inst.update({ count: 3 });

            assert.equal(r1, true);
            assert.equal(r2, true);
            assert.equal(r3, true);
            assert.deepEqual(log, ['render:1', 'render:2', 'render:3']);
        });
    });

    // =========================================================================
    // Key identifiers — формирование идентификаторов
    // =========================================================================
    describe('Key identifiers — формирование идентификаторов', () => {

        test('user key с запятой экранируется — перемещение внутри render', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.label); }
            });

            // Ключ 'fio,1' экранируется в '#fio,,1'
            // Это предотвращает конфликт с путём ',1' (автоматический ключ позиции 1)
            const App = Component({
                showSpacer: false,
                render() {
                    return h('div', null,
                        this.showSpacer && h('span', null, 'spacer'),
                        h(Item, { key: 'fio,1', label: 'item' })
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 1, 'один instance создан');
            const firstInstance = instances[0];

            // Добавляем spacer перед Item — Item перемещается с позиции 0 на позицию 1
            // Внутри того же render — key должен сохранить instance
            app.update({ showSpacer: true });
            await delay(10);

            assert.equal(instances.length, 1, 'instance не должен пересоздаваться');
            assert.equal(instances[0], firstInstance, 'тот же instance');
        });

        test('дубликаты user key выводят warning', async () => {
            const container = createContainer();
            const warnings = [];
            const origWarn = console.warn;
            const origError = console.error;
            console.warn = (...args) => warnings.push(args.join(' '));
            console.error = (...args) => warnings.push(args.join(' '));

            try {
                const Item = Component({
                    render() { return h('div'); }
                });

                const App = Component({
                    render() {
                        return h('div', null,
                            h(Item, { key: 'duplicate' }),
                            h(Item, { key: 'duplicate' })  // дубликат в одном render
                        );
                    }
                });

                mount(App, container);
                await delay(10);

                const hasWarning = warnings.some(w =>
                    w.toLowerCase().includes('duplicate') &&
                    w.toLowerCase().includes('key')
                );
                assert.ok(hasWarning,
                    'должно быть предупреждение о дубликате. Вывод: ' +
                    (warnings.length ? warnings.join(' | ') : '(пусто)')
                );
            } finally {
                console.warn = origWarn;
                console.error = origError;
            }
        });

        test('автоматический ключ по пути сохраняется при том же порядке', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('span', null, props.id); }
            });

            const App = Component({
                render() {
                    return h('div', null,
                        h(Item, { id: 'a' }),
                        h(Item, { id: 'b' })
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 2);

            // Тот же порядок — instance сохраняются
            app.update({});  // force update
            await delay(10);

            assert.equal(instances.length, 2, 'те же instance при том же порядке');
        });

        test('user key и automatic key не конфликтуют', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.id); }
            });

            const App = Component({
                render() {
                    return h('div', null,
                        h(Item, { key: '0', id: 'user' }),   // user key '#0'
                        h(Item, { id: 'auto' })              // automatic key ',1'
                    );
                }
            });

            mount(App, container);
            await delay(10);

            assert.equal(instances.length, 2, 'оба должны создаться');
            assert.notEqual(instances[0], instances[1], 'разные instance');
        });

        test('key с различными спецсимволами работает корректно', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.id); }
            });

            const specialKeys = [
                'key-with-dash',
                'key.with.dots',
                'key#with#hash',
                'key with spaces',
                'key/with/slashes',
                'ключ-на-кириллице',
                '123',
                '',
                'a,b,c,d,e'
            ];

            const App = Component({
                order: specialKeys,
                render() {
                    return h('div', null,
                        ...this.order.map((key, i) => h(Item, { key, id: i }))
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, specialKeys.length);

            // Reorder — все должны сохраниться
            app.update({ order: [...specialKeys].reverse() });
            await delay(10);

            assert.equal(instances.length, specialKeys.length,
                'все instance должны сохраниться после перемешивания');
        });

        test('множественные запятые в key экранируются', async () => {
            const container = createContainer();
            const instances = [];

            const Item = Component({
                init() { instances.push(this); },
                render(props) { return h('div', null, props.id); }
            });

            const App = Component({
                order: ['double', 'single'],
                render() {
                    return h('div', null,
                        this.order.map(id => {
                            const key = id === 'double' ? 'a,,b' : 'a,b';
                            return h(Item, { key, id });
                        })
                    );
                }
            });

            const vnode = mount(App, container);
            const app = vnode._instance;
            await delay(10);

            assert.equal(instances.length, 2, 'должны быть 2 разных instance');

            // Reorder — оба должны сохраниться
            app.update({ order: ['single', 'double'] });
            await delay(10);

            assert.equal(instances.length, 2, 'instance не должны пересоздаваться');

            const texts = Array.from(container.querySelector('div > div').children)
                .map(el => el.textContent);
            assert.deepEqual(texts, ['single', 'double']);
        });

        test('user key позволяет перемещать элемент между родителями внутри render', async () => {
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

            assert.equal(instances.length, 1, 'один instance создан');
            const firstInstance = instances[0];

            // Перемещаем Item из #left в #right внутри того же render
            app.update({ position: 'right' });
            await delay(10);

            assert.equal(instances.length, 1, 'instance не должен пересоздаваться');
            assert.equal(instances[0], firstInstance, 'тот же instance после перемещения');
        });

        test('key сохраняет instance при reorder среди siblings внутри render', async () => {
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

            // Reorder внутри того же render компонента App
            app.update({ order: [3, 1, 2] });
            await delay(20);

            assert.equal(instances.length, 3, 'instance не должны пересоздаваться');

            const items = Array.from(container.querySelector('div > div').children);
            assert.equal(items[0].textContent, '3');
            assert.equal(items[1].textContent, '1');
            assert.equal(items[2].textContent, '2');
        });
    });
}

console.log('\n✅ Test-node-05 инициализирован (16 тестов)\n');