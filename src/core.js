// ============================================================================
// VDOM Library — custom VDOM, diff/patch, context tree, portals, refs
// ============================================================================

const Fragment = Symbol('Fragment');
const Portal = Symbol('Portal');
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

// Шара для пустых результатов reconcile2 — caller'ы только читают, не мутируют.
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_PROPS = Object.freeze({});

// Version counter для cleanup вместо Set<actualUIDs>.
// Каждый render инкрементирует reconcileVersion, vnode помечается _v = reconcileVersion.
// Cleanup сравнивает _v старых элементов с текущей версией — устаревшие unmount.
// Быстрее Set (property write/read vs hash+bucket) и не требует Set allocation per render.
let reconcileVersion = 0;

let IS_DEV = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

function setDevMode(isDev) {
    IS_DEV = !!isDev;
}

// ============================================================================
// Utility functions
// ============================================================================

function appendAll(parent, nodes) {
    if (!nodes) return;
    for (let i = 0; i < nodes.length; i++) {
        parent.appendChild(nodes[i]);
    }
}

function createElement(namespace, tag) {
    const dom = namespace === SVG_NS ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    dom._tagName = (tag === 'div' ? 'DIV'
        : tag === 'td' ? 'TD'
        : tag === 'tr' ? 'TR'
        : tag === 'span' ? 'SPAN'
        : tag === 'tbody' ? 'TBODY'
        : tag === 'table' ? 'TABLE'
        : dom.tagName
    );
    return dom;
};

// ============================================================================
// h() — создание VDOM узлов
// ============================================================================

function h(tag, props, ...childs) {
    props ||= EMPTY_PROPS;
    for (let i = 0, l = childs.length; i < l; i++) {
        const c = childs[i];
        if (typeof c === 'string') {
            childs[i] = { _text: c };
        } else if (typeof c === 'number') {
            childs[i] = { _text: '' + c };
        } else if (c == undefined || c === false || c === true) {
            childs[i] = null;
        }
    }
    return { tag, props, childs };
}

function createPortal(children, containerGetter) {
    const kids = Array.isArray(children) ? children : [children];
    return { tag: Portal, props: { containerGetter }, childs: kids };
}

// ============================================================================
// Component factory
// ============================================================================

// Symbol константы для внутренних полей instance.
// Спрятаны от for-in / Object.keys / JSON.stringify — чистый public API.
// Защищают от коллизий с пользовательскими полями в definition.
const _DEF = Symbol('def');
const _PARENT_CTX = Symbol('parentCtx');
const _INCOMING_PROPS = Symbol('incomingProps');
const _VDOM = Symbol('vdom');
const _NODES = Symbol('nodes');
const _IS_MOUNTED = Symbol('isMounted');
const _IN_CONTEXT_CALL = Symbol('inContextCall');
const _NAMESPACE = Symbol('namespace');
const _HAS_CHILD_COMPS = Symbol('hasChildComps');
const _RERENDER = Symbol('rerender');
const _SCHEDULE_UPDATE = Symbol('scheduleUpdate');
// Portal-specific
const _IS_PORTAL = Symbol('isPortal');
const _RENDERED = Symbol('rendered');
const _ANCHOR = Symbol('anchor');
const _CONTAINER = Symbol('container');

function Component(definition) {
    function ComponentClass() {
        const inst = {};

        const keys = Object.keys(definition);
        const len = keys.length;
        for (let i = 0; i < len; i++) {
            const key = keys[i];
            if (key === 'render' || key === 'init' || key === 'props' || key === 'memo' || key === 'onMounted' || key === 'onUpdated' || key === 'onUnmounted' || key === 'context') {
                continue;
            };

            const val = definition[key];
            if (typeof val === 'function') {
                inst[key] = val.bind(inst);
            } else {
                inst[key] = val;
            }
        }


        inst[_NAMESPACE] = HTML_NS;
        inst[_NODES] = EMPTY_ARRAY;
        inst[_DEF] = definition;

        inst[_PARENT_CTX] = null;
        inst[_INCOMING_PROPS] = null;
        inst[_VDOM] = null;
        inst[_IS_MOUNTED] = false;
        inst[_IN_CONTEXT_CALL] = false;
        inst[_HAS_CHILD_COMPS] = false;

        inst.props = EMPTY_PROPS;
        return inst;
    }
    ComponentClass._definition = definition;
    return ComponentClass;
}

// ============================================================================
// Batching
// ============================================================================

const batchQueue = new Set();
let isBatchScheduled = false;
let isFlushing = false;
let nestedUpdateCount = 0;
const NESTED_UPDATE_LIMIT = 50;
let refreshResolvers = [];

function scheduleUpdate(inst) {
    batchQueue.add(inst);
    if (!isBatchScheduled) {
        isBatchScheduled = true;
        if (!isFlushing) nestedUpdateCount = 0;
        Promise.resolve().then(flushBatch);
    }
}

function flushRefreshResolvers() {
    if (refreshResolvers.length === 0) return;
    const resolvers = refreshResolvers;
    refreshResolvers = [];
    for (let i = 0; i < resolvers.length; i++) {
        const finish = resolvers[i];
        try { finish(); } catch (err) { console.error('Error in refresh resolver:', err); }
    }
}

