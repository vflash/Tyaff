// ============================================================================
// VDOM Library — custom VDOM, diff/patch, context tree, portals, refs
// ============================================================================

const Fragment = Symbol('Fragment');
const Portal = Symbol('Portal');
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

function pushAll(target, source) {
    if (source == null) return;
    if (Array.isArray(source)) {
        for (let i = 0; i < source.length; i++) target.push(source[i]);
    } else {
        target.push(source);
    }
}

const PREPEND_CHUNK_SIZE = 20000;

function prependAll(parent, nodes) {
    if (!nodes || nodes.length === 0) return;
    if (nodes.length <= PREPEND_CHUNK_SIZE) {
        parent.prepend(...nodes);
        return;
    }
    for (let i = nodes.length; i > 0; i -= PREPEND_CHUNK_SIZE) {
        const start = Math.max(0, i - PREPEND_CHUNK_SIZE);
        parent.prepend(...nodes.slice(start, i));
    }
}

function collectDOMNodes(childs) {
    const result = [];
    function walk(node) {
        if (node == null) return;
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) walk(node[i]);
            return;
        }
        if (typeof node !== 'object') return;
        if (node.nodeType) {
            result.push(node);
            return;
        }
        if (node._instance) {
            const inst = node._instance;
            if (inst._anchor && inst._anchor.nodeType) result.push(inst._anchor);
            // Для Portal НЕ recurse в _nodes — они физически в другом контейнере
            if (!inst._isPortal && Array.isArray(inst._nodes)) {
                for (let i = 0; i < inst._nodes.length; i++) walk(inst._nodes[i]);
            }
            return;
        }
        if (node._el) {
            result.push(node._el);
            return;
        }
        if (Array.isArray(node._nodes)) {
            for (let i = 0; i < node._nodes.length; i++) walk(node._nodes[i]);
        }
    }
    walk(childs);
    return result;
}

function h(type, props, ...children) {
    const normalized = [];
    for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c == null || c === false || c === true) {
            normalized.push(null);
        } else if (typeof c === 'string' || typeof c === 'number') {
            normalized.push({ _text: String(c) });
        } else {
            normalized.push(c);
        }
    }
    return { tag: type, props: props || {}, childs: normalized };
}

function createPortal(children, containerGetter) {
    const kids = Array.isArray(children) ? children : [children];
    return { tag: Portal, props: { containerGetter }, childs: kids };
}

function Component(definition) {
    function ComponentClass() {
        for (const key in definition) {
            if (key === 'context') continue;
            const val = definition[key];
            if (typeof val !== 'function') {
                this[key] = val;
            }
        }
        this._definition = definition;
        this._parentContext = null;
        this._incomingProps = null;
        this.props = {};
        this._vdom = null;
        this._nodes = [];
        this._parentDOM = null;
        this._prevMemo = null;
        this._keyMap = new Map();
        this._refCollectors = {};
        this._isMounted = false;
        this._isUpdating = false;
        this._isRendering = false;
        this._isInitializing = false;
        this._inContextCall = false;
        this._namespace = HTML_NS;
    }
    ComponentClass._definition = definition;
    return ComponentClass;
}

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
    for (const finish of resolvers) {
        try {
            finish();
        } catch (err) {
            console.error('Error in refresh resolver:', err);
        }
    }
}

function flushBatch() {
    isFlushing = true;
    try {
        nestedUpdateCount++;
        if (nestedUpdateCount > NESTED_UPDATE_LIMIT) {
            console.error(
                '❌ Maximum update depth exceeded (' + NESTED_UPDATE_LIMIT + ').\n' +
                'This happens when a component repeatedly calls update() ' +
                'inside onUpdated() or another lifecycle method.'
            );
            batchQueue.clear();
            isBatchScheduled = false;
            flushRefreshResolvers();
            return;
        }

        const toUpdate = Array.from(batchQueue);
        batchQueue.clear();
        isBatchScheduled = false;

        for (const inst of toUpdate) {
            try {
                inst._rerender();
            } catch (err) {
                const name = inst._definition && inst._definition.name
                    ? inst._definition.name : 'Component';
                console.error('❌ Error in component "' + name + '":\n', err);
            }
        }

        if (batchQueue.size > 0 && !isBatchScheduled) {
            isBatchScheduled = true;
            Promise.resolve().then(flushBatch);
        } else if (batchQueue.size === 0) {
            flushRefreshResolvers();
        }
    } finally {
        isFlushing = false;
    }
}

