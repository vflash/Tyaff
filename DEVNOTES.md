# 📝 DevNotes: Обоснование решений и логика реализации

Этот документ содержит ход технических мыслей, архитектурный выбор и логику реализации задач из ТЗ. Здесь зафиксированы причины, по которым были приняты или отклонены те или иные решения, а также приведены наглядные примеры кода для понимания контекста.

> **Зачем нужен этот файл:** ТЗ описывает *что* нужно сделать. Этот документ объясняет *как* это сделано и *почему* именно так, помогая избежать слепых зон при поддержке и ревью кода.

---

## 1. memo() и pull-based контекст

### Проблема
Изначальная реализация `memo()` защищала не только `render()` компонента, но и всё его поддерево. Это приводило к "заморозке" детей при смене контекста:

```javascript
const Parent = Component({
    memo(props) { return [props.value]; },  // ❌ context не включён
    render(props) {
        return h('div', null,
            h(ChildReader, null)  // читает this.context('theme')
        );
    }
});

// При смене theme → Parent не рендерится → ChildReader тоже не рендерится
```

### Решение
`memo()` защищает **только render текущего компонента**. Дети проходят свою цепочку `props → memo → render` независимо от родителя.

### Техническая реализация
При пропуске render используется старый vnode (`newVdom = oldVdom`). В `reconcile()` при `oldNode === newNode` (fast path) для HTML-тегов **рекурсивно обходятся дети**:

```javascript
if (oldNode === newNode) {
    // ...
    } else if (newNode && typeof newNode.tag === 'string') {
        // HTML-тег — recurse в детей
        if (newNode.childs) {
            for (let i = 0; i < newNode.childs.length; i++) {
                reconcile(newNode.childs[i], newNode.childs[i],
                          newNode._el, ctx, path + ',' + i, keyMap, namespace);
            }
        }
        return extractNodes(newNode);
    }
    // ...
}
```

### Поведение

| `memo()` вернул | Компонент | Дети |
|----------------|-----------|------|
| Те же зависимости | ❌ render пропущен | ✅ проходят цепочку |
| Другие зависимости | ✅ render выполнен | ✅ проходят цепочку |

**Рекомендация разработчикам:** включать context в memo() для оптимизации:

```javascript
const ThemedCard = Component({
    memo(props) {
        return [props.title, this.context('theme')];  // ✅ context включён
    },
    render(props) { ... }
});
```

---

## 2. refresh() — глобальное обновление

### Проблема
Нужна функция для обновления всего дерева при изменении внешних данных (global store, singleton).

### Отвергнутые варианты

**`WeakMap.entries()`** — не существует, WeakMap не итерируемый.

**Только `updateAll()` без Promise** — нельзя измерить время выполнения.

### Финальное решение

```javascript
const mountedTrees = new WeakMap();       // container → vnode (быстрый доступ)
const mountedContainers = new Set();      // для итерации в refresh()

function refresh() {
    const start = performance.now();

    for (const container of mountedContainers) {
        const vnode = mountedTrees.get(container);
        if (!vnode) continue;

        // Собираем ВСЕ instance (работает даже с HTML-корнем)
        const instances = collectAllInstances(vnode);
        for (const inst of instances) {
            inst.update();
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
```

### Почему collectAllInstances вместо findRootInstance

Изначально `refresh()` искал только корневой instance. Это не работало когда корень — HTML-элемент:

```javascript
mount(h('div', null, h(MyComponent)), container);
await refresh();  // ❌ MyComponent не обновлялся
```

`collectAllInstances()` обходит всё дерево и собирает все компоненты, делая refresh() универсальным.

### Use case: Global Store Pattern

```javascript
export const store = { count: 0 };

const Counter = Component({
    render() {
        return h('div', null, 'Count: ', store.count);
    }
});

store.count = 55;
await refresh();  // все компоненты перечитают store
```

---

## 3. Порядок инициализации: props() → init()