function flushBatch() {
    isFlushing = true;
    let hasError = false;
    try {
        nestedUpdateCount++;
        if (nestedUpdateCount > NESTED_UPDATE_LIMIT) {
            console.error('❌ Maximum update depth exceeded (' + NESTED_UPDATE_LIMIT + ').');
            batchQueue.clear();
            isBatchScheduled = false;
            hasError = true;
            return;
        }
        const toUpdate = [];
        let len = 0;
        const bq = Array.from(batchQueue); for (let bi = 0; bi < bq.length; bi++) { toUpdate[len++] = bq[bi]; }
        batchQueue.clear();
        isBatchScheduled = false;
        for (let ti = 0; ti < toUpdate.length; ti++) {
            const inst = toUpdate[ti];
            if (IS_DEV) {
                try { inst[_RERENDER](); } catch (err) {
                    const name = inst[_DEF]?.name || 'Component';
                    console.error('❌ Error in component "' + name + '":\n', err);
                }
            } else { inst[_RERENDER](); }
        }
        if (batchQueue.size > 0 && !isBatchScheduled) {
            isBatchScheduled = true;
            Promise.resolve().then(flushBatch);
        }
    } catch (err) {
        hasError = true;
        throw err;
    } finally {
        isFlushing = false;
        if (hasError || batchQueue.size === 0) flushRefreshResolvers();
    }
}

// ============================================================================
// Instance API
// ============================================================================

function attachInstanceAPI(inst) {
    // Локальные переменные замыкания — не свойства instance.
    // Меньше полей в конструкторе → стабильнее V8 hidden class → быстрее создание.
    const def = inst[_DEF];
    const { props: propsFn, memo: memoFn, init: initFn, render: renderFn, onUpdated: onUpdatedFn, context: contextDef } = def;
    let isUpdating = false;
    let isRendering = false;
    let isInitialized = false;
    let prevMemo = null;
    let updateResolvers = null;
    const refCollectors = {};
    const keyMap = new Map();

    inst[_RERENDER] = inst._rerender = function() {
        if (isUpdating) return;
        isUpdating = true;
        try { doRerender(); } catch (err) {
            if (IS_DEV) {
                const name = def.name || 'Component';
                console.error('❌ Error in component "' + name + '":', err);
            } else { throw err; }
        } finally {
            isUpdating = false;
            const resolvers = updateResolvers;
            updateResolvers = null;
            if (resolvers) { for (let i = 0; i < resolvers.length; i++) { resolvers[i](false); } }
        }
    };

    function doRerender() {
        const isFirstRender = !isInitialized;

        // props() — при первом render и при каждом update
        if (propsFn) { inst.props = propsFn.call(inst, inst[_INCOMING_PROPS]); }
        else { inst.props = inst[_INCOMING_PROPS] || {}; }

        // init() — только при первом render, до memo/render
        if (isFirstRender) {
            if (initFn) initFn.call(inst, inst.props);
            isInitialized = true;
        }

        let shouldRender = true;
        if (memoFn) {
            const newDeps = memoFn.call(inst, inst.props);
            if (prevMemo && newDeps.length === prevMemo.length) {
                let same = true;
                for (let i = 0; i < newDeps.length; i++) {
                    if (newDeps[i] !== prevMemo[i]) { same = false; break; }
                }
                if (same) shouldRender = false;
            }
            prevMemo = newDeps;
        }

        const oldVdom = inst[_VDOM];
        let newNodes;
        const version = ++reconcileVersion;
        keyMap._count = 0;

        if (shouldRender) {
            let newVdom;
            isRendering = true;
            try { newVdom = renderFn.call(inst, inst.props); } finally { isRendering = false; }
            inst[_HAS_CHILD_COMPS] = false;
            const prevQueue = mountedQueue;
            mountedQueue = [];

            const flat = [];
            reconcile2(newVdom, keyMap, version, '', inst[_NAMESPACE], inst, flat);

            // Cleanup только если в keyMap есть untouched oldElements.
            // keyMap._count = количество keyMap.set calls в этом render (без reuse).
            // Если keyMap.size > _count — есть старые элементы не переиспользованные/не заменённые.
            if (oldVdom && keyMap.size > keyMap._count) {
                for (const key of keyMap.keys()) {
                    const oldElement = keyMap.get(key);
                    if (oldElement._v !== version) {
                        unmountVdom(oldElement);
                        keyMap.delete(key);
                    }
                }
            }

            inst[_NODES] = flat;
            inst[_VDOM] = newVdom;

            triggerMounted();
            mountedQueue = prevQueue;

            if (inst[_IS_MOUNTED] && onUpdatedFn) {
                onUpdatedFn.call(inst);
            }
        } else {
            if (inst[_HAS_CHILD_COMPS]) {
                const flat = [];
                refreshMemoSubtree(oldVdom, keyMap, version, inst, inst[_NAMESPACE], flat);
                inst[_NODES] = flat;
            }
        }

        const resolvers = updateResolvers;
        updateResolvers = null;
        if (resolvers) { for (let i = 0; i < resolvers.length; i++) { resolvers[i](shouldRender); } }
    }

    inst.update = function(patch) {
        if (isRendering) {
            console.error('❌ Cannot call update() inside render().');
            return Promise.resolve(false);
        }
        if (patch && typeof patch === 'object') {
            let hasKeys = false;
            for (const k in patch) { hasKeys = true; break; }
            if (!hasKeys) {
                if (!isInitialized) return Promise.resolve(false);
                return inst[_SCHEDULE_UPDATE]();
            }
            let changed = false;
            for (const k in patch) { if (inst[k] !== patch[k]) { changed = true; break; } }
            if (!changed) return Promise.resolve(false);
            for (const k in patch) { inst[k] = patch[k]; }
        }
        if (!isInitialized) return Promise.resolve(false);
        return inst[_SCHEDULE_UPDATE]();
    };

    inst[_SCHEDULE_UPDATE] = function() {
        return new Promise(resolve => {
            if (!updateResolvers) updateResolvers = [];
            updateResolvers.push(resolve);
            scheduleUpdate(inst);
        });
    };

    inst.refs = function(name) {
        if (!refCollectors[name]) {
            refCollectors[name] = (node) => { inst.refs[name] = node; };
        }
        return refCollectors[name];
    };

    inst.context = function(key, ...args) {
        let p = inst[_PARENT_CTX];
        while (p) {
            const ctx = p[_DEF].context;
            if (ctx && typeof ctx[key] === 'function') { return ctx[key].apply(p, args); }
            p = p[_PARENT_CTX];
        }
        return undefined;
    };

    inst.contextSelf = function(key, ...args) {
        if (inst[_IN_CONTEXT_CALL]) throw new Error('contextSelf recursion');
        if (contextDef && typeof contextDef[key] === 'function') {
            inst[_IN_CONTEXT_CALL] = true;
            try {
                const res = contextDef[key].apply(inst, args);
                if (res !== undefined) return res;
            } finally { inst[_IN_CONTEXT_CALL] = false; }
        }
        return inst.context(key, ...args);
    };
}