function attachInstanceAPI(inst) {
    const def = inst._definition;

    inst._rerender = function() {
        if (this._isUpdating) return;
        this._isUpdating = true;
        try {
            const d = this._definition;
            if (d.props) {
                this.props = d.props.call(this, this._incomingProps);
            } else {
                this.props = this._incomingProps || {};
            }

            let shouldRender = true;
            if (d.memo) {
                const newDeps = d.memo.call(this, this.props);
                if (this._prevMemo && newDeps.length === this._prevMemo.length) {
                    let same = true;
                    for (let i = 0; i < newDeps.length; i++) {
                        if (newDeps[i] !== this._prevMemo[i]) { same = false; break; }
                    }
                    if (same) shouldRender = false;
                }
                this._prevMemo = newDeps;
            }

            const oldVdom = this._vdom;
            let newVdom;

            if (shouldRender) {
                this._keyMap.clear();
                if (oldVdom) populateKeyMap(oldVdom, '', this._keyMap);
                this._isRendering = true;
                try {
                    newVdom = d.render.call(this, this.props);
                } finally {
                    this._isRendering = false;
                }
            } else {
                newVdom = oldVdom;
            }

            const oldNodes = this._nodes;
            const wasFirstRender = !oldVdom;

            const newNodes = reconcile(
                oldVdom, newVdom, this._parentDOM, this, '',
                this._keyMap, this._namespace
            );
            const flat = Array.isArray(newNodes) ? newNodes : (newNodes ? [newNodes] : []);

            if (!wasFirstRender && this._parentDOM) {
                syncDOMChildren(this._parentDOM, oldNodes, flat);
            }

            this._nodes = flat;
            this._vdom = newVdom;

            // onUpdated вызывается после ЛЮБОГО реального render (включая первый)
            if (shouldRender && !wasFirstRender && d.onUpdated) {
                d.onUpdated.call(this);
            }
        } finally {
            this._isUpdating = false;
        }
    };

    inst.update = function(patch) {
        if (this._isRendering) {
            console.error(
                '❌ Cannot call update() inside render().\n' +
                'Use direct assignment instead: this.value = 22;'
            );
            return;
        }
        if (patch && typeof patch === 'object') {
            if (Object.keys(patch).length === 0) {
                if (this._isInitializing) return;
                scheduleUpdate(this);
                return;
            }
            let changed = false;
            for (const k in patch) {
                if (this[k] !== patch[k]) { changed = true; break; }
            }
            if (!changed) return;
            Object.assign(this, patch);
        }
        if (this._isInitializing) return;
        scheduleUpdate(this);
    };

    inst._refCollectors = {};
    inst.refs = function(name) {
        if (!inst._refCollectors[name]) {
            inst._refCollectors[name] = (node) => {
                inst.refs[name] = node;
            };
        }
        return inst._refCollectors[name];
    };

    inst.context = function(key, ...args) {
        let p = this._parentContext;
        while (p) {
            const ctx = p._definition.context;
            if (ctx && typeof ctx[key] === 'function') {
                return ctx[key].apply(p, args);
            }
            p = p._parentContext;
        }
        return undefined;
    };

    inst.contextSelf = function(key, ...args) {
        if (this._inContextCall) throw new Error('contextSelf recursion');
        const ctx = this._definition.context;
        if (ctx && typeof ctx[key] === 'function') {
            this._inContextCall = true;
            try {
                const res = ctx[key].apply(this, args);
                if (res !== undefined) return res;
            } finally {
                this._inContextCall = false;
            }
        }
        return this.context(key, ...args);
    };

    const reserved = [
        'init', 'render', 'props', 'memo',
        'onMounted', 'onUpdated', 'onUnmounted', 'context',
        'update', 'refs', 'contextSelf', '_rerender'
    ];
    for (const key in def) {
        const val = def[key];
        if (typeof val === 'function' && !reserved.includes(key)) {
            if (inst[key] === undefined) {
                inst[key] = val.bind(inst);
            }
        }
    }
}

function makeMapKey(vnode, index, path) {
    if (vnode && vnode.props && vnode.props.key !== undefined) {
        const userKey = String(vnode.props.key).replace(/,/g, ',,');
        return '#' + userKey;
    }
    return path;
}

function populateKeyMap(vnode, path, keyMap) {
    if (vnode == null) return;
    if (Array.isArray(vnode)) {
        for (let i = 0; i < vnode.length; i++) {
            populateKeyMap(vnode[i], path + ',' + i, keyMap);
        }
        return;
    }
    if (vnode._text !== undefined) return;

    if (vnode.tag === Fragment) {
        const hasKey = vnode.props && vnode.props.key !== undefined;

        if (hasKey && vnode._instance) {
            const key = makeMapKey(vnode, 0, path);
            keyMap.set(key, vnode._instance);
        }

        const basePath = hasKey ? '' : path;
        if (vnode.childs) {
            for (let i = 0; i < vnode.childs.length; i++) {
                populateKeyMap(vnode.childs[i], basePath + ',' + i, keyMap);
            }
        }
        return;
    }

    if (vnode._instance) {
        const key = makeMapKey(vnode, 0, path);
        keyMap.set(key, vnode._instance);
    }

    if (vnode.childs) {
        for (let i = 0; i < vnode.childs.length; i++) {
            populateKeyMap(vnode.childs[i], path + ',' + i, keyMap);
        }
    }
}