### Решение
Фиксированный порядок при первом mount:

1. `props(incoming)` → устанавливает `this.props`
2. `init(props)` → инициализация state (может использовать `this.props`)
3. Первый `_rerender()` → `memo(props)` → `render(props)`
4. `onMounted()` после вставки в DOM

### Почему такой порядок

- **Стандарт индустрии** — React, Vue, Solid так делают
- **Частый use case** — инициализация на основе props:
  ```javascript
  init(props) {
      this._selected = props.defaultSelected || 0;
      this._cache = new Map();
  }
  ```
- **`props()` остаётся чистой функцией** — не зависит от state

### Важное следствие
`props()` вызывается **до** `init()`, поэтому не должна полагаться на instance state:

```javascript
// ❌ НЕПРАВИЛЬНО:
props(incoming) {
    if (this._cache) return this._cache;  // _cache ещё нет!
    return incoming;
}

// ✅ ПРАВИЛЬНО:
props(incoming) {
    return { ...incoming, normalized: true };  // чистая функция
}
```

---

## 4. Props первым аргументом

### Решение
Все ключевые функции получают `this.props` первым аргументом:

```javascript
Component({
    init(props) {
        this._count = props.initialCount || 0;
    },
    memo(props) {
        return [props.value, this._count];
    },
    render({ title, items }) {  // деструктуризация
        return h('div', null, title, items.length);
    },
    props(incoming) {
        return { ...incoming, normalized: true };
    }
});
```

### Преимущества

- **Деструктуризация** прямо в сигнатуре
- **Функциональный стиль** — `render(props)` читается как чистая функция
- **Обратная совместимость** — `this.props` всё ещё работает

### Реализация
Передача props в три места:
- `def.init.call(inst, inst.props)` в `mountComponent()`
- `d.memo.call(this, this.props)` в `_rerender()`
- `d.render.call(this, this.props)` в `_rerender()`

---

## 5. Universal mount()

### Решение
Единая функция вместо трёх (mount/patch/unmount):

```javascript
mount(App, container);           // первый mount
mount(h(App, props), container); // update
mount(null, container);          // unmount
```

### Нормализация входа
`normalizeMountInput()` принимает:
- vnode (объект) — как есть
- конструктор компонента → `h(Component, {})`
- массив → `h(Fragment, {}, ...array)`
- строка/число → текстовый узел
- null/undefined → unmount

### Unmount: порядок как в React

**Неправильно** (DOM уже удалён к моменту lifecycle):
```javascript
container.replaceChildren();  // ❌ СНАЧАЛА удаление
unmountVdom(oldVnode);        // ❌ ПОТОМ lifecycle
```

**Правильно** (DOM доступен в onUnmounted):
```javascript
unmountVdom(oldVnode);        // ✅ СНАЧАЛА lifecycle
container.replaceChildren();  // ✅ ПОТОМ удаление
```

**Зачем нужен DOM в onUnmounted:**
- Сохранение состояния (scroll position, focus)
- Exit-анимации
- Cleanup DOM-привязанных ресурсов (chart.js, maps)
- Отписка от DOM-событий на window/document

### replaceChildren() vs removeChild

`replaceChildren()` — один syscall вместо цикла. Для 100K элементов: ~5ms вместо ~100ms.

**Ограничение:** требует Chrome 86+, FF 78+, Safari 14+ (всё 2020+).

---

## 6. DOM операции: prepend vs insertBefore vs replaceChildren

### Три разных инструмента для трёх сценариев

| Сценарий | Метод | Где |
|----------|-------|-----|
| Initial render (parent пустой) | `prependAll` с чанками | mountHTML, mountPortal |
| Update (parent содержит узлы) | `insertBefore`/`removeChild` | syncDOMChildren |
| Unmount (очистка) | `replaceChildren` | mount(null) |

### Почему нельзя заменить на replaceChildren

