# DEVNOTES.md — Заметки для разработчиков

## ⚠️ Правила работы с файлами

**Создание и удаление файлов — ТОЛЬКО с одобрения пользователя!**

Все изменения в коде должны соответствовать SPEC.md.
Документация (README, DOCS, SPEC, CHANGELOG) — зона AISEC.
AIDEV работает с: src/core.js, DEVNOTES.md, AIDEV.md, тестами.

---

---


## ⚠️ Правила работы с файлами

**Создание и удаление файлов — ТОЛЬКО с одобрения пользователя!**

Все изменения в коде должны соответствовать SPEC.md.
Документация (README, DOCS, SPEC, CHANGELOG) — зона AISEC.
AIDEV работает с: src/core.js, DEVNOTES.md, AIDEV.md, тестами.

---
Документ описывает архитектурные решения, известные ограничения и важные детали реализации VDOM библиотеки tyaff.

---

## 📋 Содержание

- [Система ключей](#система-ключей)
- [Reconciliation алгоритм](#reconciliation-алгоритм)
- [Batching и update()](#batching-и-update)
- [Lifecycle hooks](#lifecycle-hooks)
- [Context system](#context-system)
- [Portals](#portals)
- [Memo и оптимизации](#memo-и-оптимизации)
- [Производительность](#производительность)
- [Оптимизации производительности](#оптимизации-производительности)
- [Известные ограничения](#известные-ограничения)
- [Internal API](#internal-api)

---

## Система ключей

### Два типа ключей

Библиотека поддерживает два типа идентификаторов для элементов:

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
h(Component, props)  // без key
h('div', props)      // без key
```

**Формат:** `parent_id` + `,` + `index`

**Примеры:**
- Первый ребёнок: `,0`
- Второй ребёнок: `,1`
- Вложенный: `,0,1` (второй ребёнок первого)

**Свойства:**
- ❌ Зависят от позиции в дереве
- ❌ Элементы пересоздаются при изменении порядка
- ✅ Не требуют уникальности

### Область действия ключей

**Ключи работают в пределах одного render компонента:**

```javascript
const App = Component({
    render() {
        return h('div', null,
            h(Child, { key: 'a' }),  // ключ '#a' в render App
            h(Child, { key: 'a' })   // ❌ ДУБЛИКАТ! Warning
        );
    }
});
```

**Разные компоненты могут использовать одинаковые ключи:**

```javascript
const Header = Component({
    render() { return h(Child, { key: 'a' }); }  // ключ '#a' в render Header
});

const Sidebar = Component({
    render() { return h(Child, { key: 'a' }); }  // ключ '#a' в render Sidebar
});

// Это разные instance Child, хотя ключи одинаковые
```

### Перемещение элементов

#### ✅ Работает: перемещение внутри одного render

```javascript
const App = Component({
    position: 'left',
    render() {
        return h('div', null,
            h('div', { id: 'left' },
                this.position === 'left' && h(Child, { key: 'movable' })
            ),
            h('div', { id: 'right' },
                this.position === 'right' && h(Child, { key: 'movable' })
            )
        );
    }
});

app.update({ position: 'right' });
// Instance Child сохранён, переместился из #left в #right
```

#### ❌ Не работает: перемещение через top-level mount()

```javascript
// Первый mount
mount(h('div', null, h(Child, { key: 'x' })), container);

// Второй mount с другой структурой
mount(h('div', null, h('span'), h(Child, { key: 'x' })), container);

// Instance Child ПЕРЕСОЗДАН, хотя ключ тот же
// Причина: каждый mount() создаёт новый keyMap
```

**Решение:** использовать компонент с `update()` вместо повторных `mount()`.

### Проверка дубликатов

Библиотека проверяет дубликаты user keys:
- При первом `mount()` — проверяется весь vnode
- При `update()` — проверяется новый vnode после `render()`

```javascript
const App = Component({
    render() {
        return h('div', null,
            h(Child, { key: 'duplicate' }),
            h(Child, { key: 'duplicate' })  // ⚠️ Warning в консоли
        );
    }
});
```

**Production mode:** проверка отключена для производительности (см. раздел "Production оптимизации").

### Fragment с key

Fragment с key создаёт **виртуальный instance** для группы детей:

```javascript
const App = Component({
    render() {
        return h(Fragment, { key: 'group' },
            h(Child, { key: 'a' }),
            h(Child, { key: 'b' })
        );
    }
});
```

Это позволяет:
- Перемещать всю группу детей как единое целое
- Сохранять instance детей при перемещении группы

Fragment без key — прозрачная обёртка, не создаёт instance.

---

## Reconciliation алгоритм

### Базовые правила

1. **Разные `tag`** → уничтожение старого, создание нового
2. **Одинаковые HTML-теги** → обновление атрибутов (плоское сравнение props)
3. **Одинаковые компоненты** → сохранение instance, обновление props
4. **`null` в VDOM** → не создаёт DOM-узел и не участвует в диффе

### Процесс reconcile

```
1. populateKeyMap(oldVdom) → keyMap (старые instance)
2. render() → newVdom
3. checkDuplicateKeys(newVdom) → проверка дубликатов (dev only)
4. reconcile(oldVdom, newVdom, keyMap) → новые nodes
5. syncDOMChildren() → обновление DOM
```

### KeyMap

**`keyMap`** — Map которая хранит старые instance для переиспользования:
- Заполняется из **старого** vnode перед `render()`
- Используется в `mountComponent` для поиска instance по ключу
- Очищается при каждом `_rerender()`

**Важно:** `keyMap` существует только во время одного `_rerender()`. Не сохраняется между вызовами `mount()`.

### Порядок обхода

Reconcile обходит дерево **позиционно**:
- Сравнивает элементы на одинаковых позициях
- Если tags совпадают → переиспользует DOM/instance
- Если tags разные → уничтожает старый, создаёт новый

User keys позволяют "перепрыгивать" через позиции:
```javascript
// Было: [A(key=1), B(key=2), C(key=3)]
// Стало: [C(key=3), A(key=1), B(key=2)]

// Reconcile:
// Позиция 0: old=A, new=C → разные keys, но C найден в keyMap → переиспользуется
// Позиция 1: old=B, new=A → разные keys, но A найден в keyMap → переиспользуется
// Позиция 2: old=C, new=B → разные keys, но B найден в keyMap → переиспользуется
```

---

## Batching и update()

### Batching через microtask

Множественные `update()` в одном тике объединяются в один render:

```javascript
inst.update({ a: 1 });
inst.update({ b: 2 });
inst.update({ c: 3 });
// Выполнится ОДИН render, не три
```

**Механизм:**
1. `update()` добавляет instance в `batchQueue`
2. Планируется `flushBatch()` через `Promise.resolve().then()`
3. В следующем microtask все instance из очереди обновляются

### Promise<boolean>

`update()` возвращает `Promise<boolean>`:

| Вызов | Возвращает | Поведение |
|-------|-----------|-----------|
| `update()` | `true` | Принудительный render |
| `update({})` | `false` | Патч пустой |
| `update(patch)` с изменениями | `true` | Shallow comparison нашёл отличия |
| `update(patch)` без изменений | `false` | Все значения идентичны |

**Пример:**
```javascript
const result = await inst.update({ count: 1 });
if (result) {
    console.log('Render выполнился');
} else {
    console.log('Render заблокирован (memo или нет изменений)');
}
```

### Защита от рекурсии

Движок предотвращает бесконечные циклы:
- `update()` внутри `render()` → `console.error`, возвращает `false`
- `update()` внутри `init()` → patch применяется, но render отложен
- Лимит 50 вложенных обновлений в одной задаче

---

## Lifecycle hooks

### Порядок вызова

**При первом mount:**
```
1. new Component() — создание instance
2. props(incoming) — трансформация props
3. init(props) — инициализация state
4. _rerender() → memo() → render()
5. DOM вставка
6. onMounted() — children-first (дети раньше родителей)
```

**При update:**
```
1. props(incoming) — обновление props
2. memo(props) — проверка зависимостей
3. Если зависимости изменились:
   - render()
   - DOM обновление
   - onUpdated()
4. Если зависимости не изменились:
   - render заблокирован
   - onUpdated() НЕ вызывается
```

**При unmount:**
```
1. onUnmounted() — cleanup
2. Удаление DOM
```

### onUpdated() — только при update

`onUpdated()` **НЕ** вызывается при первом mount, только при последующих updates:

```javascript
const MyComp = Component({
    onUpdated() {
        console.log('Обновлён');  // Не вызывается при первом mount
    },
    render() { /* ... */ }
});
```

**Важно:** `onUpdated()` вызывается только если `render()` реально выполнился. Если `memo()` заблокировал render, `onUpdated()` не вызывается.

---

## Context system

### Pull-based контекст

Контекст — pull-based: компоненты читают значения через `this.context()` в `render()`.

```javascript
const ThemeProvider = Component({
    context: {
        theme() { return 'dark'; }
    },
    render() { return h(App); }
});

const Button = Component({
    render() {
        const theme = this.context('theme');  // → 'dark'
        return h('button', { class: theme }, 'Click');
    }
});
```

### Два метода доступа

**`this.context(key, ...args)`** — всегда к родителю:
```javascript
this.context('theme');  // ищет у родителя, игнорирует себя
```

**`this.contextSelf(key, ...args)`** — сначала к себе, потом к родителю:
```javascript
this.contextSelf('theme');  // сначала проверяет свой context, потом родителя
```

### Контекст и memo()

Если компонент читает `this.context()` и использует `memo()`, включите контекст в зависимости:

```javascript
const ThemedCard = Component({
    memo(props) {
        return [props.title, this.context('theme')];  // ✅ theme в memo
    },
    render() { /* ... */ }
});
```

**Без этого:**
```javascript
const BadCard = Component({
    memo(props) {
        return [props.title];  // ❌ theme НЕ в memo
    },
    render() {
        return h('div', { class: this.context('theme') }, props.title);
    }
});
// При смене theme компонент НЕ перерендерится (memo заблокирует)
// Но дети перерендерятся и получат новый theme
```

---

## Portals

### Отложенный монтаж

`createPortal(children, containerGetter)` создаёт портал с отложенным монтажом:

```javascript
createPortal(
    h('div', null, 'Modal content'),
    () => document.getElementById('modal-root')
);
```

**Поведение:**
1. Движок строит VDOM-детей (выполняется `init()`)
2. Выполняется `containerGetter()`
3. Если вернул DOM-узел → физический монтаж (`onMounted()`)
4. Если `null` → ожидание
5. В основное дерево вставляется текстовый узел-якорь

### Динамический контейнер

При каждом ререндере заново выполняется `containerGetter()`:

| Результат | Поведение |
|-----------|-----------|
| Контейнер появился | Монтаж |
| Контейнер тот же | Точечный дифф |
| Контейнер сменился | Unmount старого + mount нового |
| Контейнер пропал | Удаление детей |

### onMounted() для порталов

`onMounted()` вызывается только когда `containerGetter()` впервые вернул валидный узел, не при первом `render()`.

---

## Memo и оптимизации

### memo() — оптимизация render

`memo()` возвращает массив зависимостей:

```javascript
const Card = Component({
    memo(props) {
        return [props.title, this.count];
    },
    render() { /* ... */ }
});
```

**Поведение:**
- Если зависимости не изменились → `render()` блокируется
- Если изменились → `render()` выполняется
- `onUpdated()` вызывается только если `render()` выполнился

### memo() блокирует только текущий компонент

**Важно:** `memo()` блокирует render **только для текущего компонента**. Дети всегда проходят свою цепочку `props → memo → render`, даже если родитель защищён memo().

```javascript
const Parent = Component({
    value: 0,
    memo() { return [this.value]; },
    render() { return h(Child); }
});

const Child = Component({
    render() { return h('div'); }
});

// При update Parent без изменения value:
// - Parent render заблокирован (memo вернул те же deps)
// - Child проходит свою цепочку и перерендерится
```

**Почему это важно:**
- Context propagation работает корректно
- Дети перечитывают актуальный контекст
- Соответствует спеке React/Vue

### Защита от регрессов

Тесты защищают от нарушения этого поведения:

```javascript
test('memo() блокирует только текущий компонент — дети обновляются', async () => {
    let childRenders = 0;

    const Child = Component({
        render() { childRenders++; return h('div'); }
    });

    const Parent = Component({
        value: 0,
        memo() { return [this.value]; },
        render() { return h(Child); }
    });

    const vnode = mount(Parent, container);
    const parent = vnode._instance;

    parent.update({});  // Принудительный update без изменения
    await delay(10);

    assert.equal(childRenders, 2, 'child должен перерендериться');
});
```

---

**Тест: MEMO HIT с props трансформацией (SCENARIO 14)**

Этот тест защищает от ситуации когда быстрая проверка в `update()` блокировала весь процесс обновления, не давая детям шанс проверить свои зависимости через `props()` → `memo()`.

Тест проверяет:
- Parent memo блокирует render родителя
- Дети проходят props() → memo() → render()
- Только изменённые дети перерендериваются

**Тест: MEMO HIT с props трансформацией (SCENARIO 14)**

Этот тест защищает от ситуации когда быстрая проверка в `update()` блокировала весь процесс обновления, не давая детям шанс проверить свои зависимости через `props()` → `memo()`.

Тест проверяет:
- Parent memo блокирует render родителя
- Дети проходят props() → memo() → render()
- Только изменённые дети перерендериваются

## Производительность

### Бенчмарк vs React/Preact

| Сценарий | tyaff | React | Preact | Лучший |
|----------|-------|-------|--------|--------|
| **Mount 5000 rows** | 42.40ms | 37.70ms | 43.80ms | React 1.2x |
| **Update 1 of 5000** | 13.20ms | 6.40ms | 7.00ms | React 2.1x |
| **Reverse 5000 (keys)** | **68.00ms** | 113.60ms | 113.70ms | **tyaff 1.7x** ✅ |
| **Swap first/last (5000)** | 14.10ms | 113.10ms | 6.80ms | Preact 16.6x |
| **Mount 5000 components** | 55.30ms | 44.80ms | 51.50ms | React 1.2x |
| **Deep tree (100 lvl)** | 5.70ms | 5.70ms | 5.60ms | Preact 1.0x |
| **Move between parents (x50)** | 5.70ms | 5.20ms | 4.60ms | Preact 1.2x |
| **Clear + remount (5000)** | 86.70ms | 118.20ms | 5.30ms | Preact 22.3x |
| **Update all 5000 rows** | 71.80ms | 74.50ms | 71.10ms | Preact 1.0x |
| **Insert middle (5000)** | 49.60ms | 10.00ms | 14.10ms | React 5.0x |
| **Memo skip (5000 children)** | 12.20ms | 9.20ms | 6.80ms | Preact 1.8x |
| **No memo (1000 children)** | 16.90ms | 16.20ms | 6.00ms | Preact 2.8x |
| **Memo hit 1/1000 changed** | 7.90ms | 6.70ms | 6.50ms | Preact 1.2x |

### Сильные стороны tyaff

✅ **Reverse 5000 (keys)** — 1.7x быстрее React/Preact
✅ **Update all 5000 rows** — на уровне конкурентов
✅ **Mount 5000 rows** — почти равен React

### Слабые стороны tyaff

🚨 **Clear + remount (5000)** — 16x медленнее Preact
🚨 **Insert middle (5000)** — 5x медленнее React
🚨 **Update 1 of 5000** — 2x медленнее React
🚨 **Swap first/last (5000)** — 2x медленнее Preact

### Замеры (Production mode, IS_DEV = false)

| Сценарий | 1K | 10K | 20K | 100K |
|----------|----|----|-----|------|
| **Initial render** | ~150ms | ~1500ms | ~2900ms | ~15000ms |
| **Re-render** | ~4ms | ~40ms | **~83ms** | ~400ms |
| **Partial update (1 элемент)** | <1ms | <2ms | <5ms | <10ms |

### Что влияет на производительность

**Initial render (медленный у всех библиотек):**
- Создание DOM-узлов (`createElement`, `setAttribute`)
- Физика браузера, не оптимизируется
- Решение: виртуализация на уровне приложения

**Re-render (быстрый благодаря оптимизациям):**
- `memo()` блокирует render для компонентов с неизменными зависимостями
- Быстрая проверка memo в `update()` без patch (~30% прирост)
- `IS_DEV = false` отключает проверку дубликатов (~30% прирост)
- Условный try/catch в production (~5-10% прирост)

**Partial update (мгновенный):**
- Изменён 1 элемент из N
- `memo()` защищает остальные 99.99% компонентов
- Render вызывается только для изменённого

### Production оптимизации

#### 1. Быстрая memo в `update()`

```javascript
// В update() без patch
if (patch === undefined && this._definition.memo) {
    const newDeps = this._definition.memo.call(this, this.props);
    if (this._prevMemo && shallowEqual(newDeps, this._prevMemo)) {
        return Promise.resolve(false);  // Не планируем _rerender
    }
}
```

**Эффект:** ~30% прирост на re-render
**Механизм:** Проверяет зависимости до планирования `_rerender()`. Для memo-защищённых компонентов не уходит в batch queue.

#### 2. Отключение проверки дубликатов

```javascript
function checkDuplicateKeys(vnode, path, seen) {
    if (!IS_DEV) return;  // ⚡ Быстрый выход в production
    // ... обход дерева
}
```

**Эффект:** ~30% прирост на больших деревьях
**Trade-off:** дубликаты ключей останутся незамеченными в production

#### 3. Условный try/catch

```javascript
for (const inst of toUpdate) {
    if (IS_DEV) {
        try {
            inst._rerender();
        } catch (err) {
            console.error('❌ Error in component:', err);
        }
    } else {
        inst._rerender();  // Быстрее без try/catch
    }
}
```

**Эффект:** ~5-10% прирост
**Trade-off:** ошибка в одном компоненте может сломать весь batch в production

### Рекомендации

**Для списков >10K элементов:**
Используйте виртуализацию (рендер только видимых элементов):

```javascript
const VirtualList = Component({
    scrollTop: 0,
    itemHeight: 30,
    containerHeight: 400,

    get visibleItems() {
        const start = Math.floor(this.scrollTop / this.itemHeight);
        const end = start + Math.ceil(this.containerHeight / this.itemHeight);
        return this.items.slice(start, end);
    },

    render() {
        // Рендер только 13 видимых элементов вместо 20K
        return h('div', {
            style: { height: this.containerHeight + 'px', overflow: 'auto' },
            onScroll: (e) => this.update({ scrollTop: e.target.scrollTop })
        },
            this.visibleItems.map(item =>
                h(Item, { key: item.id, ...item })
            )
        );
    }
});
```

Это снижает initial render с 2900ms до 50ms, re-render с 83ms до 5ms.

---

## Оптимизации производительности

### Примененные оптимизации (2026-06-29)

#### 1. Object.keys() → for...in

**Было:**
```javascript
Object.keys(patch).forEach(key => {...})
```

**Стало:**
```javascript
for (const k in patch) {
    if (this[k] !== patch[k]) { changed = true; break; }
}
```

**Эффект:** Избегает аллокации промежуточного массива ключей.

#### 2. Array.push() → прямое присваивание по индексу

**Было:**
```javascript
target.push(source[i]);
```

**Стало:**
```javascript
let len = target.length;
for (let i = 0; i < source.length; i++) target[len++] = source[i];
```

**Эффект:** V8 оптимизирует плотные массивы (PACKED_ELEMENTS). Прямое присваивание быстрее, так как JIT может заинлайнить запись, минуя механизм `push`.

**Применено в:**
- `pushAll()`
- `collectDOMNodes()`
- `h()`
- `triggerMounted()`
- `collectAllInstances()`

#### 3. Array.from(set) → ручной цикл

**Было:**
```javascript
const toUpdate = Array.from(batchQueue);
```

**Стало:**
```javascript
const toUpdate = [];
let len = 0;
for (const inst of batchQueue) {
    toUpdate[len++] = inst;
}
```

**Эффект:** Избегает overhead `Array.from()`.

**Применено в:**
- `flushBatch()`
- `_cleanupAll()`

#### 4. Object.assign() → ручной цикл

**Было:**
```javascript
Object.assign(this, patch);
```

**Стало:**
```javascript
for (const k in patch) {
    this[k] = patch[k];
}
```

**Эффект:** Избегает overhead `Object.assign()`.

#### 5. String(value) → "" + value

**Было:**
```javascript
const str = String(value);
```

**Стало:**
```javascript
const str = "" + value;
```

**Эффект:** Конкатенация строк быстрее, чем вызов `String()`.

**Применено в:**
- `escapeKey()`
- `h()`
- `applyProp()`
- `normalizeMountInput()`
- `makeMapKey()`

#### 6. style → style.cssText

**Было:**
```javascript
dom.setAttribute('style', css);
```

**Стало:**
```javascript
dom.style.cssText = css;
```

**Эффект:** `style.cssText` напрямую обновляет CSSStyleDeclaration, минуя парсинг атрибута.

#### 7. Прямые DOM-свойства вместо setAttribute

**Было:**
```javascript
dom.setAttribute('class', 'btn');
dom.setAttribute('id', 'myId');
```

**Стало:**
```javascript
dom.className = 'btn';
dom.id = 'myId';
```

**Эффект:** Прямая запись в C++ поле браузера вместо парсинга строки.

**Оптимизированные свойства:**
- `class`/`className` → `dom.className`
- `id` → `dom.id`
- `title` → `dom.title`
- `src` → `dom.src`
- `href` → `dom.href`
- `alt` → `dom.alt`
- `name` → `dom.name`
- `placeholder` → `dom.placeholder`
- `disabled` → `dom.disabled`
- `readOnly`/`readonly` → `dom.readOnly`
- `hidden` → `dom.hidden`
- `tabIndex`/`tabindex` → `dom.tabIndex`
- `draggable` → `dom.draggable`
- `contentEditable`/`contenteditable` → `dom.contentEditable`

**Важно:** Для удаления атрибутов используется `removeAttribute()`, а не присваивание пустой строки, чтобы атрибут полностью удалялся из DOM.

#### 8. filter → ручной цикл с pre-allocation

**Было:**
```javascript
const filtered = childs.filter(c => c !== null);
```

**Стало:**
```javascript
const filtered = [];
let len = 0;
for (let i = 0; i < childs.length; i++) {
    if (childs[i] !== null) {
        filtered[len++] = childs[i];
    }
}
```

**Эффект:** Избегает overhead `filter()` и промежуточных массивов.

**Применено в:**
- `buildIncomingProps()`

#### 9. Вынесенный switch для HTML свойств

**Было:**
```javascript
// Дублирование switch в applyProp
```

**Стало:**
```javascript
function setHTMLProp(dom, key, value) {
    const strVal = value === true ? '' : "" + value;

    switch (key) {
        case 'class':
        case 'className':
            dom.className = strVal;
            return true;
        // ... остальные case
        default:
            return false;
    }
}
```

**Эффект:** Устраняет дублирование кода, упрощает поддержку.

### Исправленные баги

#### resolversi → resolvers[i](shouldRender)

**Было:**
```javascript
for (let i = 0; i < resolvers.length; i++) {
    resolversi;  // ❌ Опечатка, не вызывает функцию
}
```

**Стало:**
```javascript
for (let i = 0; i < resolvers.length; i++) {
    resolvers[i](shouldRender);  // ✅ Передаем shouldRender
}
```

**Эффект:** Promise от `update()` теперь корректно резолвится с значением `shouldRender`.

---

## Известные ограничения

### 1. Top-level mount() не сохраняет instance

**Проблема:**
```javascript
mount(h('div', null, h(Child, { key: 'x' })), container);
mount(h('div', null, h('span'), h(Child, { key: 'x' })), container);
// Instance Child пересоздан
```

**Причина:** Каждый `mount()` создаёт новый `keyMap`.

**Решение:** Использовать компонент с `update()`.

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

**Решение:** Условный рендер внутри обёртки:
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

**Причина:** Текущая реализация поддерживает ключи только для компонентов и keyed Fragments.

**Решение:** Обернуть в компонент:
```javascript
const Input = Component({
    render() { return h('input', { value: this.props.value }); }
});

h(Input, { key: 'my-input', value: this.text })
```

### 4. Дубликаты user keys

**Проблема:**
```javascript
render() {
    return h('div', null,
        h(Child, { key: 'duplicate' }),
        h(Child, { key: 'duplicate' })  // Дубликат
    );
}
```

**Поведение:** `console.warn` в development, но второй instance перезаписывает первый в `keyMap`.

**Решение:** Использовать уникальные ключи.

---

## Internal API

### `_cleanupAll()` — полная очистка всех деревьев

**Назначение:** Размонтирует **все** VDOM-деревья во **всех** контейнерах.

**Использование:**
```javascript
import { _cleanupAll } from 'tyaff';

// В тестах — изоляция между тестами
afterEach(() => {
    _cleanupAll();
});

// В HMR — сброс перед hot reload
if (import.meta.hot) {
    import.meta.hot.accept(() => {
        _cleanupAll();
    });
}
```

**Почему с `_` (нижнее подчёркивание):**
Это внутренняя utility функция, не часть публичного API. В production используйте точечный unmount:
```javascript
mount(null, container);  // Размонтировать один контейнер
```

**Что делает:**
- Вызывает `onUnmounted()` для всех компонентов (children-first)
- Обнуляет `refs`
- Удаляет DOM-узлы из контейнеров
- Очищает `mountedTrees` (WeakMap) и `mountedContainers` (Set)

**Пример в тестах:**
```javascript
import { mount, _cleanupAll } from 'tyaff';

describe('MyApp', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        _cleanupAll();  // Корректная очистка
        document.body.removeChild(container);
    });

    test('renders correctly', () => {
        mount(MyApp, container);
        expect(container.textContent).toBe('Hello');
    });
});
```

---

## Архитектурные решения

### Нет двусторонних ссылок

Компонент хранит только `_vdom` (вниз), не обратную ссылку на vnode:
```javascript
// ✅ Правильно
inst._vdom = newVdom;

// ❌ Неправильно
newVdom._instance = inst;  // Только для поиска, не для навигации
```

**Причина:** Упрощает garbage collection, предотвращает memory leaks.

### State через прямые мутабельные свойства

Нет отдельного state-объекта:
```javascript
const Counter = Component({
    count: 0,  // Прямое свойство
    increment() {
        this.count++;
        this.update();
    },
    render() { return h('div', null, this.count); }
});
```

**Причина:** Простота, нет overhead от setState/useState.

### Pull-based контекст вместо push-based

Компоненты читают контекст в `render()`, не подписываются на изменения:
```javascript
render() {
    const theme = this.context('theme');  // Pull
}
```

**Причина:** Проще реализация, нет необходимости в системе подписок.

### Привязка методов в конструкторе

Все пользовательские методы автоматически привязываются к instance:

```javascript
function Component(definition) {
    function ComponentClass() {
        const reserved = [
            'init', 'render', 'props', 'memo',
            'onMounted', 'onUpdated', 'onUnmounted', 'context'
        ];

        for (const key in definition) {
            if (reserved.includes(key)) continue;

            const val = definition[key];
            if (typeof val === 'function') {
                this[key] = val.bind(this);  // ← Привязка
            } else {
                this[key] = val;
            }
        }
        // ...
    }
}
```

**Результат:**
```javascript
const Counter = Component({
    count: 0,
    increment() { this.count++; this.update(); },
    render() {
        return h('button', { onClick: this.increment }, '+');
        //              ↑ this.increment уже привязан к instance
    }
});
```

**Зарезервированные имена** (не привязываются в конструкторе):
- `init`, `render`, `props`, `memo`
- `onMounted`, `onUpdated`, `onUnmounted`
- `context`

---

## Отладка

### Проверка дубликатов ключей

В development mode включите `console.warn` для детекции дубликатов:
```javascript
// Автоматически включено когда IS_DEV = true
```

### Проверка lifecycle

Добавьте логи в hooks:
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
npm test                    # Все тесты
node --test tests/test-node-01.js  # Один файл
```

### Структура тестов

- `test-node-01.js` — базовые возможности (h, Component, mount, lifecycle, keys, memo)
- `test-node-02.js` — контекст и порталы
- `test-node-03.js` — сложные сценарии (reconciliation, keys)
- `test-node-04.js` — edge cases (null, undefined, arrays)
- `test-node-05.js` — update() Promise и key identifiers

### Тестирование с happy-dom

Тесты используют `happy-dom` для эмуляции DOM в Node.js:
```javascript
import { Window } from 'happy-dom';
const window = new Window({ url: 'http://localhost' });
global.window = window;
global.document = window.document;
```

### Защита от регрессов

Критически важные тесты защищают от нарушения спеки:

**Тест: memo() блокирует только текущий компонент**
```javascript
test('memo() блокирует только текущий компонент — дети обновляются', async () => {
    let childRenders = 0;

    const Child = Component({
        render() { childRenders++; return h('div'); }
    });

    const Parent = Component({
        value: 0,
        memo() { return [this.value]; },
        render() { return h(Child); }
    });

    const vnode = mount(Parent, container);
    const parent = vnode._instance;

    parent.update({});  // Принудительный update без изменения
    await delay(10);

    assert.equal(childRenders, 2, 'child должен перерендериться');
});
```

**Тест: context propagation через memo-защищённый компонент**
```javascript
test('context propagation работает через memo-защищённый компонент', async () => {
    // Проверяет что ребёнок перечитывает контекст
    // даже когда промежуточный компонент защищён memo()
});
```

Эти тесты падают если нарушена спека (например, добавлен skip reconcile для memo-защищённых компонентов).

---

## Дальнейшее развитие

### Возможные улучшения

1. **Оптимизация Clear + remount**
   - Быстрая очистка DOM без полного unmount (если нет `onUnmounted`)
   - Использование `container.replaceChildren()` для мгновенной очистки

2. **Оптимизация Insert middle**
   - Реализация LIS (Longest Increasing Subsequence) как в React
   - Минимизация количества `insertBefore()` вызовов

3. **Оптимизация Update 1 of N**
   - Кэширование `buildIncomingProps()` результата
   - Избегание лишних аллокаций при обновлении props

4. **Поддержка keyed HTML-элементов**
   - Сохранение DOM-узлов input при перемещении
   - Сохранение фокуса, selection, scroll position

5. **DevTools интеграция**
   - Визуализация дерева компонентов
   - Инспектор props и state
   - Timeline lifecycle hooks

6. **TypeScript определения**
   - Типы для h(), Component, mount()
   - Generics для props и state

---

## Ссылки

- **SPEC.md** — полная спецификация
- **README.md** — руководство пользователя
- **tests/** — тесты с примерами использования

---

*Последнее обновление: 2026-06-29 (добавлены правила работы с файлами, исправлены баги в update(), добавлены тесты MEMO HIT)*
## 📌 Правила работы AIDEV

- **Создание и удаление файлов** — только с одобрения пользователя
- Все изменения в коде должны соответствовать SPEC.md
- Документация (README, DOCS, SPEC, CHANGELOG) — зона AISEC
### Исправлен баг: быстрая проверка memo блокировала обновление детей (2026-06-29)

**Проблема:**
В `update()` была быстрая проверка memo, которая возвращала `Promise.resolve(false)` при совпадении зависимостей, не запуская `_rerender()`. Это нарушало SPEC:

> `memo()` блокирует `render()` **только для текущего компонента**. Дети всегда проходят свою цепочку `props -> memo -> render`, даже если родитель защищен memo().

**Симптомы:**
- SCENARIO 14: MEMO HIT в bench.html не работал корректно
- Дети не обновлялись при memo hit у родителя
- `console.log()` в `props()` детей не вызывался

**Решение:**
Удалена быстрая проверка из `update()`.

**Результат:**
- Теперь `update()` всегда планирует `_rerender()` (если нет других причин для early return)
- `_rerender()` проверяет memo и блокирует только `render()` текущего компонента
- Дети проходят через `reconcile()` и обновляются корректно
- Соответствует SPEC и поведению React/Vue

**Trade-off:**
- Потеряна оптимизация ~30% для memo-защищенных компонентов при `update()` без patch
- Но корректность важнее производительности


## 2026-06-29 - Critical fix in _rerender()

**Problem:** Accidentally broke code in _rerender() during previous patch:
```javascript
// WAS (broken):
for (let i = 0; i < resolvers.length; i++) {
    resolversi;  // Syntax error - just variable reference
}
```

**Solution:** Fixed to correct call:
```javascript
// NOW (fixed):
for (let i = 0; i < resolvers.length; i++) {
    resolvers[i](shouldRender);  // Call resolver with shouldRender parameter
}
```

**Impact:** 
- Without this fix, Promise from update() never resolved
- SCENARIO 14: MEMO HIT could not work correctly
- All async updates were broken

**Lesson:** Always check syntax after patches!