// ============================================================================
// Keys
// ============================================================================

// Возвращает UID для user key: '#' + escapeKey(key).
// Запятая в key удваивается (,,) чтобы не ломать парсинг path.
function keyUID(key) {
    return '#' + (typeof key === 'string' && key.indexOf(',') !== -1 ? key.replace(/,/g, ',,') : key);
}

// ============================================================================
// Props
// ============================================================================

const CAMEL_TO_ATTR = { className: 'class', htmlFor: 'for', tabIndex: 'tabindex' };

function setHTMLProp(dom, key, value) {
    const strVal = value === true ? '' : "" + value;
    switch (key) {
        case 'class': case 'className': dom.className = strVal; return true;
        case 'id': dom.id = strVal; return true;
        case 'title': dom.title = strVal; return true;
        case 'src': dom.src = strVal; return true;
        case 'href': dom.href = strVal; return true;
        case 'alt': dom.alt = strVal; return true;
        case 'name': dom.name = strVal; return true;
        case 'placeholder': dom.placeholder = strVal; return true;
        case 'disabled': dom.disabled = !!value; return true;
        case 'readOnly': case 'readonly': dom.readOnly = !!value; return true;
        case 'hidden': dom.hidden = !!value; return true;
        case 'tabIndex': case 'tabindex': dom.tabIndex = +value; return true;
        case 'draggable': dom.draggable = !!value; return true;
        case 'contentEditable': case 'contenteditable': dom.contentEditable = value; return true;
        default: return false;
    }
}

function applyProp(dom, key, value, namespace) {
    if (key === 'key' || key === 'ref' || key === 'children') return;
    const isSVG = namespace === SVG_NS;
    const tag = dom._tagName;

    if (!isSVG) {
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            if (key === 'value') {
                if (tag === 'SELECT' && dom.multiple) {
                    const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
                    for (let i = 0; i < dom.options.length; i++) {
                        dom.options[i].selected = values.includes(dom.options[i].value);
                    }
                    return;
                }
                if (tag === 'INPUT' && dom.type === 'file') return;
                const strVal = value == null ? '' : "" + value;
                if (dom.value !== strVal) dom.value = strVal;
                dom.setAttribute('value', strVal);
                return;
            }
            if (key === 'checked') {
                dom.checked = !!value;
                if (value) dom.setAttribute('checked', ''); else dom.removeAttribute('checked');
                return;
            }
            if (tag === 'SELECT' && key === 'multiple') {
                dom.multiple = !!value;
                if (value) dom.setAttribute('multiple', ''); else dom.removeAttribute('multiple');
                return;
            }
        }
        if (tag === 'OPTION' && key === 'selected') {
            dom.selected = !!value;
            if (value) dom.setAttribute('selected', ''); else dom.removeAttribute('selected');
            return;
        }
    }

    if (key.length > 2 && key[0] === 'o' && key[1] === 'n') {
        const eventType = key.substring(2).toLowerCase();
        const store = dom._evtStore || (dom._evtStore = {});
        const oldHandler = store[eventType];
        if (oldHandler) dom.removeEventListener(eventType, oldHandler);
        if (typeof value === 'function') { dom.addEventListener(eventType, value); store[eventType] = value; }
        else { delete store[eventType]; }
        return;
    }

    if (key === 'dangerouslySetInnerHTML') {
        if (value && value.__html != null) dom.innerHTML = value.__html;
        return;
    }

    if (key === 'style') {
        if (value == null) { dom.style.cssText = ''; }
        else if (typeof value === 'object') {
            let css = '';
            for (const p in value) {
                const cssProp = p.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
                css += cssProp + ':' + value[p] + ';';
            }
            dom.style.cssText = css;
        } else { dom.style.cssText = "" + value; }
        return;
    }

    if (value === false || value == null) {
        if (isSVG) {
            if (key === 'xlinkHref') { dom.removeAttributeNS(XLINK_NS, 'href'); }
            else { dom.removeAttribute(key); }
        } else {
            const attr = CAMEL_TO_ATTR[key] || key.toLowerCase();
            dom.removeAttribute(attr);
        }
        return;
    }

    if (isSVG) {
        if (key === 'xlinkHref') { dom.setAttributeNS(XLINK_NS, 'xlink:href', value); }
        else { dom.setAttribute(key, value === true ? '' : "" + value); }
        return;
    }

    if (!setHTMLProp(dom, key, value)) {
        const attr = CAMEL_TO_ATTR[key] || key.toLowerCase();
        dom.setAttribute(attr, value === true ? '' : "" + value);
    }
}