```javascript
// ❌ ПЛОХО для re-render:
parentDOM.replaceChildren(...newNodes);
// Удаляет ВСЕ старые узлы, даже неизменённые
// Теряется reuse DOM-узлов → 20x медленнее

// ✅ ХОРОШО для re-render:
for (let i = 0; i < newNodes.length; i++) {
    if (newNodes[i] === oldNodes[i]) continue;  // reuse!
    parentDOM.insertBefore(newNodes[i], ref);
}
```

### prependAll с чанками

```javascript
const PREPEND_CHUNK_SIZE = 20000;

function prependAll(parent, nodes) {
    if (nodes.length <= PREPEND_CHUNK_SIZE) {
        parent.prepend(...nodes);  // один reflow
        return;
    }
    // чанками если больше — защита от лимита аргументов
    for (let i = nodes.length; i > 0; i -= PREPEND_CHUNK_SIZE) {
        parent.prepend(...nodes.slice(start, i));
    }
}
```

---

## 7. triggerMounted: children-first порядок

### Проблема
Изначальная stack-based реализация вызывала `onMounted` в порядке parent-first:

```
Parent.onMounted()     ← первым
  └─ Child.onMounted() ← вторым
```

### Стандарт React
`componentDidMount` вызывается **children-first** — сначала дети, потом родитель. Это важно когда родителю нужно знать что дети уже смонтированы.

### Решение
Два прохода:
1. DFS собирает все компоненты
2. Вызов `onMounted` в обратном порядке

```javascript
function triggerMounted(roots) {
    const components = [];
    // ... DFS собирает компоненты ...

    // Обратный порядок (children-first)
    for (let i = components.length - 1; i >= 0; i--) {
        const d = components[i]._definition;
        if (d.onMounted) d.onMounted.call(components[i]);
    }
}
```

---

## 8. Global Keys: перемещение компонентов

### Проблема
При перемещении компонента между родителями в рамках одного render instance должен сохраниться.

### Решение
Единая функция `makeMapKey()` используется и при сохранении, и при поиске:

```javascript
function makeMapKey(vnode, index, path) {
    if (vnode?.props?.key !== undefined) {
        const userKey = String(vnode.props.key).replace(/,/g, ',,');
        return '#' + userKey + ',' + index;
    }
    return path;  // автоматический ключ
}

// populateKeyMap использует тот же makeMapKey:
if (vnode._instance) {
    const index = path.split(',').pop() || 0;
    const key = makeMapKey(vnode, index, path);
    keyMap.set(key, vnode._instance);
}
```

**Важно:** `populateKeyMap` и `mountComponent` используют **идентичный алгоритм** формирования ключа. Иначе instance не будет найден при перемещении.

---

## 9. Производительность: Big List бенчмарк

### Честные замеры через refresh()

```javascript
async load(count, metricKey) {
    this.items = this.generateItems(count);
    const renderTime = await refresh();  // ждёт завершения render
    this.metrics[metricKey] = renderTime;
}
```

### Результаты (реальные цифры)

| Размер | Initial | Re-render | Partial (1 элемент) |
|--------|---------|-----------|---------------------|
| 1K | 32ms | 2.7ms | 2.4ms |
| 10K | 258ms | 25ms | 10ms |
| 20K | 542ms | 21ms | 21ms |
| 50K | 1529ms | 66ms | 55ms |
| 100K | 2946ms | 150ms | 112ms |

### Ключевые наблюдения

1. **Initial render линейный** — ~30μs на элемент (физика DOM)
2. **Re-render в 10-25x быстрее** — memo() защищает render
3. **Partial update ≈ Re-render** — стоимость обхода дерева O(n)

### Почему Partial ≈ Re-render

Основная стоимость — **обход vnode-дерева**, а не render. `memo()` защищает render (дорогой), но каждый vnode проходит через `reconcileComponent → _rerender → memo()`. Это ~1μs на элемент.