const RECREATE_ATTRS = ['type', 'is'];
const CAMEL_TO_ATTR = {
    className: 'class',
    htmlFor: 'for',
    tabIndex: 'tabindex'
};

function applyProp(dom, key, value, namespace) {
    if (key === 'key' || key === 'ref' || key === 'children') return;
    const isSVG = namespace === SVG_NS;
    const tag = dom.tagName;

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
                const strVal = value == null ? '' : String(value);
                if (dom.value !== strVal) dom.value = strVal;
                dom.setAttribute('value', strVal);
                return;
            }
            if (key === 'checked') {
                dom.checked = !!value;
                if (value) dom.setAttribute('checked', '');
                else dom.removeAttribute('checked');
                return;
            }
            if (tag === 'SELECT' && key === 'multiple') {
                dom.multiple = !!value;
                if (value) dom.setAttribute('multiple', '');
                else dom.removeAttribute('multiple');
                return;
            }
        }
        if (tag === 'OPTION' && key === 'selected') {
            dom.selected = !!value;
            if (value) dom.setAttribute('selected', '');
            else dom.removeAttribute('selected');
            return;
        }
    }

    if (key.length > 2 && key[0] === 'o' && key[1] === 'n') {
        const eventType = key.substring(2).toLowerCase();
        const store = dom._evtStore || (dom._evtStore = {});
        const oldHandler = store[eventType];
        if (oldHandler) dom.removeEventListener(eventType, oldHandler);
        if (typeof value === 'function') {
            dom.addEventListener(eventType, value);
            store[eventType] = value;
        } else {
            delete store[eventType];
        }
        return;
    }

    if (key === 'dangerouslySetInnerHTML') {
        if (value && value.__html != null) dom.innerHTML = value.__html;
        return;
    }

    if (key === 'style') {
        if (value == null) {
            dom.removeAttribute('style');
        } else if (typeof value === 'object') {
            let css = '';
            for (const p in value) {
                const cssProp = p.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
                css += cssProp + ':' + value[p] + ';';
            }
            dom.setAttribute('style', css);
        } else {
            dom.setAttribute('style', String(value));
        }
        return;
    }

    if (value === false || value == null) {
        if (isSVG) {
            if (key === 'xlinkHref') {
                dom.removeAttributeNS(XLINK_NS, 'href');
            } else {
                dom.removeAttribute(key);
            }
        } else {
            const attr = CAMEL_TO_ATTR[key] || key.toLowerCase();
            dom.removeAttribute(attr);
        }
        return;
    }

    if (isSVG) {
        if (key === 'xlinkHref') {
            dom.setAttributeNS(XLINK_NS, 'xlink:href', value);
        } else {
            dom.setAttribute(key, value === true ? '' : String(value));
        }
        return;
    }

    const attr = CAMEL_TO_ATTR[key] || key.toLowerCase();
    dom.setAttribute(attr, value === true ? '' : String(value));
}

function applyProps(dom, oldProps, newProps, namespace) {
    oldProps = oldProps || {};
    newProps = newProps || {};

    for (const k in oldProps) {
        if (!(k in newProps)) applyProp(dom, k, null, namespace);
    }
    for (const k in newProps) {
        if (oldProps[k] !== newProps[k]) {
            applyProp(dom, k, newProps[k], namespace);
        }
    }
}

function callRefs(vnode, seen = new WeakSet()) {
    if (vnode == null) return;
    if (typeof vnode !== 'object') return;
    if (seen.has(vnode)) return;
    seen.add(vnode);

    if (Array.isArray(vnode)) {
        for (let i = 0; i < vnode.length; i++) callRefs(vnode[i], seen);
        return;
    }
    if (vnode._text !== undefined) return;

    if (vnode.tag === Portal) {
        const inst = vnode._instance;
        if (vnode.props && vnode.props.ref && inst) vnode.props.ref(inst);
        if (inst && inst._rendered) callRefs(inst._rendered, seen);
        return;
    }
    if (typeof vnode.tag === 'function' && vnode.tag._definition) {
        const inst = vnode._instance;
        if (vnode.props && vnode.props.ref && inst) vnode.props.ref(inst);
        if (inst && inst._vdom) callRefs(inst._vdom, seen);
        return;
    }
    if (vnode.props && vnode.props.ref && vnode._el) {
        vnode.props.ref(vnode._el);
    }
    if (vnode.childs) {
        for (let i = 0; i < vnode.childs.length; i++) callRefs(vnode.childs[i], seen);
    }
}

