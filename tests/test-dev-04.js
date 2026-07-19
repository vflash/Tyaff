// ============================================================================
// Test for Bug 4 (double unmount) and Satellite 1 (keyMap reuse)
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

if (hasDOM) {
    describe('Bug 4 — Double unmount when portal container disappears', () => {
        test('onUnmounted and ref(null) should be called exactly once', async () => {
            let unmountCount = 0;
            let refNullCount = 0;
            
            const Child = Component({
                onUnmounted() { unmountCount++; },
                render() { 
                    return h('div', { 
                        ref: (el) => { if (!el) refNullCount++; } 
                    }, 'Child'); 
                }
            });

            let portalContainer = document.createElement('div');
            document.body.appendChild(portalContainer);

            let appInst;
            const App = Component({
                hasContainer: true,
                render() {
                    return h('div', null,
                        createPortal(h(Child), () => this.hasContainer ? portalContainer : null)
                    );
                }
            });

            const root = document.createElement('div');
            mount(h(App, { ref: (inst) => { appInst = inst; } }), root);
            
            assert.equal(unmountCount, 0, 'Initial unmount count should be 0');
            assert.equal(refNullCount, 0, 'Initial ref null count should be 0');

            // Make container disappear
            appInst.hasContainer = false;
            await appInst.update();

            assert.equal(unmountCount, 1, 'onUnmounted should be called exactly once');
            assert.equal(refNullCount, 1, 'ref(null) should be called exactly once');
        });
    });

    describe('Satellite 1 — Portal children should reuse keyMap', () => {
        test('portal children should not be recreated on parent update', async () => {
            let childInitCount = 0;
            let childUnmountCount = 0;
            
            const Child = Component({
                init() { childInitCount++; },
                onUnmounted() { childUnmountCount++; },
                render() { return h('div', null, 'Child'); }
            });

            let portalContainer = document.createElement('div');
            document.body.appendChild(portalContainer);

            let appInst;
            const App = Component({
                counter: 0,
                render() {
                    return h('div', null,
                        createPortal(h(Child), () => portalContainer)
                    );
                }
            });

            const root = document.createElement('div');
            mount(h(App, { ref: (inst) => { appInst = inst; } }), root);
            
            assert.equal(childInitCount, 1, 'Child should be initialized once on mount');
            assert.equal(childUnmountCount, 0, 'Child should not be unmounted on mount');

            // Update parent multiple times
            appInst.counter++;
            await appInst.update();
            
            appInst.counter++;
            await appInst.update();

            assert.equal(childInitCount, 1, 'Child should NOT be re-initialized on parent update');
            assert.equal(childUnmountCount, 0, 'Child should NOT be unmounted on parent update');
        });
    });
}