function applyPropsDirect(dom, props, namespace) {
    if (!props) return;
    const isSVG = namespace === SVG_NS;
    const tag = dom._tagName;
    const isFormElement = !isSVG && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
    const isSelect = tag === 'SELECT';
    for (const k in props) {
        if (k === 'key' || k === 'ref' || k === 'children') continue;
        if (isFormElement && (k === 'value' || k === 'checked')) continue;
        applyProp(dom, k, props[k], namespace);
    }
    if (isFormElement && !isSelect) {
        if ('value' in props) applyProp(dom, 'value', props.value, namespace);
        if ('checked' in props) applyProp(dom, 'checked', props.checked, namespace);
    }
}

function applyProps(dom, oldProps, newProps, namespace) {
    oldProps = oldProps || EMPTY_PROPS;
    newProps = newProps || EMPTY_PROPS;
    const isSVG = namespace === SVG_NS;
    const tag = dom._tagName;
    const isFormElement = !isSVG && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

    // Удаляем атрибуты, которых нет в новых props.
    // SELECT value не удаляем — оно применяется отдельно в reconcile2HTML после syncDOMChildren.
    for (const k in oldProps) {
        if (!(k in newProps)) {
            if (tag === 'SELECT' && k === 'value') continue;
            applyProp(dom, k, null, namespace);
        }
    }

    // Применяем изменённые атрибуты (value/checked для form-элементов — отдельно ниже)
    for (const k in newProps) {
        if (isFormElement && (k === 'value' || k === 'checked')) continue;
        if (oldProps[k] !== newProps[k]) { applyProp(dom, k, newProps[k], namespace); }
    }

    // value/checked для form-элементов — после остальных атрибутов.
    // SELECT не трогаем здесь: его value применяется в reconcile2HTML после syncDOMChildren
    // (нужны options в DOM для установки selected).
    if (isFormElement && tag !== 'SELECT') {
        if ('value' in newProps && oldProps.value !== newProps.value) { applyProp(dom, 'value', newProps.value, namespace); }
        if ('checked' in newProps && oldProps.checked !== newProps.checked) { applyProp(dom, 'checked', newProps.checked, namespace); }
    }
}

// ============================================================================
// Lifecycle
// ============================================================================

// Массив-коллектор для новых компонентов во время reconcile2.
// Сбрасывается перед reconcile2, вызывается onMounted после (в обратном порядке — children-first).
let mountedQueue = null;

function triggerMounted() {
    if (!mountedQueue) return;
    // Вызываем в обратном порядке — дочерние компоненты добавлены в очередь позже родительского,
    // но onMounted должны получить раньше (children-first).
    for (let i = mountedQueue.length - 1; i >= 0; i--) {
        const inst = mountedQueue[i];
        const d = inst[_DEF];
        try { if (d.onMounted) d.onMounted.call(inst); } catch (err) {
            const name = d.name || 'Component';
            console.error('❌ Error in onMounted of "' + name + '":\n', err);
        }
    }
    mountedQueue = null;
}

function unmountVdom(vnode, seen) {
    if (vnode == null || typeof vnode !== 'object') return;
    if (vnode._unmounted) return; // Защита от двойного вызова (Bug 4)
    vnode._unmounted = true;
    if (IS_DEV) {
        if (!seen) seen = new WeakSet();
        if (seen.has(vnode)) return;
        seen.add(vnode);
    }
    if (Array.isArray(vnode)) {
        for (let i = 0; i < vnode.length; i++) unmountVdom(vnode[i], seen);
        return;
    }
    if (vnode._text !== undefined) {
        removeDOMNode(vnode._el);
        return;
    }

    // ref(null) — общий для всех non-text узлов с ref
    vnode.props?.ref?.(null);

    if (vnode.tag === Portal) {
        const inst = vnode._instance;
        if (inst) {
            if (inst[_RENDERED]) unmountVdom(inst[_RENDERED], seen);
            removeDOMNode(inst[_ANCHOR]);
            // Узлы портала лежат в inst[_CONTAINER] — удаляем только те, что в нём
            if (inst[_CONTAINER]) {
                for (let i = 0; i < inst[_NODES].length; i++) {
                    const n = inst[_NODES][i];
                    if (n?.parentNode === inst[_CONTAINER]) inst[_CONTAINER].removeChild(n);
                }
            }
        }
        return;
    }
    if (typeof vnode.tag === 'function' && vnode.tag._definition) {
        // Компонент: onUnmounted + удаление DOM-узлов + рекурсивный unmount inst[_VDOM]
        const inst = vnode._instance;
        if (inst) {
            const d = inst[_DEF];
            if (d?.onUnmounted) d.onUnmounted.call(inst);
            if (inst[_NODES]) {
                const instNodes = inst[_NODES]; for (let ni = 0; ni < instNodes.length; ni++) removeDOMNode(instNodes[ni]);
            }
            if (inst[_VDOM]) unmountVdom(inst[_VDOM], seen);
        }
        return;
    }
    if (vnode.tag === Fragment) {
        // Fragment: удаляем все DOM-узлы, затем рекурсивно unmount детей
        if (vnode._nodes) {
            const vnodeNodes = vnode._nodes; for (let ni = 0; ni < vnodeNodes.length; ni++) removeDOMNode(vnodeNodes[ni]);
        }
    } else if (typeof vnode.tag === 'string') {
        // HTML: удаляем сам элемент (дети удалятся браузером, но vnode нужно обойти для onUnmounted/ref)
        removeDOMNode(vnode._el);
    }
    if (vnode.childs) {
        for (let i = 0; i < vnode.childs.length; i++) unmountVdom(vnode.childs[i], seen);
    }
}

// ============================================================================
// DOM sync
// ============================================================================

// Безопасное удаление DOM-узла из его текущего родителя.
function removeDOMNode(node) {
    if (node?.parentNode) node.parentNode.removeChild(node);
}