function triggerMounted(roots) {
    const components = [];
    const stack = Array.isArray(roots) ? roots.slice() : [roots];
    const seen = new WeakSet();

    while (stack.length) {
        const vnode = stack.pop();
        if (vnode == null || typeof vnode !== 'object') continue;
        if (seen.has(vnode)) continue;
        seen.add(vnode);

        if (Array.isArray(vnode)) {
            for (let i = vnode.length - 1; i >= 0; i--) stack.push(vnode[i]);
            continue;
        }
        if (vnode._text !== undefined) continue;

        if (vnode.tag === Portal) {
            const inst = vnode._instance;
            if (inst && inst._rendered) stack.push(inst._rendered);
            continue;
        }
        if (typeof vnode.tag === 'function' && vnode.tag._definition) {
            const inst = vnode._instance;
            if (inst && !inst._isMounted) {
                inst._isMounted = true;
                components.push(inst);
            }
            if (inst && inst._vdom) stack.push(inst._vdom);
            continue;
        }
        if (vnode.childs) {
            for (let i = vnode.childs.length - 1; i >= 0; i--) {
                stack.push(vnode.childs[i]);
            }
        }
    }

    for (let i = components.length - 1; i >= 0; i--) {
        const inst = components[i];
        const d = inst._definition;
        try {
            if (d.onMounted) d.onMounted.call(inst);
        } catch (err) {
            const name = d.name || 'Component';
            console.error('❌ Error in onMounted of "' + name + '":\n', err);
        }
    }
}

function unmountVdom(vnode, seen = new WeakSet()) {
    if (vnode == null || typeof vnode !== 'object') return;
    if (seen.has(vnode)) return;
    seen.add(vnode);

    if (Array.isArray(vnode)) {
        for (let i = 0; i < vnode.length; i++) unmountVdom(vnode[i], seen);
        return;
    }
    if (vnode._text !== undefined) return;

    if (vnode.tag === Portal) {
        const inst = vnode._instance;
        if (inst) {
            if (vnode.props && vnode.props.ref) vnode.props.ref(null);
            if (inst._rendered) unmountVdom(inst._rendered, seen);
            if (inst._anchor && inst._anchor.parentNode) {
                inst._anchor.parentNode.removeChild(inst._anchor);
            }
            if (inst._container) {
                for (let i = 0; i < inst._nodes.length; i++) {
                    const n = inst._nodes[i];
                    if (n && n.parentNode === inst._container) {
                        inst._container.removeChild(n);
                    }
                }
            }
        }
        return;
    }
    if (typeof vnode.tag === 'function' && vnode.tag._definition) {
        const inst = vnode._instance;
        if (inst) {
            if (vnode.props && vnode.props.ref) vnode.props.ref(null);
            const d = inst._definition;
            if (d.onUnmounted) d.onUnmounted.call(inst);
            if (inst._vdom) unmountVdom(inst._vdom, seen);
        }
        return;
    }
    if (typeof vnode.tag === 'string') {
        if (vnode.props && vnode.props.ref && vnode._el) {
            vnode.props.ref(null);
        }
    }
    if (vnode.childs) {
        for (let i = 0; i < vnode.childs.length; i++) unmountVdom(vnode.childs[i], seen);
    }
}

function syncDOMChildren(parentDOM, oldNodes, newNodes) {
    let oi = 0;
    for (let i = 0; i < newNodes.length; i++) {
        const n = newNodes[i];
        const o = oi < oldNodes.length ? oldNodes[oi] : null;
        if (n === o) {
            oi++;
        } else {
            let ref = null;
            for (let j = oi; j < oldNodes.length; j++) {
                if (oldNodes[j] && oldNodes[j].parentNode === parentDOM) {
                    ref = oldNodes[j]; break;
                }
            }
            parentDOM.insertBefore(n, ref);
        }
    }
    while (oi < oldNodes.length) {
        const o = oldNodes[oi++];
        if (o && o.parentNode === parentDOM) parentDOM.removeChild(o);
    }
}

