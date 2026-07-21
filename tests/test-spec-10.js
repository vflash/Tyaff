// ============================================================================
// Test-spec-10: Оптимизация update()
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

const { h, Component, mount } = await import('../src/core.js');

function createContainer() {
    if (!hasDOM) throw new Error('DOM недоступен');
    return document.createElement('div');
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

if (hasDOM) {
    describe('update() оптимизация — один цикл вместо трёх', () => {
        test('update() с большим patch работает корректно (один цикл)', async () => {
            let renderCount = 0;

            const TestComponent = Component({
                render() {
                    renderCount++;
                    return h('div', null, 'count:', renderCount);
                }
            });

            const container = createContainer();
            const vnode = mount(TestComponent, container);
            assert.equal(renderCount, 1);

            const inst = vnode._instance;

            // Большой patch — проверяем что один цикл работает корректно
            const bigPatch = {};
            for (let i = 0; i < 100; i++) {
                bigPatch['field' + i] = i;
            }

            await inst.update(bigPatch);
            assert.equal(renderCount, 2, 'render должен вызваться');

            // Проверяем что все поля применились
            for (let i = 0; i < 100; i++) {
                assert.equal(inst['field' + i], i, 'поле field' + i + ' должно быть ' + i);
            }

            // Тот же patch — не должно быть render
            await inst.update(bigPatch);
            assert.equal(renderCount, 2, 'render не должен вызваться (значения не изменились)');
        });

        test('update() применяет только изменённые значения (один цикл)', async () => {
            let renderCount = 0;

            const TestComponent = Component({
                render() {
                    renderCount++;
                    return h('div');
                }
            });

            const container = createContainer();
            const vnode = mount(TestComponent, container);
            assert.equal(renderCount, 1);

            const inst = vnode._instance;
            inst.field1 = 'old1';
            inst.field2 = 'old2';
            inst.field3 = 'old3';

            // Patch меняет только field2
            await inst.update({
                field1: 'old1',  // не изменилось
                field2: 'new2',  // изменилось
                field3: 'old3'   // не изменилось
            });

            assert.equal(renderCount, 2, 'render должен вызваться');
            assert.equal(inst.field1, 'old1');
            assert.equal(inst.field2, 'new2');
            assert.equal(inst.field3, 'old3');
        });

        test('update() корректно обрабатывает undefined/null значения', async () => {
            let renderCount = 0;

            const TestComponent = Component({
                render() {
                    renderCount++;
                    return h('div');
                }
            });

            const container = createContainer();
            const vnode = mount(TestComponent, container);
            assert.equal(renderCount, 1);

            const inst = vnode._instance;
            inst.field1 = 'value1';
            inst.field2 = null;
            inst.field3 = undefined;

            // Patch меняет значения на undefined/null
            await inst.update({
                field1: undefined,
                field2: null,
                field3: null
            });

            assert.equal(renderCount, 2, 'render должен вызваться');
            assert.equal(inst.field1, undefined);
            assert.equal(inst.field2, null);
            assert.equal(inst.field3, null);
        });
    });

    describe('update({}) — SPEC §5', () => {
        test('update({}) возвращает false (патч пустой, ничего не изменилось)', async () => {
            let renderCount = 0;

            const TestComponent = Component({
                render() {
                    renderCount++;
                    return h('div', null, 'count:', renderCount);
                }
            });

            const container = createContainer();
            const vnode = mount(TestComponent, container);
            await delay(10);
            assert.equal(renderCount, 1, 'первый render');

            const inst = vnode._instance;

            // update({}) — пустой объект, ничего не изменилось
            const result = await inst.update({});

            assert.equal(result, false, 'update({}) должен вернуть false (SPEC §5)');
            assert.equal(renderCount, 1, 'render не должен вызваться (patch пустой)');

            _cleanupAll();
        });

        test('update(patch) без изменений возвращает false', async () => {
            let renderCount = 0;

            const TestComponent = Component({
                value: 'initial',
                render() {
                    renderCount++;
                    return h('div', null, this.value);
                }
            });

            const container = createContainer();
            const vnode = mount(TestComponent, container);
            await delay(10);
            assert.equal(renderCount, 1, 'первый render');

            const inst = vnode._instance;

            // update с тем же значением — ничего не изменилось
            const result = await inst.update({ value: 'initial' });

            assert.equal(result, false, 'update без изменений должен вернуть false');
            assert.equal(renderCount, 1, 'render не должен вызваться');

            _cleanupAll();
        });

        test('update(patch) с изменениями возвращает true и вызывает render', async () => {
            let renderCount = 0;

            const TestComponent = Component({
                value: 'initial',
                render() {
                    renderCount++;
                    return h('div', null, this.value);
                }
            });

            const container = createContainer();
            const vnode = mount(TestComponent, container);
            await delay(10);
            assert.equal(renderCount, 1, 'первый render');

            const inst = vnode._instance;

            // update с новым значением — что-то изменилось
            const result = await inst.update({ value: 'changed' });

            assert.equal(result, true, 'update с изменениями должен вернуть true');
            assert.equal(renderCount, 2, 'render должен вызваться');
            assert.equal(inst.value, 'changed', 'значение должно обновиться');

            _cleanupAll();
        });

        test('update() без аргументов возвращает true (принудительный render)', async () => {
            let renderCount = 0;

            const TestComponent = Component({
                render() {
                    renderCount++;
                    return h('div');
                }
            });

            const container = createContainer();
            const vnode = mount(TestComponent, container);
            await delay(10);
            assert.equal(renderCount, 1, 'первый render');

            const inst = vnode._instance;

            // update() без аргументов — принудительный render
            const result = await inst.update();

            assert.equal(result, true, 'update() без аргументов должен вернуть true');
            assert.equal(renderCount, 2, 'render должен вызваться (синхронизация)');

            _cleanupAll();
        });
    });
}

console.log('\n✅ Test-spec-10 инициализирован (3 теста)\n');