function syncDOMChildren(parentDOM, oldNodes, newNodes) {
    const nlen = newNodes.length;

    // Fast path: первый mount — oldNodes пустой.
    // Просто append'им все узлы по порядку. Это быстрее insertBefore (особенно в реальном браузере).
    if (oldNodes.length === 0) {
        for (let i = 0; i < nlen; i++) {
            parentDOM.appendChild(newNodes[i]);
        }
        return;
    }

    // Быстрая проверка: если массивы идентичны — ничего не делаем
    if (oldNodes.length === nlen) {
        let same = true;
        for (let i = 0; i < nlen; i++) {
            if (oldNodes[i] !== newNodes[i]) { same = false; break; }
        }
        if (same) return;
    }

    // Выстраиваем newNodes в правильном порядке.
    // Идём с конца, чтобы не ломать nextSibling.
    // Старые узлы, которых нет в newNodes, НЕ удаляем здесь — это делает unmountVdom
    // (т.к. нужно вызвать onUnmounted, ref(null) и т.д.)
    //
    // expectedNext всегда в parentDOM на момент проверки: мы идём с конца, и expectedNext
    // (newNodes[i+1]) уже обработан на предыдущей итерации — либо appendChild'd, либо
    // insertBefore'd. Поэтому проверку parentNode опускаем.
    for (let i = nlen - 1; i >= 0; i--) {
        const n = newNodes[i];
        if (i + 1 < nlen) {
            const expectedNext = newNodes[i + 1];
            if (n.nextSibling !== expectedNext) {
                parentDOM.insertBefore(n, expectedNext);
            }
        } else {
            parentDOM.appendChild(n);
        }
    }
}

// ============================================================================
// ============================================================================
// Reconcile2 — рекурсивный алгоритм с out-параметром
// ============================================================================

function reconcile2(vnode, keyMap, version, path, namespace, ctx, out) {
    if (vnode == null) return;

    // Bug 3 fix: Handle raw strings/numbers in nested arrays
    if (typeof vnode === 'string' || typeof vnode === 'number') {
        vnode = { _text: typeof vnode === 'string' ? vnode : '' + vnode };
    }

    if (Array.isArray(vnode)) {
        const len = vnode.length;
        if (len === 0) return;
        const prefix = path + ',';
        for (let i = 0; i < len; i++) {
            reconcile2(vnode[i], keyMap, version, prefix + i, namespace, ctx, out);
        }
        return;
    }

    if (vnode._text !== undefined) {
        const elementUID = path;
        const oldElement = keyMap.get(elementUID);

        if (oldElement && oldElement._text !== undefined) {
            if (oldElement._text !== vnode._text) {
                oldElement._el.nodeValue = vnode._text;
                oldElement._text = vnode._text;
            }
            oldElement._v = version;
            out.push(oldElement._el);
            return;
        }

        if (oldElement) {
            unmountVdom(oldElement);
        }

        const t = document.createTextNode(vnode._text);
        vnode._el = t;
        vnode._v = version;
        keyMap._count++;
        keyMap.set(elementUID, vnode);
        out.push(t);
        return;
    }

    // Вычисляем elementUID. duplicate key detection через _v field:
    // если keyed element уже есть в keyMap с _v === version — он уже использован в этом render.
    let elementUID;
    const userKey = vnode.props?.key;
    if (userKey !== undefined) {
        const keyedUID = keyUID(userKey);
        const existing = keyMap.get(keyedUID);
        if (existing && existing._v === version) {
            if (IS_DEV) console.warn(`⚠️ Warning: Duplicate key "${userKey}" detected. First occurrence wins, duplicates treated as no-key.`);
            elementUID = path;
        } else {
            elementUID = keyedUID;
        }
    } else {
        elementUID = path;
    }

    const tag = vnode.tag;
    const oldElement = keyMap.get(elementUID);

    // Порядок проверок: string (чаще всего) → Fragment → Component → Portal
    if (typeof tag === 'string') { reconcile2HTML(vnode, keyMap, version, elementUID, namespace, ctx, oldElement, out); return; }
    if (tag === Fragment) { reconcile2Fragment(vnode, keyMap, version, elementUID, namespace, ctx, oldElement, out); return; }
    if (typeof tag === 'function' && tag._definition) {
        if (ctx) ctx[_HAS_CHILD_COMPS] = true;
        reconcile2Component(vnode, keyMap, version, elementUID, namespace, ctx, oldElement, out); return;
    }
    if (tag === Portal) { reconcile2Portal(vnode, keyMap, version, elementUID, namespace, ctx, oldElement, out); return; }
}

