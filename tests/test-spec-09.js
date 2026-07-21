// ============================================================================
// Test for Stage 5E: Portal ref only on mount/unmount (SPEC §6)
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

const { h, Component, createPortal, mount } = await import('../src/core.js');

function createContainer() {
    if (!hasDOM) throw new Error('DOM недоступен');
    return document.createElement('div');
}

describe('Этап 5E: Portal ref только на mount/unmount (SPEC §6)', () => {
    test('ref портала вызывается ТОЛЬКО на mount и unmount, но НЕ на update', async () => {
        const calls = [];
        
        const ref = (inst) => {
            calls.push(inst === null ? 'unmount' : 'mount');
        };

        const portalTarget = document.createElement('div');
        document.body.appendChild(portalTarget);

        const root = createContainer();
        document.body.appendChild(root);
        
        // Создаём портал с ref
        const portalVnode = createPortal(
            [h('span', null, 'Portal content')],
            () => portalTarget,
            { ref }
        );
        
        // Монтируем
        mount(h('div', null, portalVnode), root);

        // После первого mount должен быть только один вызов 'mount'
        assert.deepStrictEqual(calls, ['mount'], 'ref должен быть вызван на mount');

        // Монтируем снова (update) — тот же vnode
        mount(h('div', null, portalVnode), root);
        
        // После update НЕ должно быть дополнительных вызовов ref
        assert.deepStrictEqual(calls, ['mount'], 'ref НЕ должен вызываться на update');

        // Ещё один update
        mount(h('div', null, portalVnode), root);
        assert.deepStrictEqual(calls, ['mount'], 'ref НЕ должен вызываться на последующие updates');

        // Unmount
        mount(null, root);
        
        // После unmount должен быть вызов 'unmount'
        assert.deepStrictEqual(calls, ['mount', 'unmount'], 'ref должен быть вызван на unmount');
    });

    test('ref портала с изменением children не вызывает ref повторно', async () => {
        const calls = [];
        let counter = 0;
        
        const ref = (inst) => {
            calls.push(inst === null ? 'unmount' : 'mount');
        };

        const portalTarget = document.createElement('div');
        document.body.appendChild(portalTarget);

        const root = createContainer();
        document.body.appendChild(root);
        
        // Первый mount
        const portalVnode1 = createPortal(
            [h('span', null, `Portal content ${++counter}`)],
            () => portalTarget,
            { ref }
        );
        mount(h('div', null, portalVnode1), root);

        assert.deepStrictEqual(calls, ['mount'], 'ref вызван на mount');

        // Обновляем с изменением children (новые vnode)
        const portalVnode2 = createPortal(
            [h('span', null, `Portal content ${++counter}`)],
            () => portalTarget,
            { ref }
        );
        mount(h('div', null, portalVnode2), root);
        
        const portalVnode3 = createPortal(
            [h('span', null, `Portal content ${++counter}`)],
            () => portalTarget,
            { ref }
        );
        mount(h('div', null, portalVnode3), root);
        
        // ref НЕ должен вызываться на updates (instance портала переиспользуется)
        assert.deepStrictEqual(calls, ['mount'], 'ref НЕ вызывается на updates даже при изменении children');

        mount(null, root);
        assert.deepStrictEqual(calls, ['mount', 'unmount'], 'ref вызван на unmount');
    });
});