**Архитектурное ограничение:** diff алгоритм линейный O(n). Для 100K+ с частыми updates нужна виртуализация.

### Сравнение с React

| Сценарий | Tyaff | React (без memo) | React (с memo) |
|----------|-------|------------------|----------------|
| 20K Initial | 542ms | ~600ms | ~400ms |
| 20K Re-render | 21ms | ~300ms | ~40ms |
| 20K Partial | 21ms | ~150ms | ~5ms |

Tyaff работает на уровне React **с оптимизациями**, без необходимости `React.memo` для каждого компонента.

---

## 10. Исправленные баги (для истории)

### Баг #1: Fast path не recurse в детей
**Симптом:** memo() защитил render родителя, но дети-компоненты не перечитали контекст.

**Причина:** В `reconcile()` при `oldNode === newNode` для HTML-тегов сразу возвращался `extractNodes` без рекурсии.

**Исправление:** Добавлена обработка HTML-тегов и Fragment с рекурсией в детей.

### Баг #2: Global keys при перемещении
**Симптом:** Компонент с `key="fio"` терял instance при перемещении между родителями.

**Причина:** `populateKeyMap` сохранял по `path`, а `mountComponent` искал по `makeMapKey`.

**Исправление:** `populateKeyMap` теперь использует `makeMapKey`.

### Баг #3: Автобиндинг перезаписывал встроенные методы
**Симптом:** Пользовательский метод с именем `update` перезаписывал встроенный API.

**Исправление:** Проверка `inst[key] === undefined` перед автобиндингом + расширен список `reserved`.

### Баг #4: refresh() не работал для HTML-корня
**Симптом:** `mount(h('div', null, h(MyComponent)), container)` → `refresh()` не обновлял MyComponent.

**Причина:** `refresh()` искал только корневой instance.

**Исправление:** `collectAllInstances()` собирает ВСЕ компоненты в дереве.

### Баг #5: triggerMounted top-down
**Симптом:** Родительский `onMounted` вызывался до детских.

**Исправление:** Двухпроходный алгоритм — сбор + обратный порядок.

---

## 11. Именованные экспорты

### Решение
```javascript
export { h, Component, createPortal, Fragment, mount, refresh };
```

### Почему не default export

```javascript
// ❌ default export:
import VDOM from './core.js';
await VDOM.refresh();  // длинно, нельзя tree-shake

// ✅ именованные экспорты:
import { refresh, mount } from './core.js';
await refresh();  // коротко, tree-shake работает
```

---

## 12. Архитектурные ограничения (принятые осознанно)

### Нет двусторонних ссылок
Компонент хранит только `_vdom` (вниз), не обратную ссылку на vnode. Это упрощает GC и предотвращает утечки памяти.

### Нет state как отдельной сущности
Все переменные — прямые мутабельные свойства на instance (`this._count`). Нет абстракции над state — проще и быстрее.

### O(n) diff алгоритм
Линейная сложность даже для partial updates. Компромисс: простота кода vs производительность для 100K+ элементов. Решение: виртуализация для больших списков.

### Нет fine-grained reactivity (как в Solid.js)
Tyaff использует vnode-diff подход (как React/Vue). Solid.js обновляет только изменённые DOM-узлы без diff, но требует compile-time трансформации. Tyaff — runtime-only библиотека.

---

## 13. Стиль кода и соглашения

- **Отступ:** 4 пробела (не 2)
- **ES6 модули:** `export { ... }`, не `export default`
- **Комментарии:** на русском, только где помогают пониманию логики
- **Нет внешних зависимостей:** чистый JavaScript
- **Названия:** `VDOM`, `Component`, `h`, `reconcile`, `mount` (не `woff`/`tyaff` в коде)

---

## Заключение

Этот документ — живая история разработки. При изменении архитектуры или обнаружении новых edge cases — добавляйте записи сюда. Это помогает новым разработчикам (и себе через месяц) понять **почему** код такой, какой он есть.