function reconcile2HTML(vnode, keyMap, version, path, namespace, ctx, oldElement, out) {
    const tag = vnode.tag;

    // Fast path: первый mount простого HTML-элемента (не SVG, не textarea).
    if (!oldElement && namespace === HTML_NS && tag !== 'svg' && tag !== 'foreignObject' && tag !== 'textarea') {
        const dom = createElement(null, tag);
        const tagName = dom._tagName;
        const isForm = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
        const props = vnode.props;
        if (props) {
            for (const k in props) {
                if (k === 'key' || k === 'ref' || k === 'children') continue;
                if (isForm && (k === 'value' || k === 'checked')) continue;
                applyProp(dom, k, props[k], namespace);
            }
            if (isForm && tagName !== 'SELECT') {
                if ('value' in props) applyProp(dom, 'value', props.value, namespace);
                if ('checked' in props) applyProp(dom, 'checked', props.checked, namespace);
            }
        }
        vnode._el = dom;
        vnode._v = version; keyMap._count++; keyMap.set(path, vnode);
        props?.ref?.(dom);

        const newNodes = [];
        reconcile2(vnode.childs, keyMap, version, path, namespace, ctx, newNodes);
        vnode._nodes = newNodes;
        syncDOMChildren(dom, EMPTY_ARRAY, newNodes);

        if (tagName === 'SELECT' && props && 'value' in props) {
            applyProp(dom, 'value', props.value, namespace);
        }
        out.push(dom);
        return;
    }

    if (tag === 'svg') namespace = SVG_NS;
    const isForeignObject = tag === 'foreignObject';

    let dom;
    let oldNodes = [];

    if (oldElement && typeof oldElement.tag === 'string' && oldElement.tag === vnode.tag) {
        dom = oldElement._el;
        oldNodes = oldElement._nodes || [];
        vnode._v = version; keyMap._count++; keyMap.set(path, vnode);

        const oldProps = oldElement.props;
        const newProps = vnode.props;
        if (oldProps !== newProps) {
            let propsChanged = false;
            let count1 = 0;
            for (const key in oldProps) {
                count1++;
                if (newProps[key] !== oldProps[key]) { propsChanged = true; break; }
            }
            if (!propsChanged) {
                let count2 = 0;
                for (const key in newProps) count2++;
                propsChanged = count1 !== count2;
            }
            if (propsChanged) {
                applyProps(dom, oldElement.props, vnode.props, namespace);
            }
        }
    } else {
        dom = createElement(namespace, vnode.tag)
        applyPropsDirect(dom, vnode.props, namespace);
        if (oldElement) unmountVdom(oldElement);
        vnode._v = version; keyMap._count++; keyMap.set(path, vnode);
    }

    vnode._el = dom;
    vnode.props?.ref?.(dom);

    if (tag === 'textarea') { vnode._nodes = []; out.push(dom); return; }

    // Fast path: single text child, old also had single text child.
    // Common pattern: <div key={id}>text</div> в list rows.
    // Скипает reconcile2 call, syncDOMChildren, SELECT value check.
    if (vnode.childs && vnode.childs.length === 1 && oldNodes.length === 1) {
        const onlyChild = vnode.childs[0];
        if (onlyChild && onlyChild._text !== undefined) {
            const textPath = path + ',0';
            const oldChild = keyMap.get(textPath);
            if (oldChild && oldChild._text !== undefined) {
                const text = onlyChild._text;
                if (oldChild._text !== text) {
                    oldChild._el.nodeValue = text;
                    oldChild._text = text;
                }
                oldChild._v = version;
                vnode._nodes = oldNodes;
                out.push(dom);
                return;
            }
        }
    }

    const childNamespace = isForeignObject ? HTML_NS : namespace;
    const newNodes = [];
    if (vnode.childs?.length || !Array.isArray(vnode.childs)) {
        reconcile2(vnode.childs, keyMap, version, path, childNamespace, ctx, newNodes);
    };
    vnode._nodes = newNodes;

    syncDOMChildren(dom, oldNodes, newNodes);

    if (dom._tagName === 'SELECT' && 'value' in vnode.props) {
        applyProp(dom, 'value', vnode.props.value, namespace);
    }

    out.push(dom);
}

function reconcile2Fragment(vnode, keyMap, version, path, namespace, ctx, oldElement, out) {
    // Fragment — прозрачная группа: vnode в keyMap не хранится,
    // переиспользование детей идёт по их собственным UID.
    // oldElement (если есть) — vnode другого типа на этой позиции → unmount.
    if (oldElement) unmountVdom(oldElement);
    const nodes = [];
    reconcile2(vnode.childs, keyMap, version, path, namespace, ctx, nodes);
    vnode._nodes = nodes;
    for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
}

function reconcile2Component(vnode, keyMap, version, path, namespace, ctx, oldElement, out) {
    const def = vnode.tag._definition;

    const canReuse = oldElement && oldElement.tag === vnode.tag && oldElement._instance;
    let inst;

    if (canReuse) {
        inst = oldElement._instance;
    } else {
        if (oldElement) unmountVdom(oldElement);
        inst = new vnode.tag();
        attachInstanceAPI(inst);
    }

    // Общий setup для обоих путей (reuse и create)
    vnode._v = version; keyMap._count++; keyMap.set(path, vnode);
    inst[_INCOMING_PROPS] = buildIncomingProps(vnode.props, vnode.childs);
    inst[_PARENT_CTX] = ctx;
    inst[_NAMESPACE] = namespace;
    vnode._instance = inst;

    // Рендер (общий для обоих путей).
    // Изоляция ошибок только в DEV. В PROD ошибка пробрасывается (fail fast).
    if (IS_DEV) {
        try { inst[_RERENDER](); } catch (err) {
            const name = def.name || 'Component';
            console.error('❌ Error in component "' + name + '":\n', err);
            if (!canReuse) inst[_NODES] = [];
        }
    } else {
        inst[_RERENDER]();
    }

    if (!canReuse) {
        // ref для нового компонента — после rerender (inst готов)
        vnode.props?.ref?.(inst);
        // Добавляем в очередь для onMounted (вызовется после всего reconcile2)
        if (mountedQueue) {
            inst[_IS_MOUNTED] = true;
            mountedQueue.push(inst);
        }
    }

    // Компонент возвращает массив узлов (inst[_NODES]) — добавляем в out
    const nodes = inst[_NODES];
    if (nodes) {
        for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
    }
}