function reconcile(oldNode, newNode, parentDOM, ctx, path, keyMap, namespace) {
    if (oldNode === newNode) {
        if (Array.isArray(newNode)) {
            const nodes = [];
            for (let i = 0; i < newNode.length; i++) {
                const child = newNode[i];
                pushAll(nodes, reconcile(child, child, parentDOM, ctx, path + ',' + i, keyMap, namespace));
            }
            return nodes;
        }
        if (newNode && (
            (typeof newNode.tag === 'function' && newNode.tag._definition) ||
            newNode.tag === Portal
        )) {
            // Продолжить ниже
        } else if (newNode && typeof newNode.tag === 'string') {
            if (newNode.childs) {
                for (let i = 0; i < newNode.childs.length; i++) {
                    const child = newNode.childs[i];
                    reconcile(child, child, newNode._el, ctx, path + ',' + i, keyMap, namespace);
                }
            }
            return extractNodes(newNode);
        } else if (newNode && newNode.tag === Fragment) {
            const hasKey = newNode.props && newNode.props.key !== undefined;
            const basePath = hasKey ? '' : path;

            if (newNode.childs) {
                for (let i = 0; i < newNode.childs.length; i++) {
                    const child = newNode.childs[i];
                    reconcile(child, child, parentDOM, ctx, basePath + ',' + i, keyMap, namespace);
                }
            }
            return newNode._nodes;
        } else {
            return extractNodes(newNode);
        }
    }

    if (newNode == null) {
        if (oldNode != null) unmountVdom(oldNode);
        return null;
    }
    if (oldNode == null) {
        return mountNode(newNode, parentDOM, ctx, path, keyMap, namespace);
    }

    const oldIsText = oldNode._text !== undefined;
    const newIsText = newNode._text !== undefined;

    if (oldIsText && newIsText) {
        if (oldNode._el) {
            oldNode._el.nodeValue = newNode._text;
            newNode._el = oldNode._el;
            return newNode._el;
        }
        return mountNode(newNode, parentDOM, ctx, path, keyMap, namespace);
    }
    if (oldIsText || newIsText) {
        unmountVdom(oldNode);
        return mountNode(newNode, parentDOM, ctx, path, keyMap, namespace);
    }

    if (Array.isArray(newNode)) {
        if (Array.isArray(oldNode)) {
            return reconcileChildren(oldNode, newNode, parentDOM, ctx, path, keyMap, namespace);
        }
        unmountVdom(oldNode);
        return mountNode(newNode, parentDOM, ctx, path, keyMap, namespace);
    }
    if (Array.isArray(oldNode)) {
        unmountVdom(oldNode);
        return mountNode(newNode, parentDOM, ctx, path, keyMap, namespace);
    }

    if (oldNode.tag !== newNode.tag) {
        unmountVdom(oldNode);
        return mountNode(newNode, parentDOM, ctx, path, keyMap, namespace);
    }

    const tag = newNode.tag;
    if (tag === Fragment) {
        return reconcileFragment(oldNode, newNode, parentDOM, ctx, path, keyMap, namespace);
    }
    if (tag === Portal) {
        return reconcilePortal(oldNode, newNode, parentDOM, ctx, path, keyMap, namespace);
    }
    if (typeof tag === 'function' && tag._definition) {
        return reconcileComponent(oldNode, newNode, parentDOM, ctx, path, keyMap, namespace);
    }
    if (typeof tag === 'string') {
        return reconcileHTML(oldNode, newNode, parentDOM, ctx, path, keyMap, namespace);
    }
    return null;
}

function extractNodes(vnode) {
    if (vnode == null) return null;
    if (Array.isArray(vnode)) {
        const r = [];
        for (let i = 0; i < vnode.length; i++) pushAll(r, extractNodes(vnode[i]));
        return r;
    }
    if (vnode._text !== undefined) return vnode._el || null;
    if (vnode._el) return vnode._el;
    if (Array.isArray(vnode._nodes)) return vnode._nodes;
    return null;
}

function reconcileChildren(oldChilds, newChilds, parentDOM, ctx, path, keyMap, namespace) {
    const oldNodes = collectDOMNodes(oldChilds);
    const newNodes = [];
    const max = Math.max(oldChilds ? oldChilds.length : 0, newChilds ? newChilds.length : 0);
    for (let i = 0; i < max; i++) {
        const childPath = path + ',' + i;
        const oc = oldChilds && i < oldChilds.length ? oldChilds[i] : null;
        const nc = newChilds && i < newChilds.length ? newChilds[i] : null;
        const r = reconcile(oc, nc, parentDOM, ctx, childPath, keyMap, namespace);
        pushAll(newNodes, r);
    }
    if (parentDOM) syncDOMChildren(parentDOM, oldNodes, newNodes);
    return newNodes;
}

// ВАЖНО: Для SELECT value применяется ПОСЛЕ добавления options
function mountHTML(vnode, parentDOM, ctx, path, keyMap, namespace) {
    if (vnode.tag === 'svg') namespace = SVG_NS;
    const isForeignObject = vnode.tag === 'foreignObject';
    const dom = namespace === SVG_NS
        ? document.createElementNS(SVG_NS, vnode.tag)
        : document.createElement(vnode.tag);
    vnode._el = dom;

    const isSelect = dom.tagName === 'SELECT';

    // Для SELECT: value применяется после options
    if (isSelect) {
        const propsWithoutValue = {};
        for (const k in vnode.props) {
            if (k !== 'value') propsWithoutValue[k] = vnode.props[k];
        }
        applyProps(dom, {}, propsWithoutValue, namespace);
    } else {
        applyProps(dom, {}, vnode.props, namespace);
    }

    if (vnode.tag === 'textarea') return dom;

    const childNodes = [];
    const childNamespace = isForeignObject ? HTML_NS : namespace;
    for (let i = 0; i < vnode.childs.length; i++) {
        const childPath = path + ',' + i;
        const r = mountNode(vnode.childs[i], dom, ctx, childPath, keyMap, childNamespace);
        pushAll(childNodes, r);
    }
    prependAll(dom, childNodes);

    // Для SELECT: value после options
    if (isSelect && vnode.props && 'value' in vnode.props) {
        applyProp(dom, 'value', vnode.props.value, namespace);
    }

    return dom;
}

