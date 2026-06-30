# DEVNOTES.md — Заметки для разработчиков

> **Для AI-агентов:** читай раздел "📍 Текущее состояние" первым — там что реально в коде.
> Если нужна конкретная тема — ищи в "📋 Содержание" по триггерам.

## ⚠️ Правила работы с файлами

**Создание и удаление файлов — ТОЛЬКО с одобрения пользователя!**

- Все изменения в коде должны соответствовать SPEC.md
- Документация (README, DOCS, SPEC, CHANGELOG) — зона AISEC, не трогать
- AIDEV работает с: `src/core.js`, `DEVNOTES.md`, `AIDEV.md`, `tests/`
- Перед изменением кода изучить SPEC.md и этот файл

---

## 📍 Текущее состояние (актуально на 2026-06-30)

**Версия:** v2 (раунд 2 оптимизаций). Все 134 теста проходят.

**Активные оптимизации в `src/core.js`:**

| Оптимизация | Где | Эффект |
|-------------|-----|--------|
| Text node skip if `_text` unchanged | `reconcile` | -66% на Update 1 of 5000 |
| Shallow props comparison | `reconcileHTML` | -62% на Swap first/last |
| `refreshMemoSubtree` для memo-skip path | `_doRerender` | пропускает reconcile для HTML в memo-skip |
| `refreshMemoSubtree` → `inst._rerender()` напрямую | `refreshMemoSubtree` | пропускает reconcileComponent overhead |
| Кэш `_incomingProps` | `reconcileComponent`, `mountComponent` | экономит 1-2 аллокации на компонент |
| Разделение shouldRender/memo-skip путей | `_doRerender` | memo-skip без populateKeyMap/checkDuplicateKeys |
| Ранние микрооптимизации (2026-06-29) | везде | escapeKey, pushAll, for...in, и т.д. |

**Счёт vs React (bench.html, браузер): 9:5 в пользу tyaff**

**Что ОТКАТАНО (не пытаться снова — см. раздел "Откатанные оптимизации"):**
- Ранний выход при memo hit — ломает детей
- Быстрая проверка memo в update() — ломает детей
- reconcileChildren fast path для `oc === nc` — ломает context propagation
- Leaf component optimization (v8) — overhead в h() дороже выигрыша

---

## 📋 Содержание