function reconcilePortalChildren(inst, vnode, keyMap, version, path, namespace, ctx) {
    const container = vnode.props.containerGetter();

    // Case 1: первый mount — контейнера ещё не было, теперь есть.
    // Дети портала используют родительский keyMap/version (portal не изолирует детей).
    if (!inst[_CONTAINER] && container) {
        inst[_CONTAINER] = container;
        const childNodes = [];
        reconcile2(vnode.childs, keyMap, version, path, namespace, ctx, childNodes);
        inst[_RENDERED] = vnode.childs;
        inst[_NODES] = childNodes;
        appendAll(container, inst[_NODES]);
        return;
    }

    // Case 2: контейнер исчез — размонтируем контент.
    // unmountVdom удалит vnode, родительский cleanup уберёт из keyMap (по version).
    if (inst[_CONTAINER] && !container) {
        if (inst[_RENDERED]) unmountVdom(inst[_RENDERED]);
        inst[_RENDERED] = null;
        inst[_NODES] = [];
        inst[_CONTAINER] = null;
        return;
    }

    // Case 3: контейнер есть и был — reconcile детей
    if (!inst[_CONTAINER] || !container) return;  // защитный guard (не должен срабатывать)

    // Смена контейнера — физически перемещаем узлы без unmount
    if (inst[_CONTAINER] !== container) {
        const oldContainer = inst[_CONTAINER];
        inst[_CONTAINER] = container;
        for (let i = 0; i < inst[_NODES].length; i++) {
            const n = inst[_NODES][i];
            if (n?.parentNode === oldContainer) {
                oldContainer.removeChild(n);
                container.appendChild(n);
            }
        }
    }

    // Reconcile детей портала с родительским keyMap/version.
    // reconcile2 заполнит keyMap/version, cleanup сделает родитель.
    const oldNodes = inst[_NODES];
    const newNodes = [];
    reconcile2(vnode.childs, keyMap, version, path, namespace, ctx, newNodes);

    inst[_RENDERED] = vnode.childs;
    inst[_NODES] = newNodes;
    syncDOMChildren(container, oldNodes, newNodes);
}

function reconcile2Portal(vnode, keyMap, version, path, namespace, ctx, oldElement, out) {
    let inst = null;

    if (oldElement && oldElement.tag === Portal && oldElement._instance) {
        inst = oldElement._instance;
    } else {
        if (oldElement) {
            unmountVdom(oldElement);
        }
        inst = {
            [_IS_PORTAL]: true,
            [_RENDERED]: null,
            [_NODES]: [],
            [_ANCHOR]: document.createTextNode(''),
            [_CONTAINER]: null,
            [_NAMESPACE]: namespace
        };
    }
    // Записываем vnode в keyMap (для обоих путей — reuse и create)
    vnode._v = version; keyMap._count++; keyMap.set(path, vnode);

    vnode._instance = inst;
    inst[_NAMESPACE] = namespace;
    vnode.props?.ref?.(inst);

    reconcilePortalChildren(inst, vnode, keyMap, version, path, namespace, ctx);

    out.push(inst[_ANCHOR]);
}

// ============================================================================
// Memo-skip
// ============================================================================

function refreshMemoSubtree(vnode, keyMap, version, ctx, namespace, out) {
    if (vnode == null) return;
    if (Array.isArray(vnode)) {
        for (let i = 0; i < vnode.length; i++) { refreshMemoSubtree(vnode[i], keyMap, version, ctx, namespace, out); }
        return;
    }
    if (vnode._text !== undefined) {
        if (vnode._el) out.push(vnode._el);
        return;
    }

    const tag = vnode.tag;

    if (tag === Portal) {
        const inst = vnode._instance;
        if (inst) {
            // Memo-skip path: only check container change, don't re-render children
            const container = vnode.props.containerGetter();

            // Case 1: first mount (shouldn't happen in memo-skip, but handle it)
            if (!inst[_CONTAINER] && container) {
                inst[_CONTAINER] = container;
                appendAll(container, inst[_NODES]);
            }
            // Case 2: container disappeared
            else if (inst[_CONTAINER] && !container) {
                inst[_CONTAINER] = null;
            }
            // Case 3: container changed
            else if (inst[_CONTAINER] !== container && container) {
                const oldContainer = inst[_CONTAINER];
                inst[_CONTAINER] = container;
                for (let i = 0; i < inst[_NODES].length; i++) {
                    const n = inst[_NODES][i];
                    if (n?.parentNode === oldContainer) {
                        oldContainer.removeChild(n);
                        container.appendChild(n);
                    }
                }
            }
        }
        if (inst && inst[_NODES]) { for (let i = 0; i < inst[_NODES].length; i++) out.push(inst[_NODES][i]); }
        return;
    }

    if (typeof tag === 'function' && tag._definition) {
        const inst = vnode._instance;
        if (inst) {
            if (IS_DEV) {
                try { inst[_RERENDER](); } catch (err) {
                    const name = inst[_DEF]?.name || 'Component';
                    console.error('❌ Error in component "' + name + '":\n', err);
                }
            } else {
                inst[_RERENDER]();
            }
            if (inst[_NODES]) { for (let i = 0; i < inst[_NODES].length; i++) out.push(inst[_NODES][i]); }
        }
        return;
    }

    if (tag === Fragment) {
        if (vnode.childs) {
            for (let i = 0; i < vnode.childs.length; i++) { refreshMemoSubtree(vnode.childs[i], keyMap, version, ctx, namespace, out); }
        }
        return;
    }

    if (vnode.childs) {
        for (let i = 0; i < vnode.childs.length; i++) { refreshMemoSubtree(vnode.childs[i], keyMap, version, ctx, namespace, out); }
    }
    if (vnode._el) out.push(vnode._el);
}

// ============================================================================
// Props helpers
// ============================================================================

function buildIncomingProps(rawProps, childs) {
    const out = {children: rawProps.children ?? childs};
    for (const k in rawProps) {
        if (k === 'key' || k === 'ref' || k === 'children') continue;
        out[k] = rawProps[k];
    }
    return out;
}

// ============================================================================
// Mount — точка входа
// ============================================================================

function normalizeMountInput(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'string') { return { _text: input }; }
    if (typeof input === 'number') { return { _text: '' + input }; }
    if (typeof input === 'function' && input._definition) return h(input, {});
    if (Array.isArray(input)) return h(Fragment, {}, ...input);
    if (typeof input === 'object') return input;
    throw new Error('mount(): unsupported input type: ' + typeof input);
}