// ВАЖНО: Для SELECT value применяется ПОСЛЕ reconcile options
function reconcileHTML(oldVnode, newVnode, parentDOM, ctx, path, keyMap, namespace) {
    if (newVnode.tag === 'svg') namespace = SVG_NS;
    const isForeignObject = newVnode.tag === 'foreignObject';

    let shouldRecreate = false;
    for (const attr of RECREATE_ATTRS) {
        if (oldVnode.props[attr] !== newVnode.props[attr]) {
            shouldRecreate = true;
            break;
        }
    }
    if (oldVnode.tag === 'select' &&
        oldVnode.props.multiple !== newVnode.props.multiple) {
        shouldRecreate = true;
    }

    if (shouldRecreate) {
        unmountVdom(oldVnode);
        return mountNode(newVnode, parentDOM, ctx, path, keyMap, namespace);
    }

    const dom = oldVnode._el;
    newVnode._el = dom;

    const isSelect = dom.tagName === 'SELECT';

    if (isSelect) {
        const oldPropsWithoutValue = {};
        for (const k in oldVnode.props) {
            if (k !== 'value') oldPropsWithoutValue[k] = oldVnode.props[k];
        }
        const newPropsWithoutValue = {};
        for (const k in newVnode.props) {
            if (k !== 'value') newPropsWithoutValue[k] = newVnode.props[k];
        }
        applyProps(dom, oldPropsWithoutValue, newPropsWithoutValue, namespace);
    } else {
        applyProps(dom, oldVnode.props, newVnode.props, namespace);
    }

    if (newVnode.tag === 'textarea') {
        newVnode._nodes = [];
        return dom;
    }

    const childNamespace = isForeignObject ? HTML_NS : namespace;
    newVnode._nodes = reconcileChildren(
        oldVnode.childs, newVnode.childs, dom, ctx, path, keyMap, childNamespace
    );

    // Для SELECT: value после reconcile options
    if (isSelect && 'value' in newVnode.props) {
        if (oldVnode.props.value !== newVnode.props.value) {
            applyProp(dom, 'value', newVnode.props.value, namespace);
        }
    }

    return dom;
}

function buildIncomingProps(rawProps, childs) {
    const out = {};
    for (const k in rawProps) {
        if (k !== 'children' && k !== 'key' && k !== 'ref') {
            out[k] = rawProps[k];
        }
    }
    if (rawProps && rawProps.children !== undefined) {
        out.children = rawProps.children;
    } else if (childs && childs.length > 0) {
        const filtered = childs.filter(c => c !== null);
        out.children = filtered.length === 1 ? filtered[0] : filtered;
    } else {
        out.children = null;
    }
    return out;
}

function mountComponent(vnode, parentDOM, ctx, path, keyMap, namespace) {
    const def = vnode.tag._definition;
    const mapKey = makeMapKey(vnode, 0, path);
    let inst = keyMap ? keyMap.get(mapKey) : null;

    if (inst && inst._definition !== def) {
        unmountVdom({ tag: vnode.tag, _instance: inst });
        if (keyMap) keyMap.delete(mapKey);
        inst = null;
    }

    if (inst) {
        keyMap.delete(mapKey);
        inst._incomingProps = buildIncomingProps(vnode.props, vnode.childs);
        inst._parentContext = ctx;
        inst._parentDOM = parentDOM;
        inst._namespace = namespace;
        try {
            inst._rerender();
        } catch (err) {
            const name = def.name || 'Component';
            console.error('❌ Error in component "' + name + '":\n', err);
        }
        vnode._instance = inst;
        return inst._nodes;
    }
    inst = new vnode.tag();
    attachInstanceAPI(inst);
    inst._incomingProps = buildIncomingProps(vnode.props, vnode.childs);
    inst._parentContext = ctx;
    inst._parentDOM = parentDOM;
    inst._namespace = namespace;
    vnode._instance = inst;

    if (def.props) {
        inst.props = def.props.call(inst, inst._incomingProps);
    } else {
        inst.props = inst._incomingProps;
    }

    inst._isInitializing = true;
    if (def.init) def.init.call(inst, inst.props);
    inst._isInitializing = false;

    try {
        inst._rerender();
    } catch (err) {
        const name = def.name || 'Component';
        console.error('❌ Error in component "' + name + '":\n', err);
        inst._nodes = [];
    }
    return inst._nodes;
}