- [Система ключей](#система-ключей) — `triggers: key, makeMapKey, escapeKey, Fragment`
- [Reconciliation алгоритм](#reconciliation-алгоритм) — `triggers: reconcile, reconcileChildren, reconcileHTML, reconcileComponent`
- [Batching и update()](#batching-и-update) — `triggers: update, _scheduleUpdate, flushBatch, Promise`
- [Lifecycle hooks](#lifecycle-hooks) — `triggers: onMounted, onUpdated, onUnmounted, init`
- [Context system](#context-system) — `triggers: context, this.context, _parentContext, pull-based`
- [Portals](#portals) — `triggers: createPortal, Portal, containerGetter`
- [Memo и оптимизации](#memo-и-оптимизации) — `triggers: memo, shouldRender, _prevMemo, refreshMemoSubtree`
- [Применённые оптимизации](#применённые-оптимизации) — `triggers: оптимизация, performance, text skip, shallow props`
- [Откатанные оптимизации](#откатанные-оптимизации) — `triggers: ранний выход, leaf, fast path, ОТКАТ, не работает`
- [Известные ограничения](#известные-ограничения) — `triggers: ограничение, limitation, нельзя`
- [Архитектурные решения](#архитектурные-решения) — `triggers: архитектура, design, решение`
- [Отладка](#отладка) — `triggers: debug, console, логи`
- [Тестирование](#тестирование) — `triggers: test, npm test, happy-dom`
- [Перспективные направления](#перспективные-направления) — `triggers: future, TODO, улучшение`

---

## Система ключей

### Два типа ключей

#### 1. User keys (явные ключи)
```javascript
h(Component, { key: 'mykey', ...props })
h('div', { key: 'mykey', ...props })
h(Fragment, { key: 'mykey' }, ...children)
```

**Формат:** `#` + ключ (с экранированием запятых: `,` → `,,`)

**Примеры:**
- `key: 'fio'` → `#fio`
- `key: 'fio,1'` → `#fio,,1`
- `key: 'a,b,c'` → `#a,,b,,c`

**Свойства:**
- ✅ Глобальные в пределах одного render компонента
- ✅ Не зависят от позиции в дереве
- ✅ Позволяют перемещать элементы между родителями
- ⚠️ Должны быть уникальными (дубликаты вызывают warning)

#### 2. Path-based keys (автоматические)
```javascript
h('div', null, h('span'), h('span'))
// span[0] → путь ",0"
// span[1] → путь ",1"
```

**Формат:** путь в дереве (через запятую)

**Свойства:**
- ✅ Автоматические, не нужны user keys
- ✅ Стабильны при том же порядке элементов
- ❌ Привязаны к позиции — при перестановке instance пересоздаётся
- ❌ Не работают для перемещения между родителями

### Область действия ключей

**User keys глобальны в пределах ОДНОГО render компонента:**
```javascript
const Parent = Component({
    render() {
        return h('div', null,
            h(Child, { key: 'a' }),      // #a
            h('div', null,
                h(Child, { key: 'b' })   // #b — другой ключ, OK
            )
        );
    }
});
```

### Перемещение элементов

**Подтверждённая фича:** компонент с key может перемещаться между родителями внутри одного render с сохранением instance и state.

```javascript
render() {
    return h('div', null,
        this.showLeft
            ? h('div', { className: 'left' }, h(Child, { key: 'x' }))
            : h('div', { className: 'right' }, h(Child, { key: 'x' }))
    );
}
// Child сохраняет instance и state при переключении showLeft
```

### Проверка дубликатов

`checkDuplicateKeys(vnode, path)` — вызывается после render в dev mode (`IS_DEV = true`). В production пропускается.

### Fragment с key

Keyed Fragment (`h(Fragment, { key: 'x' }, ...children)`) поддерживает:
- Перемещение детей между родителями
- Сохранение порядка детей
- Идентификацию через `makeMapKey`

---

## Reconciliation алгоритм

### Базовые правила

1. **Разные tag** → unmount старого + mount нового
2. **Одинаковые HTML-теги** → обновление атрибутов (плоское сравнение props)
3. **Одинаковые компоненты** (через `tag._definition`) → сохранение instance, обновление `_parentContext`, пропсов, запуск `props() → memo() → render()`
4. **`null` в VDOM** → не создаёт DOM-узел, не участвует в диффе
5. **Текстовые узлы** → `{ _text: String(value) }`, обновляются через `nodeValue`

### Процесс reconcile

```
reconcile(oldNode, newNode, parentDOM, ctx, path, keyMap, namespace)
  1. oldNode === newNode → fast path (same reference)
  2. newNode == null → unmount oldNode
  3. oldNode == null → mountNode(newNode)
  4. Text vs Text → update nodeValue (skip if unchanged — раунд 2)
  5. Text vs non-Text (или наоборот) → unmount + mount
  6. Array handling → reconcileChildren
  7. Разные tag → unmount + mount
  8. Одинаковый tag → reconcileHTML / reconcileComponent / reconcileFragment / reconcilePortal
```

### KeyMap

`keyMap` — `Map<string, vnode>` для поиска существующих instances по user key.

- **Заполняется** `populateKeyMap(oldVdom, '', keyMap)` перед reconcile
- **Используется** в `mountComponent` и `mountFragment` для поиска существующего instance
- **Очищается** `keyMap.clear()` перед каждым render
- **В memo-skip path** не используется и не очищается (безопасно — `refreshMemoSubtree` не вызывает mountComponent)

### Порядок обхода

`reconcileChildren` обходит детей по индексу. Для каждого `i`:
```
oc = oldChilds[i], nc = newChilds[i]
reconcile(oc, nc, parentDOM, ctx, path + ',' + i, keyMap, namespace)
```

**⚠️ Компоненты ВСЕГДА должны проходить `reconcileComponent`** — даже если `oc === nc`. Это нужно для обновления `_parentContext` и прохождения цепочки `props() → memo() → render()`. Fast path для `oc === nc` ломает context propagation (см. "Откатанные оптимизации").

---

## Batching и update()

### Batching через microtask

Несколько `update()` в одном тике группируются:
```javascript
inst.update({ a: 1 });
inst.update({ b: 2 });
inst.update({ c: 3 });
// → один _rerender() в microtask
```

**Реализация:** `scheduleUpdate(inst)` добавляет instance в `batchQueue`, `flushBatch()` вызывается через `Promise.resolve().then()`.

### Promise<boolean>

`update()` возвращает Promise:
- `true` — render выполнился
- `false` — render заблокирован memo, или patch не изменил значений, или update во время init

### Защита от рекурсии

- `_isUpdating` флаг — защищает от повторного входа в `_rerender`
- `_isRendering` флаг — защищает от `update()` внутри `render()` (выводит ошибку)
- `_isInitializing` флаг — update во время `init()` откладывается, возвращает `false`
- Лимит 50 вложенных update — при превышении выдаёт ошибку

---

## Lifecycle hooks

### Порядок вызова

**При mount:**
1. `init(props)` — один раз до первого render
2. `props(incoming)` → `this.props`
3. `memo(this.props)` → `render(this.props)` (первый render)
4. Вставка DOM в parent
5. `onMounted()` после вставки (children-first)

**При update (от родителя или локально):**
1. `props(incoming)` → обновляет `this.props`
2. `memo(this.props)` → проверка зависимостей
3. Если совпадают → блокировка `render()`, дети всё равно проходят цепочку
4. Если отличаются → `render(this.props)` → `onUpdated()`

### onUpdated() — только при update

- **НЕ вызывается** при первом mount
- **НЕ вызывается** если `memo()` заблокировал render
- Вызывается **только** после реального выполнения `render()` и применения к DOM

---

## Context system

### Pull-based контекст

Компоненты читают контекст через `this.context('key')` в `render()`. Нет автоматических подписок.

```javascript
const ThemeProvider = Component({
    theme: 'light',
    context: {
        theme() { return this.theme; },
        toggleTheme() { this.update({ theme: this.theme === 'light' ? 'dark' : 'light' }); }
    },
    render() { return h('div', null, this.props.children); }
});

const ThemedBox = Component({
    render() {
        const theme = this.context('theme');  // ← Pull
        return h('div', { className: theme }, 'content');
    }
});
```

### Два метода доступа

- `this.context(key)` — ищет по цепочке `_parentContext` (вверх по дереву)
- `this.contextSelf(key)` — вызывает свой `definition.context[key]` (для провайдера)

### Контекст и memo()

**Критическое правило (SPEC):** если компонент читает `this.context()` и использует `memo()`, рекомендуется включать контекстные значения в массив зависимостей:

```javascript
// ✅ ПРАВИЛЬНО: контекст включён в memo
const ThemedCard = Component({
    memo(props) { return [props.title, this.context('theme')]; },
    render(props) { return h('div', null, this.context('theme'), props.title); }
});

// ❌ ОПАСНО: контекст не в memo — компонент "заморозится"
const BadCard = Component({
    memo(props) { return [props.title]; },  // theme НЕ включён
    render(props) { return h('div', null, this.context('theme'), props.title); }
});
```

**Почему это работает:** при смене контекста родитель перерендерится → дети проходят через свою цепочку (props → memo → render) → если контекст в memo, deps разные → render. Если нет — компонент может "заморозиться".

**Но:** дети этого компонента всё равно получат шанс перечитать контекст, даже если родитель "заморожен" memo. Это гарантируется `refreshMemoSubtree` который обходит детей в memo-skip path.

---

## Portals

### Отложенный монтаж

`createPortal(children, containerGetter)` — `containerGetter` вызывается при mount и при каждом update. Если возвращает `null` — контент не монтируется. Когда начинает возвращать валидный узел — контент монтируется.

### Динамический контейнер

Если `containerGetter` возвращает другой контейнер при update — контент переносится:
1. Старый контент unmount'ится
2. Новый контент mount'ится в новый контейнер

### onMounted() для порталов

Вызывается **только** когда `containerGetter` впервые вернул валидный узел. Не при первом render портала.

---

## Memo и оптимизации

### memo() — оптимизация render

`memo(props)` возвращает массив зависимостей. Если массив совпадает с предыдущим (поэлементно через `===`) → `render()` не вызывается.

```javascript
const Expensive = Component({
    memo(props) { return [props.data, this.filter]; },
    render(props) { /* expensive computation */ }
});
```

### memo() блокирует только текущий компонент

| `memo()` вернул | Компонент | Дети |
|----------------|-----------|------|
| Те же зависимости | ❌ render заблокирован | ✅ проходят цепочку |
| Другие зависимости | ✅ render выполнен | ✅ проходят цепочку |
| Нет `memo()` | ✅ render выполнен | ✅ проходят цепочку |

**Реализация:** при блокировке render компонент использует старый vnode (`newVdom = oldVdom`), но `refreshMemoSubtree` обходит детей чтобы они прошли свою цепочку `props() → memo() → render()`.

### Защита от регрессов

Критические тесты (test-node-01.js):
- `memo() блокирует только текущий компонент — дети обновляются`
- `context propagation работает через memo-защищённый компонент`
- `parent memo блокирует render, но дети проходят props() → memo() → render()`
- `memo() не блокирует onUpdated родителя`
- `memo hit: все дети имеют одинаковые props → никто не рендерится`

**Эти тесты падают если:**
- Добавлен skip reconcile для memo-защищённых компонентов
- Добавлен ранний выход в `_rerender` при memo hit
- Добавлена быстрая проверка memo в `update()` с early return

---

## Применённые оптимизации

### Ранние микрооптимизации (2026-06-29)

| Оптимизация | Было | Стало | Где |
|-------------|------|-------|-----|
| `Object.keys()` → `for...in` | `Object.keys(patch).forEach()` | `for (const k in patch)` | `update()` |
| `Array.push()` → прямое присваивание | `target.push(source[i])` | `target[len++] = source[i]` | `pushAll`, `collectDOMNodes`, `h`, `triggerMounted` |
| `Array.from(set)` → ручной цикл | `Array.from(batchQueue)` | `for...of` с push | `flushBatch`, `_cleanupAll` |
| `Object.assign()` → ручной цикл | `Object.assign(this, patch)` | `for (const k in patch)` | `update()` |
| `String(value)` → `"" + value` | `String(c)` | `"" + c` | `escapeKey`, `h`, `applyProp`, `makeMapKey` |
| `setAttribute('style')` → `style.cssText` | `dom.setAttribute('style', css)` | `dom.style.cssText = css` | `applyProp` |
| Прямые DOM-свойства вместо `setAttribute` | `dom.setAttribute('class', v)` | `dom.className = v` | `applyProp` для class/id/title/src/href/alt/name/placeholder/disabled/readOnly/hidden/tabIndex/draggable/contentEditable |
| `filter()` → ручной цикл с pre-alloc | `childs.filter(c => c !== null)` | `for` + `filtered[len++]` | `buildIncomingProps` |
| Вынесенный `setHTMLProp` switch | inline дублирование | отдельная функция | `applyProp` |

**Оптимизированные DOM-свойства (через `setHTMLProp`):**
`class`/`className`, `id`, `title`, `src`, `href`, `alt`, `name`, `placeholder`, `disabled`, `readOnly`/`readonly`, `hidden`, `tabIndex`/`tabindex`, `draggable`, `contentEditable`/`contenteditable`

**Важно:** для удаления атрибутов используется `removeAttribute()`, не присваивание пустой строки.

### Раунд 1: memo-skip path через refreshMemoSubtree (2026-06-30)

**Проблема:** при `memo()` блокировке `_doRerender` вызывал `reconcile(oldVdom, oldVdom, ...)` — полный reconcile с сравнением vnode с самим собой. Работало (попадало в fast path), но создавало лишние объекты.

**Решение:** новая функция `refreshMemoSubtree(vnode, parentDOM, ctx, namespace)` — целевой обход поддерева для memo-skip:
- Пропускает `applyProps` для HTML (props не изменились — vnode тот же)
- Пропускает `extractNodes`, `collectDOMNodes` для HTML
- Пропускает type checks в `reconcile`
- Вызывает `inst._rerender()` напрямую для компонентов (минуя `reconcileComponent` overhead)
- Вызывает `reconcilePortal` напрямую для порталов

**Кэш `_incomingProps`:** в `reconcileComponent` и `mountComponent` добавлен кэш:
- `inst._cachedIncomingProps` — закэшированный результат `buildIncomingProps`
- `inst._cachedPropsVnode` — vnode для которого кэш валиден
- При `inst._cachedPropsVnode === newVnode` переиспользуем кэш

**Разделение путей в `_doRerender`:**
- `shouldRender=true`: полный путь (render → checkDuplicateKeys → reconcile → syncDOMChildren → onUpdated)
- `shouldRender=false` (memo-skip): `refreshMemoSubtree` → syncDOMChildren (без onUpdated, без keyMap.clear/populateKeyMap)

### Раунд 2: оптимизации для обхода React (2026-06-30)

**1. Text node skip if `_text` unchanged**
```javascript
if (oldIsText && newIsText) {
    if (oldNode._el) {
        if (oldNode._text !== newNode._text) {  // ⚡ только если изменился
            oldNode._el.nodeValue = newNode._text;
        }
        newNode._el = oldNode._el;
        return newNode._el;
    }
    return mountNode(newNode, parentDOM, ctx, path, keyMap, namespace);
}
```
Эффект: в "Update 1 of 5000" 4999 из 5000 текстов не меняются — теперь не делается `nodeValue` присваивание.

**2. Shallow props comparison в `reconcileHTML`**
Перед `applyProps` сравниваем `oldProps` и `newProps` shallow. Если все значения равны — skip `applyProps`.
```javascript
let propsChanged = false;
if (oldProps !== newProps) {
    for (const k in oldProps) {
        if (!(k in newProps) || oldProps[k] !== newProps[k]) { propsChanged = true; break; }
    }
    if (!propsChanged) {
        for (const k in newProps) {
            if (!(k in oldProps)) { propsChanged = true; break; }
        }
    }
}
if (propsChanged) { /* applyProps */ }
```
Эффект: "Update 1 of 5000" — 4999 div'ов с одинаковыми props `{key:id}` skip'ают applyProps.

**Замеры (браузер, bench.html):**

| Сценарий | До раунда 2 | После раунда 2 | vs React |
|----------|-------------|----------------|----------|
| Update 1 of 5000 | 5.30ms | 1.80ms | 1.8x React |
| Swap first/last | 5.50ms | 2.10ms | **16.5x tyaff** 🏆 |
| No memo (5000) | 9.00ms | 5.10ms | 1.4x React |
| Insert middle | 5.40ms | 3.70ms | 1.7x React |
| Update all 5000 rows | 5.80ms | 5.60ms | **1.2x tyaff** 🏆 |
| Memo hit 1/5000 | 1.30ms | 1.10ms | **1.3x tyaff** 🏆 |

---

## Откатанные оптимизации

> **ВНИМАНИЕ:** эти оптимизации НЕ работают. Не пытайтесь их повторно внедрить — причины описаны ниже.

### 1. Ранний выход при memo hit (30 июня 2026)

**Идея:** когда `memo()` блокирует `render()`, пропускать весь `reconcile()` через `return` в `_doRerender`.

**Реализация (НЕ ДЕЛАЙ ТАК):**
```javascript
if (!shouldRender && newVdom === oldVdom && !wasFirstRender) {
    // resolve update promises
    return;  // ← Ранний выход - ЛОМАЕТ ДЕТЕЙ!
}
```

**Почему сломалось:**
- Дети **НЕ обновлялись** при memo hit у родителя
- Context propagation **не работал** через memo-защищённые компоненты
- Нарушена SPEC: "memo() блокирует render **только для текущего компонента**"

**Тесты которые падали:**
- ❌ `memo() блокирует только текущий компонент — дети обновляются`
- ❌ `context propagation работает через memo-защищённый компонент`
- ❌ `parent memo блокирует render, но дети проходят props() → memo() → render()`
- ❌ `memo hit: все дети имеют одинаковые props → никто не рендерится`

**Решение:** вместо раннего выхода — `refreshMemoSubtree` (см. "Раунд 1"). Обходит детей, но пропускает overhead reconcile для HTML.

### 2. Быстрая проверка memo в update() (29 июня 2026)

**Идея:** проверять зависимости `memo()` прямо в `update()` без patch, возвращая `Promise.resolve(false)` если зависимости не изменились.

**Реализация (НЕ ДЕЛАЙ ТАК):**
```javascript
if (patch === undefined && this._definition.memo) {
    const newDeps = this._definition.memo.call(this, this.props);
    if (this._prevMemo && shallowEqual(newDeps, this._prevMemo)) {
        return Promise.resolve(false);  // ← Ранний выход - ЛОМАЕТ ДЕТЕЙ!
    }
}
```

**Почему сломалось:**
- `_rerender()` **не вызывался вообще**
- Дети **не проходили** свою цепочку `props() → memo() → render()`
- SCENARIO 14 (MEMO HIT) в bench.html не работал

**Решение:** всегда планировать `_rerender()` через `scheduleUpdate`.

### 3. reconcileChildren fast path для `oc === nc` (раунд 2)

**Идея:** если `oldChilds[i] === newChilds[i]` (та же ссылка на vnode) — пропустить reconcile, переиспользовать DOM через `extractNodes(oc)`.

**Почему сломалось:** когда родитель рендерит те же vnode из `props.children` (например `ThemeProvider` возвращает `h('div', null, props.children)`), `oc === nc` для дочерних компонентов. Fast path пропускал `reconcileComponent` → компоненты не получали `_rerender` → не перечитывали context.

**Урок:** **компоненты ВСЕГДА должны проходить `reconcileComponent`** чтобы обновить `_parentContext` и пройти цепочку `props() → memo() → render()`. Fast path безопасен только для HTML/Fragment/текст — но у них overhead reconcile и так мал.

### 4. Leaf component optimization (раунд 3, v8 — ОТКАТ)

**Идея:** skip `_rerender` для leaf-компонентов (только DOM дети) с memo когда props не изменились — аналог React.memo bailout.

**Что пробовал:**
- `currentRenderingInstance` module-level, tracking в `h()` какие дети создаёт компонент
- `inst._isLeaf = !inst._hasComponentChildren && !inst._hasPortalChildren` после render
- `inst._usesContext` флаг при вызове `this.context()`
- Shallow props bailout в `reconcileComponent`: если leaf + memo + no context + no children + props equal → skip `_rerender`

**Почему откатил:**

| Сценарий | Раунд 2 (без v8) | Раунд 3 (v8) | Динамика |
|----------|------------------|--------------|----------|
| Memo skip (5000) | 3.10ms (3.1x React) | 3.00ms (2.7x React) | ✅ -3% |
| Update 1 of 5000 | 1.80ms (1.8x) | 2.90ms (2.6x) | ⚠️ +61% |
| Swap first/last | 2.10ms (16.5x) | 3.00ms (11.4x) | ⚠️ +43% |
| No memo (5000) | 5.10ms (1.4x) | 5.70ms (1.5x) | ⚠️ +12% |
| Insert middle | 3.70ms (1.7x) | 4.30ms (1.9x) | ⚠️ +16% |
| **Счёт vs React** | **9:5** | **9:5** | без изменений |

1. **Счёт vs React не изменился** (9:5) — v8 не добавил побед
2. **4 сценария ухудшились** ради +3% в Memo skip — чистая потеря
3. **20K re-render** прогресс (60→40ms) — от раунда 2, не от v8
4. **Memo skip 3.10 vs 3.00** — в рамках шума браузера

**Корневая причина overhead:** leaf detection через `currentRenderingInstance` в `h()` добавляет проверки для **каждого** h() вызова. Для Parent.render() с 5000 `h()` вызовов = 5000 проверок, даже когда bailout не срабатывает.

**Уроки:**
1. **Overhead в hot path (`h()`) дорогой** — даже простая проверка × 5000 вызовов даёт заметный regression
2. **Leaf detection требует runtime tracking** — статический анализ через `h()` единственный способ, но добавляет overhead
3. **Shallow props bailout без leaf detection ломает context** — `newVnode.childs` не отражает детей из `render()` (они в `inst._vdom`)
4. **React.memo vs tyaff memo — фундаментальная разница:** React `React.memo` **вообще не вызывает** функцию компонента. tyaff всегда вызывает `_rerender → memo()`. Догнать React без overhead — требует архитектурных изменений (dirty context flag, explicit opt-in)

### Исправленные баги

**resolversi → resolvers[i](shouldRender)** (29 июня 2026): опечатка в цикле вызова resolvers — `resolversi;` вместо `resolvers[i](shouldRender);`. Без этого fix Promise от `update()` никогда не резолвился. Исправлено в `_doRerender`.

---

## Известные ограничения

### 1. Top-level mount() не сохраняет instance

**Проблема:**
```javascript
mount(h('div', null, h(Child, { key: 'x' })), container);
mount(h('div', null, h('span'), h(Child, { key: 'x' })), container);
// Instance Child пересоздан
```

**Причина:** каждый `mount()` создаёт новый `keyMap`.

**Решение:** использовать компонент с `update()`.

### 2. render() → null → render

**Проблема:**
```javascript
const App = Component({
    show: false,
    render() {
        return this.show ? h('div', null, 'content') : null;
    }
});
app.update({ show: true });  // Может не восстановить DOM корректно
```

**Решение:** условный рендер внутри обёртки:
```javascript
render() {
    return h('div', null,
        this.show && h('span', null, 'content')
    );
}
```

### 3. HTML-элементы с key не сохраняют DOM

**Проблема:**
```javascript
h('input', { key: 'my-input', value: this.text })
// При перемещении input теряет фокус и значение
```

**Причина:** текущая реализация поддерживает ключи только для компонентов и keyed Fragments.

**Решение:** обернуть в компонент:
```javascript
const Input = Component({
    render() { return h('input', { value: this.props.value }); }
});
h(Input, { key: 'my-input', value: this.text })
```

### 4. Дубликаты user keys

**Поведение:** `console.warn` в development, но второй instance перезаписывает первый в `keyMap`.

**Решение:** использовать уникальные ключи.

---

## Архитектурные решения

### Нет двусторонних ссылок

Компонент хранит только `_vdom` (вниз), не обратную ссылку на vnode:
```javascript
// ✅ Правильно
inst._vdom = newVdom;
// ❌ Неправильно (только для поиска, не для навигации)
newVnode._instance = inst;
```

**Причина:** упрощает garbage collection, предотвращает memory leaks.

### State через прямые мутабельные свойства

Нет отдельного state-объекта:
```javascript
const Counter = Component({
    count: 0,  // Прямое свойство
    increment() { this.count++; this.update(); },
    render() { return h('div', null, this.count); }
});
```

**Причина:** простота, нет overhead от setState/useState.

### Pull-based контекст вместо push-based

Компоненты читают контекст в `render()`, не подписываются на изменения. **Причина:** проще реализация, нет системы подписок.

### Привязка методов в конструкторе

Все пользовательские методы автоматически привязываются к instance в `ComponentClass`:
```javascript
for (const key in definition) {
    if (RESERVED.has(key)) continue;
    const val = definition[key];
    if (typeof val === 'function') {
        this[key] = val.bind(this);
    } else {
        this[key] = val;
    }
}
```

**Зарезервированные имена** (не привязываются в конструкторе): `init`, `render`, `props`, `memo`, `onMounted`, `onUpdated`, `onUnmounted`, `context`.

---

## Отладка

### Проверка дубликатов ключей

Автоматически включено когда `IS_DEV = true` — `console.warn` для детекции дубликатов.

### Проверка lifecycle

```javascript
const DebugComp = Component({
    init() { console.log('init', this); },
    onMounted() { console.log('mounted', this); },
    onUpdated() { console.log('updated', this); },
    onUnmounted() { console.log('unmounted', this); },
    render() { /* ... */ }
});
```

### Проверка render count

```javascript
let renderCount = 0;
const MyComp = Component({
    render() {
        renderCount++;
        console.log('Render #' + renderCount);
        return h('div');
    }
});
```

### Проверка instance identity

```javascript
const instances = [];
const Child = Component({
    init() { instances.push(this); },
    render() { /* ... */ }
});
// После нескольких updates
console.log('Unique instances:', new Set(instances).size);
// Должно быть 1 если instance сохраняется
```

---

## Тестирование

### Запуск тестов

```bash
npm test                              # Все тесты
node --test tests/test-node-01.js     # Один файл
```

### Структура тестов

- `test-node-01.js` — базовые возможности (h, Component, mount, lifecycle, keys, memo)
- `test-node-02.js` — контекст и порталы (45 тестов)
- `test-node-03.js` — UI интеграционные паттерны (8 тестов)
- `test-node-04.js` — edge cases (17 тестов)
- `test-node-05.js` — update() и keys (16 тестов)

**Всего: 134 теста.** Все должны проходить перед любым merge.

### Тестирование с happy-dom

```javascript
import { Window } from 'happy-dom';
const window = new Window({ url: 'http://localhost' });
global.window = window;
global.document = window.document;
```

### Защита от регрессов

Критические тесты защищают от нарушения SPEC:

1. **`memo() блокирует только текущий компонент — дети обновляются`** — падает если добавить skip reconcile для memo-защищённых
2. **`context propagation работает через memo-защищённый компонент`** — падает если ранний выход при memo hit
3. **`parent memo блокирует render, но дети проходят props() → memo() → render()`** — падает если быстрая проверка memo в update()
4. **`memo() не блокирует onUpdated родителя`** — падает если onUpdated вызывается при memo-skip
5. **`instance сохраняется при перемещении между родителями`** — падает если keyMap неправильно работает

---

## Перспективные направления

> Не реализовано. Идеи для будущих оптимизаций.

### 1. Dirty context flag (для Memo skip)

Флаг на instance если context изменился. Memo-компонент может skip `_rerender` если props те же AND context не dirty.

**Потенциал:** Memo skip 3.10ms → ~1.5ms (догнать React 1.00ms).

**Риск:** высокий — требует tracking dirty state по дереву, усложняет архитектуру.

### 2. Key-based reconciliation с skip unchanged keys (для Update 1 of 5000)

Если key + tag + props идентичны → skip reconcile для этого ребёнка.

**Потенциал:** Update 1 of 5000 1.80ms → ~1.0ms (догнать React).

**Риск:** средний — нужно аккуратно с context propagation (только для HTML, не компоненты).

### 3. Оптимизация syncDOMChildren для insert-в-середину (для Insert middle)

Сейчас O(n) insertBefore. Можно LIS (Longest Increasing Subsequence) как в React.

**Потенциал:** Insert middle 3.70ms → ~2.0ms.

### 4. Faster mount (для Mount components)

React быстрее на 1.3x в Mount 5000 components. Можно посмотреть что в `mountComponent` тормозит.

### 5. Поддержка keyed HTML-элементов

Сохранение DOM-узлов input при перемещении (фокус, selection, scroll position).

### 6. DevTools интеграция

Визуализация дерева компонентов, инспектор props/state, timeline lifecycle.

### 7. TypeScript определения

Типы для `h()`, `Component`, `mount()`, generics для props/state.

---

## Ссылки

- **SPEC.md** — полная спецификация (публичный контракт)
- **AIDEV.md** — личность AI-разработчика (стиль, принципы, уроки)
- **README.md** — руководство пользователя
- **CHANGELOG.md** — история изменений (зона AISEC)
- **bench.html** — бенчмарк tyaff vs React (14 сценариев)
- **tests/** — тесты с примерами использования

---

*Последнее обновление: 2026-06-30 (раунд 2 оптимизаций активен, раунд 3 откатан)*
---

## Mount optimization: прямой appendChild + applyPropsDirect (2026-07-01)

### Контекст

Mount 5000 components: React 34.80ms, tyaff 46.40ms (1.3x отрыв). Цель — ускорить mount путь.

### Анализ (микробенчмарк, happy-dom, N=5000)

| Что | Время | Доля |
|-----|-------|------|
| Full mount (5000 components) | 246.8ms | 100% |
| Mount 5000 div (без компонентов) | 156.7ms | 63% |
| new Item() × 5000 (constructor) | 0.46ms | 0.2% |
| h() × 5000 | 0.34ms | 0.1% |
| vanilla DOM × 5000 | 94.5ms | 38% |

**Вывод:** конструктор и h() — НЕ узкое место (0.3%). Основное время — DOM операции + reconcile.

### Что изменилось

**1. `mountHTML`: прямой `appendChild` вместо `prependAll(dom, childNodes)`**

Было:
```javascript
const childNodes = [];
for (let i = 0; i < vnode.childs.length; i++) {
    const r = mountNode(vnode.childs[i], dom, ctx, childPath, keyMap, childNamespace);
    pushAll(childNodes, r);
}
prependAll(dom, childNodes);  // O(n) spread
```

Стало:
```javascript
for (let i = 0; i < vnode.childs.length; i++) {
    const r = mountNode(vnode.childs[i], dom, ctx, childPath, keyMap, childNamespace);
    if (r == null) continue;
    if (Array.isArray(r)) {
        for (let j = 0; j < r.length; j++) if (r[j]) dom.appendChild(r[j]);
    } else {
        dom.appendChild(r);
    }
}
```

Убирает сбор в массив + `parent.prepend(...nodes)` spread.

**2. `applyPropsDirect` — fast-path для mount**

Новая функция применяет props напрямую без сравнения с `oldProps={}`:
```javascript
function applyPropsDirect(dom, props, namespace) {
    // for...in по props, applyProp для каждого
    // Skip value для form elements — применяется отдельно в конце mountHTML
    // (select value нужно применять ПОСЛЕ mount children — нужны options)
}
```

`applyProps(dom, {}, props)` делал `for...in` по `oldProps={}` (пусто) + `for...in` по `newProps` + сравнение `oldProps[k] !== newProps[k]`. На mount oldProps пустой — сравнение всегда "новое". `applyPropsDirect` пропускает эти проверки.

### Баги которые поймал

1. **select multiple value** — `applyPropsDirect` сначала skip'ал value для select, но value нужно применять ПОСЛЕ mount children (options). Решение: skip value в `applyPropsDirect`, применять в конце `mountHTML` как раньше.

2. **select multiple attribute** — случайно skip'ал `multiple` для select в `applyPropsDirect`. `applyProp` для multiple делает `dom.multiple = !!value` — это безопасно, не нужно skip'ать. Убрал skip.

### Замеры (happy-dom, N=5000, 3 прогона, лучший)

| Что | Было (v2) | Стало (v4) | Эффект |
|-----|-----------|------------|--------|
| **Full mount (5000 components)** | 246.8ms | **199.5ms** | **-19%** ✅ |
| Mount 5000 div (без компонентов) | 156.7ms | 148.6ms | -5% |
| Update 1 of 5000 | 4.54ms | 4.53ms | паритет |
| Memo skip (5000) | 4.52ms | 4.37ms | -3% |
| No memo (5000) | 8.86ms | 7.78ms | **-12%** ✅ |
| Insert middle | 4.96ms | 4.40ms | **-11%** ✅ |
| Update all rows | 5.39ms | 4.95ms | **-8%** ✅ |

No memo, Insert middle, Update all rows ускорились потому что `applyPropsDirect` и прямой `appendChild` работают не только на initial mount, но и при reconcil'е с новыми элементами.

### Тесты

Все 134 теста проходят (test-node-01..05).

### Ожидание для браузера

В браузере Mount 5000 components: 46.4ms → ~37ms (догнать React 34.8ms). Нужно подтвердить через bench.html.
---

## Fast path в reconcileHTML: skip reconcileChildren (2026-07-01)

### Контекст

Update 1 of 5000: React 1.0-2.2ms, tyaff 2.2-2.7ms (1.0-1.3x отрыв). Цель — стабильно догнать React.

### Анализ

Для Update 1 of 5000 на каждый из 5000 div'ов в `reconcileChildren`:
```
reconcile(oc, nc) → reconcileHTML:
  - shallow props compare → skip applyProps ✅ (уже было)
  - reconcileChildren для текста:
    - collectDOMNodes(oldChilds=1 text) ← O(1), но вызов функции
    - reconcile(text, text) → text skip ✅ (уже было)
    - syncDOMChildren(dom, [text], [text]) ← n===o, skip
```

Уже было 2 skip'а, но **вызов `reconcileChildren` + `collectDOMNodes` + `syncDOMChildren`** всё равно делался для каждого из 5000 детей.

### Что изменилось

Fast path в `reconcileHTML` — если props не изменились И дети — одиночный текстовый узел без изменений → skip `reconcileChildren`:

```javascript
if (!propsChanged) {
    const oc = oldVnode.childs;
    const nc = newVnode.childs;
    if (oc === nc) {
        // Та же ссылка на childs — точно не изменились
        newVnode._nodes = oldVnode._nodes;
        return dom;
    }
    if (oc && nc && oc.length === 1 && nc.length === 1) {
        const oc0 = oc[0], nc0 = nc[0];
        if (oc0 && nc0
            && oc0._text !== undefined
            && nc0._text !== undefined
            && oc0._text === nc0._text) {
            // Одинаковый текстовый ребёнок — переиспользуем DOM и _nodes
            nc0._el = oc0._el;
            newVnode._nodes = oldVnode._nodes;
            return dom;
        }
    }
}
```

Пропускает: `collectDOMNodes` + `reconcile` для текста + `syncDOMChildren`.

### Замеры (happy-dom, N=5000, 5 прогонов, среднее)

| Сценарий | v5 (без fast path) | v6 (с fast path) | Эффект |
|----------|--------------------|--------------------|--------|
| **Update 1 of 5000** | 4.29 ms | **3.24 ms** | **-24%** 🔥 |
| Insert middle | 4.90 ms | 4.44 ms | -9% |
| Update all rows | 5.72 ms | 5.88 ms | паритет |
| Memo skip | ~4.4 ms | ~6.1 ms (1 замер) | нужно больше замеров |
| No memo | ~8.2 ms | ~6.9 ms (1 замер) | -15% |

### Тесты

Все 134 теста проходят (test-node-01..05).

### Безопасность

Fast path срабатывает только когда:
1. `!propsChanged` — props shallow equal (уже проверяется выше)
2. `oc === nc` (та же ссылка) ИЛИ `oc[0]._text === nc[0]._text` (одинаковый текст)

В обоих случаях поддерево гарантированно не изменилось → переиспользуем `oldVnode._nodes` и `oc0._el`. Это безопасно потому что:
- DOM-узел текста остаётся тот же (`nc0._el = oc0._el`)
- `_nodes` массив остаётся тот же (`newVnode._nodes = oldVnode._nodes`)
- Если текст изменился — fast path не срабатывает, идёт обычный `reconcileChildren` с text skip

### Ожидание для браузера

Update 1 of 5000: 2.2ms → ~1.7ms (догнать React 1.0-2.2ms). Нужно подтвердить через bench.html.