function collectAllInstances(vnode) {
    const result = [];
    let len = 0;
    function walk(node) {
        if (!node) return;
        if (Array.isArray(node)) { for (let ci = 0; ci < node.length; ci++) walk(node[ci]); return; }
        if (typeof node !== 'object') return;
        if (typeof node.tag === 'function' && node.tag._definition) {
            const inst = node._instance;
            if (inst && inst[_RERENDER]) { result[len++] = inst; if (inst[_VDOM]) walk(inst[_VDOM]); }
            return;
        }
        if (node.tag === Portal) { const inst = node._instance; if (inst && inst[_RENDERED]) walk(inst[_RENDERED]); return; }
        if (node.tag === Fragment) { if (Array.isArray(node.childs)) { for (let ci = 0; ci < node.childs.length; ci++) walk(node.childs[ci]); } return; }
        if (node.childs) { for (let ci = 0; ci < node.childs.length; ci++) walk(node.childs[ci]); }
    }
    walk(vnode);
    result.reverse(); // children-first: дочерние компоненты обновляются раньше родительских
    return result;
}

const mountedTrees = new WeakMap();
const mountedKeyMaps = new WeakMap();
const mountedRootInstances = new WeakMap();
const mountedNodes = new WeakMap(); // top-level DOM узлы для syncDOMChildren
const mountedContainers = new Set();

function mount(input, container) {
    const vnode = normalizeMountInput(input);
    const oldVnode = mountedTrees.get(container);

    if (vnode === null) {
        if (oldVnode) {
            unmountVdom(oldVnode);
            container.replaceChildren();
            mountedTrees.delete(container);
            mountedKeyMaps.delete(container);
            mountedRootInstances.delete(container);
            mountedNodes.delete(container);
            mountedContainers.delete(container);
        }
        return;
    }

    if (!oldVnode) {
        // Первый mount: keyMap пустой. version инкрементируется, vnodes помечаются _v.
        // duplicate detection через _v field, cleanup не нужен (keyMap пустой).
        const keyMap = new Map();
        const version = ++reconcileVersion;
        mountedQueue = [];  // собираем новые компоненты для onMounted
        const flat = [];
        reconcile2(vnode, keyMap, version, '', HTML_NS, null, flat);

        for (let i = 0; i < flat.length; i++) {
            container.appendChild(flat[i]);
        }

        mountedTrees.set(container, vnode);
        mountedKeyMaps.set(container, keyMap);
        // Сохраняем корневой instance для refresh(). null если корень — не компонент.
        mountedRootInstances.set(container, vnode._instance || null);
        mountedNodes.set(container, flat);
        mountedContainers.add(container);
        triggerMounted();  // вызывает onMounted для всех собранных компонентов
        return vnode;
    }

    // Повторный mount: keyMap персистентный, после прошлого mount + cleanup актуальный.
    // populateKeyMap НЕ нужен — reconcile2 сам заполняет, cleanup удаляет неиспользуемые.
    const keyMap = mountedKeyMaps.get(container);
    const version = ++reconcileVersion;
    keyMap._count = 0;
    mountedQueue = [];

    // oldNodes — сохранённые при прошлом mount top-level DOM узлы (без O(n) обхода).
    const oldNodes = mountedNodes.get(container) || [];
    const flat = [];
    reconcile2(vnode, keyMap, version, '', HTML_NS, null, flat);

    // Cleanup только если в keyMap есть untouched oldElements.
    if (keyMap.size > keyMap._count) {
        keyMap.forEach((oldElement, key) => {
            if (oldElement._v !== version) {
                unmountVdom(oldElement);
                keyMap.delete(key);
            }
        });
    }

    syncDOMChildren(container, oldNodes, flat);
    mountedTrees.set(container, vnode);
    mountedRootInstances.set(container, vnode._instance || null);
    mountedNodes.set(container, flat);
    triggerMounted();

    return vnode;
}

// ============================================================================
// Refresh
// ============================================================================

function refresh() {
    const start = performance.now();
    const _containers = Array.from(mountedContainers);
    for (let ci = 0; ci < _containers.length; ci++) {
        const container = _containers[ci];
        const rootInst = mountedRootInstances.get(container);
        if (rootInst) {
            // Корневой компонент — update() запустит reconcile2, который обойдёт всё поддерево.
            try { rootInst.update(); } catch (err) { console.error('refresh():', rootInst[_DEF]?.name || 'Component', err); }
        } else {
            // Корень — не компонент (HTML/Fragment). Обходим дерево чтобы найти компоненты.
            const vnode = mountedTrees.get(container);
            if (!vnode) continue;
            const instances = collectAllInstances(vnode);
            for (let ii = 0; ii < instances.length; ii++) {
            const inst = instances[ii];
                try { inst.update(); } catch (err) { console.error('refresh():', inst[_DEF]?.name || 'Component', err); }
            }
        }
    }
    return new Promise(resolve => {
        const finish = () => resolve(performance.now() - start);
        if (batchQueue.size === 0 && !isBatchScheduled) { finish(); }
        else { refreshResolvers.push(finish); }
    });
}

function _cleanupAll() {
    const containers = [];
    let len = 0;
    for (const container of mountedContainers) { containers[len++] = container; }
    for (let i = 0; i < len; i++) { try { mount(null, containers[i]); } catch (e) {} }
}

export { h, Component, createPortal, Fragment, mount, refresh, _cleanupAll, setDevMode };

if (typeof window !== 'undefined') {
    window.VDOM = { h, Component, createPortal, Fragment, mount, refresh, _cleanupAll, setDevMode };
}