function reconcileComponent(oldVnode, newVnode, parentDOM, ctx, path, keyMap, namespace) {
    const inst = oldVnode._instance;
    newVnode._instance = inst;
    inst._incomingProps = buildIncomingProps(newVnode.props, newVnode.childs);
    inst._parentContext = ctx;
    inst._parentDOM = parentDOM;
    inst._namespace = namespace;
    try {
        inst._rerender();
    } catch (err) {
        const name = inst._definition?.name || 'Component';
        console.error('❌ Error in component "' + name + '":\n', err);
    }
    return inst._nodes;
}

function mountFragment(vnode, parentDOM, ctx, path, keyMap, namespace) {
    const hasKey = vnode.props && vnode.props.key !== undefined;

    if (hasKey && keyMap) {
        const mapKey = makeMapKey(vnode, 0, path);
        const oldVnode = keyMap.get(mapKey);

        if (oldVnode && oldVnode.tag === Fragment) {
            keyMap.delete(mapKey);

            const nodes = reconcileChildren(
                oldVnode.childs, vnode.childs, parentDOM, ctx,
                '', keyMap, namespace
            );

            vnode._nodes = nodes;
            vnode._instance = oldVnode._instance;
            return nodes;
        }
    }

    const basePath = hasKey ? '' : path;
    const nodes = [];
    for (let i = 0; i < vnode.childs.length; i++) {
        const childPath = basePath + ',' + i;
        const r = mountNode(vnode.childs[i], parentDOM, ctx, childPath, keyMap, namespace);
        pushAll(nodes, r);
    }
    vnode._nodes = nodes;

    if (hasKey) {
        vnode._instance = { _isKeyedFragment: true };
    }

    return nodes;
}

function reconcileFragment(oldVnode, newVnode, parentDOM, ctx, path, keyMap, namespace) {
    const hasKey = newVnode.props && newVnode.props.key !== undefined;
    const basePath = hasKey ? '' : path;

    const nodes = reconcileChildren(
        oldVnode.childs, newVnode.childs, parentDOM, ctx,
        basePath, keyMap, namespace
    );

    newVnode._nodes = nodes;

    if (hasKey) {
        newVnode._instance = oldVnode._instance || { _isKeyedFragment: true };
    }

    return nodes;
}

function mountPortal(vnode, parentDOM, ctx, path, keyMap, namespace) {
    const inst = {
        _isPortal: true,
        _rendered: null,
        _nodes: [],
        _anchor: document.createTextNode(''),
        _container: null,
        _mounted: false,
        _namespace: namespace
    };
    vnode._instance = inst;
    const container = vnode.props.containerGetter();
    if (container) {
        inst._container = container;
        const childNodes = mountNode(vnode.childs, container, ctx, path, keyMap, namespace);
        inst._rendered = vnode.childs;
        inst._nodes = Array.isArray(childNodes)
            ? childNodes
            : (childNodes ? [childNodes] : []);
        prependAll(container, inst._nodes);
        callRefs(vnode.childs);
        triggerMounted(vnode.childs);
        inst._mounted = true;
    }
    return [inst._anchor];
}

function reconcilePortal(oldVnode, newVnode, parentDOM, ctx, path, keyMap, namespace) {
    const inst = oldVnode._instance;
    newVnode._instance = inst;
    inst._namespace = namespace;
    const container = newVnode.props.containerGetter();

    if (!inst._container && container) {
        inst._container = container;
        const childNodes = mountNode(newVnode.childs, container, ctx, path, keyMap, namespace);
        inst._rendered = newVnode.childs;
        inst._nodes = Array.isArray(childNodes)
            ? childNodes
            : (childNodes ? [childNodes] : []);
        prependAll(container, inst._nodes);
        callRefs(newVnode.childs);
        triggerMounted(newVnode.childs);
        inst._mounted = true;
    } else if (inst._container && !container) {
        if (inst._rendered) unmountVdom(inst._rendered);
        for (let i = 0; i < inst._nodes.length; i++) {
            const n = inst._nodes[i];
            if (n && n.parentNode) n.parentNode.removeChild(n);
        }
        inst._rendered = null;
        inst._nodes = [];
        inst._container = null;
        inst._mounted = false;
    } else if (inst._container && container) {
        if (inst._container !== container) {
            if (inst._rendered) unmountVdom(inst._rendered);
            for (let i = 0; i < inst._nodes.length; i++) {
                const n = inst._nodes[i];
                if (n && n.parentNode) n.parentNode.removeChild(n);
            }
            inst._container = container;
            const childNodes = mountNode(newVnode.childs, container, ctx, path, keyMap, namespace);
            inst._rendered = newVnode.childs;
            inst._nodes = Array.isArray(childNodes)
                ? childNodes
                : (childNodes ? [childNodes] : []);
            prependAll(container, inst._nodes);
            callRefs(newVnode.childs);
            triggerMounted(newVnode.childs);
        } else {
            inst._nodes = reconcileChildren(
                inst._rendered, newVnode.childs, container, ctx, path, keyMap, namespace
            );
            inst._rendered = newVnode.childs;
        }
    }
    return [inst._anchor];
}

