// tests/test-dev-02.js
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

if (hasDOM) {
    describe('recreate и управление keyMap', () => {
        test('recreate корректно управляет keyMap и не оставляет висячих ссылок', () => {
            const c = createContainer();
            let unmounted = false;
            
            const Child = Component({
                name: 'Child',
                render() { return h('span', null, 'A'); },
                onUnmounted() { unmounted = true; }
            });

            // 1. Монтируем select с multiple=false и дочерним компонентом
            mount(h('select', { key: 's', multiple: false }, h(Child, { key: 'c' })), c);
            
            assert.equal(unmounted, false, 'onUnmounted не должен вызываться при монтировании');
            assert.equal(c.firstChild.tagName, 'SELECT');
            assert.equal(c.firstChild.firstChild.tagName, 'SPAN');
            
            // 2. Обновляем до multiple=true, что триггерит shouldRecreate для select
            // При этом мы НЕ передаем детей
            mount(h('select', { key: 's', multiple: true }), c);
            
            // Ожидаем, что старый Child будет корректно размонтирован, 
            // а не останется висячей ссылкой в keyMap без вызова onUnmounted
            assert.equal(unmounted, true, 'дочерний компонент должен быть размонтирован при recreate родителя');
            
            // Проверяем, что новый select не имеет старых детей
            assert.equal(c.firstChild.childNodes.length, 0, 'дочерние узлы должны быть удалены из DOM');
        });
    });
}

console.log('\n✅ Test-dev-02 инициализирован\n');
