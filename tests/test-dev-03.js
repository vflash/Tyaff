// tests/test-dev-03.js
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

const { h, Component, mount, refresh } = await import('../src/core.js');

function createContainer() {
    if (!hasDOM) throw new Error('DOM недоступен');
    return document.createElement('div');
}

if (hasDOM) {
    describe('refresh() и Fragment (Баг 2)', () => {
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

console.log('\n✅ Test-dev-03 (Баг 2: Fragment refresh) инициализирован\n');