function mountNode(vnode, parentDOM, ctx, path, keyMap, namespace) {
    if (vnode == null) return null;
    if (vnode._text !== undefined) {
        const t = document.createTextNode(vnode._text);
        vnode._el = t;
        return t;
    }
    if (Array.isArray(vnode)) {
        const nodes = [];
        for (let i = 0; i < vnode.length; i++) {
            const childPath = path + ',' + i;
            const r = mountNode(vnode[i], parentDOM, ctx, childPath, keyMap, namespace);
            pushAll(nodes, r);
        }
        return nodes;
    }
    const tag = vnode.tag;
    if (tag === Fragment) {
        return mountFragment(vnode, parentDOM, ctx, path, keyMap, namespace);
    }
    if (tag === Portal) {
        return mountPortal(vnode, parentDOM, ctx, path, keyMap, namespace);
    }
    if (typeof tag === 'function' && tag._definition) {
        return mountComponent(vnode, parentDOM, ctx, path, keyMap, namespace);
    }
    if (typeof tag === 'string') {
        return mountHTML(vnode, parentDOM, ctx, path, keyMap, namespace);
    }
    return null;
}

function normalizeMountInput(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'function' && input._definition) return h(input, {});
    if (Array.isArray(input)) return h(Fragment, {}, ...input);
    if (typeof input === 'string' || typeof input === 'number') {
        return { _text: String(input) };
    }
    if (typeof input === 'object' && input !== null) return input;
    throw new Error('mount(): unsupported input type: ' + typeof input);
}

function collectAllInstances(vnode) {
    const result = [];

    function walk(node) {
        if (!node) return;

        if (Array.isArray(node)) {
            for (const child of node) walk(child);
            return;
        }

        if (typeof node !== 'object') return;

        if (typeof node.tag === 'function' && node.tag._definition) {
            if (node._instance && node._instance._rerender) {
                result.push(node._instance);
                if (node._instance._vdom) walk(node._instance._vdom);
            }
            return;
        }

        if (node.tag === Portal) {
            if (node._instance && node._instance._rendered) {
                walk(node._instance._rendered);
            }
            return;
        }

        if (node.tag === Fragment) {
            if (Array.isArray(node._nodes)) {
                for (const child of node._nodes) walk(child);
            }
            return;
        }

        if (node.childs) {
            for (const child of node.childs) walk(child);
        }
    }

    walk(vnode);
    return result;
}

const mountedTrees = new WeakMap();
const mountedContainers = new Set();

function mount(input, container) {
    const vnode = normalizeMountInput(input);
    const oldVnode = mountedTrees.get(container);

    if (vnode === null) {
        if (oldVnode) {
            unmountVdom(oldVnode);
            container.replaceChildren();
            mountedTrees.delete(container);
            mountedContainers.delete(container);
        }
        return;
    }

    if (oldVnode) {
        const keyMap = new Map();
        populateKeyMap(oldVnode, '', keyMap);

        const oldNodes = collectDOMNodes([oldVnode]);
        reconcile(oldVnode, vnode, container, null, '', keyMap, HTML_NS);
        const newNodes = collectDOMNodes([vnode]);
        syncDOMChildren(container, oldNodes, newNodes);
        mountedTrees.set(container, vnode);
        callRefs(vnode);
        return vnode;
    }

    const nodes = mountNode(vnode, container, null, '', null, HTML_NS);
    const flat = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : []);
    prependAll(container, flat);
    mountedTrees.set(container, vnode);
    mountedContainers.add(container);
    callRefs(vnode);
    triggerMounted(vnode);
    return vnode;
}

function refresh() {
    const start = performance.now();

    for (const container of mountedContainers) {
        const vnode = mountedTrees.get(container);
        if (!vnode) continue;

        const instances = collectAllInstances(vnode);
        for (const inst of instances) {
            try {
                inst.update();
            } catch (err) {
                console.error('refresh():', inst._definition?.name || 'Component', err);
            }
        }
    }

    return new Promise(resolve => {
        const finish = () => resolve(performance.now() - start);

        if (batchQueue.size === 0 && !isBatchScheduled) {
            finish();
        } else {
            refreshResolvers.push(finish);
        }
    });
}

// Только для тестов — не использовать в продакшене
function _cleanupAll() {
    for (const container of Array.from(mountedContainers)) {
        try {
            mount(null, container);
        } catch (e) {}
    }
}

export { h, Component, createPortal, Fragment, mount, refresh, _cleanupAll };

if (typeof window !== 'undefined') {
    window.VDOM = { h, Component, createPortal, Fragment, mount, refresh, _cleanupAll };
}