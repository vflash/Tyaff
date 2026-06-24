# SYSTEM PROMPT: Custom VDOM JS Library (tyaff Implementation)

Реализуй компактную библиотеку на чистом JavaScript (ES6+) — альтернативу React. Название библиотеки — **tyaff** (используется только в документации). Библиотека использует собственный VDOM, diff/patch алгоритм, кастомный жизненный цикл, динамическое дерево контекстов, порталы с отложенным монтированием.

---

## 📦 ЭКСПОРТЫ МОДУЛЯ

Модуль экспортирует **именованные функции**:

```javascript
export { h, Component, createPortal, Fragment, mount, refresh };
```

**Импорт:**
```javascript
// Именованные экспорты (рекомендуется)
import { h, Component, mount, refresh } from './core.js';

// Или отдельные
import { refresh } from './core.js';
import { mount } from './core.js';
```

---

## 🚫 ИМЕНОВАНИЕ В КОДЕ

- Название `tyaff` используется **только в документации**
- В коде ЗАПРЕЩЕНО использовать слово `tyaff` в именах
- Используй общие названия: `VDOM`, `Component`, `h`, `reconcile`, `mount`
- Публичный API — объект с методами, а не класс

---

## 1. JSX RUNTIME & VDOM STRUCTURE

Функция `h(type, props, ...children)` возвращает плоский объект: `{ tag, props, childs }`.

**Нормализация детей:**
- Массивы в `children` **остаются массивами** (не оборачиваются в Fragment)
- Для элементов внутри массивов ключи формируются как если бы был Fragment
- `null`, `undefined`, `false` → `null` в VDOM (плейсхолдеры)
- **Текстовые узлы обязательно оборачиваются в объекты** (`{ _text: String(value) }`)
- ЗАПРЕЩЕНО использовать `.flat(Infinity)` на массивах детей

---

## 2. COMPONENT FACTORY

**API — фабрика, а не класс.** `Component(definition)` возвращает конструктор с признаком `_definition`.

**Definition может содержать:**
- `name` (опционально) — имя компонента для логов ошибок
- `init()`, `render()`, `props()`, `memo()`, `context`, `onMounted()`, `onUpdated()`, `onUnmounted()`
- Пользовательские методы и свойства (копируются на instance, методы автобиндятся)

**State:** отсутствует. Все переменные — прямые мутабельные свойства на instance (`this._count`).

**Props:**
- Функция `props(incoming)` **опциональна**, по умолчанию `p => p`
- Если определена — результат в `this.props`
- Если не определена — `this.props = incoming`
- Должна быть **чистой функцией** (может вызываться несколько раз)

**Children (React-подход):**
- Движок автоматически добавляет `children` в объект `incoming` перед вызовом `props()`
- `children` может быть vnode, массивом, `null`, строкой или числом
- В `props()` разработчик деструктурирует: `{ title, children } = incoming`

**Пример: что приходит в `props()`:**
```javascript
props(incoming) {
    // incoming = { title: 'Hello', children: [...], ... }
    const { title, children, ...rest } = incoming;
    return { title: title.toUpperCase(), children, ...rest };
}
```

**Архитектурные ограничения:**
- **НЕТ двусторонних ссылок**: компонент хранит только `_vdom` (вниз), **не** обратную ссылку на vnode. Портал хранит `_rendered`, не vnode.
- **Блокировка rerender в `init()`**: если `init()` вызывает `update()`, rerender блокируется. Первый render — строго после `init()`.
- **`init()` вызывается только при первом создании instance**. При reconcile (повторном рендере компонента в том же месте с тем же `tag`) `init()` **не вызывается** — работает только `_rerender()`.

### Порядок инициализации

**При первом mount:**
1. Собираются incoming props (включая `children` из `childs`)
2. Вызывается `props(incoming)` → результат в `this.props`
3. Вызывается `init(props)` → может использовать `this.props`, устанавливает state
4. Первый `_rerender()` → `memo(props)` → `render(props)`
5. Вставка DOM в parent
6. `onMounted()` после вставки

**При update (от родителя или локально):**
1. `props(incoming)` → обновляет `this.props`
2. `memo(props)` → проверка зависимостей
3. Если совпадают → `render()` не выполняется, дети всё равно проходят цепочку
4. Если отличаются → `render(props)` → `onUpdated()`

**Важно:** `props()` должна быть **чистой функцией** от `incoming`. Она вызывается до `init()` при первом mount, поэтому не должна полагаться на instance state (`this._xxx`).

### Сигнатуры функций — props первым аргументом

Все ключевые функции жизненного цикла получают `this.props` как первый аргумент для удобства:

```javascript
Component({
    // При первом mount — для инициализации state
    init(props) {
        this._count = props.initialCount || 0;
    },

    // При каждом update — массив зависимостей
    memo(props) {
        return [props.value, this._count];
    },

    // Рендер — можно использовать деструктуризацию
    render({ title, items }) {
        return h('div', null, title, items.length);
    },

    // Обработка входящих props (опционально)
    props(incoming) {
        return { ...incoming, normalized: true };
    }
});
```

**Важно:** `this.props` по-прежнему доступен везде — аргумент это удобный shortcut.

---

## 3. DYNAMIC CONTEXT TREE

Свойство `context` — объект с функциями-геттерами.

**Методы:**
- `this.context(key, ...args)` — **всегда** к родителю (`_parentContext`)
- `this.contextSelf(key, ...args)` — сначала к себе, потом к родителю
- Если `contextSelf()` вызван рекурсивно из своего же геттера — движок бросает ошибку `contextSelf recursion`

**Распространение:** при рендере движок прокидывает `activeProvider` вниз. HTML-теги прозрачно передают ссылку.

**Пример распространения контекста:**
```javascript
// 1. Корень задаёт значение по умолчанию
const App = Component({
    context: {
        lang() { return 'en'; }  // провайдер для детей
    },
    render() { return h(Page, { lang: 'ru' }); }
});

// 2. Page переопределяет контекст из props или берёт у родителя
const Page = Component({
    props(incoming) { this.props = incoming; },
    context: {
        // Умный геттер: props → fallback к родителю
        lang() { return this.props.lang || this.context('lang'); }
    },
    render() { return h('div', { class: 'wrapper' }, h(Button)); }
});

// 3. Глубокий ребёнок запрашивает контекст у ближайшего провайдера
const Button = Component({
    render() {
        // context() идёт к родителю: Page (lang='ru') → App (lang='en')
        const lang = this.context('lang');  // → 'ru'
        return h('button', null, lang === 'ru' ? 'Нажми' : 'Click');
    }
});

// Дерево рендеринга:
// App                    context.lang → 'en'
//   └─ Page (lang='ru')  context.lang → props.lang || parent.lang → 'ru'
//       └─ div           прозрачная передача activeProvider
//           └─ Button    this.context('lang') → 'ru' ✓
```

### Pull-based контекст и memo()

Контекст — pull-based: компоненты читают значения через `this.context()` в `render()`. Нет автоматических подписок.

**Правило для разработчиков:**
Если компонент читает `this.context()` и использует `memo()`, рекомендуется включать контекстные значения в массив зависимостей:

```javascript
// ✅ ПРАВИЛЬНО: контекст включён в memo
const ThemedCard = Component({
    memo(props) {
        return [props.title, this.context('theme')];
    },
    render(props) {
        return h('div', { className: this.context('theme') }, props.title);
    }
});

// ❌ ОПАСНО: контекст не в memo — компонент "заморозится"
const BadCard = Component({
    memo(props) {
        return [props.title];  // theme НЕ включён
    },
    render(props) {
        return h('div', { className: this.context('theme') }, props.title);
    }
});
// При смене theme этот компонент не будет выполнять render(),
// но его дети — выполнят render() и получат новый theme
```

**Почему это работает:**
- При смене контекста родитель выполнит render()
- Дети проходят через свою цепочку (props → memo → render)
- Если контекст не в `memo()` — компонент может "заморозиться" при неизменных props

**Но:** дети этого компонента всё равно получат шанс перечитать контекст, даже если родитель "заморожен".

---

## 4. LIFECYCLE

- `init()` — один раз до первого рендера
- `onMounted()` — строго один раз после физической вставки в DOM (для порталов — когда `containerGetter` впервые вернул валидный узел)
- `onUpdated()` — **только** после реального вызова `render()` и применения к DOM. Если `memo()` заблокировал render — `onUpdated()` не вызывается
- `onUnmounted()` — перед удалением

---

## 5. UPDATE ENGINE

### Защита от рекурсии и batching

Движок обязан обеспечивать:
- **Защиту от повторного входа** в рендер (если уже внутри — игнорировать)
- **Защиту от вызова `update()` внутри `render()`** — выводить `console.error` с рекомендацией использовать прямое присваивание (`this.value = 22`)
- **Batching через microtask** (`Promise.resolve().then`) — множественные `update()` объединяются в один render

### Лимит вложенных обновлений (как в React)

- Лимит 50 итераций внутри одной задачи
- Счётчик сбрасывается **только** для новой задачи (когда очередь была пуста)
- **Критично:** счётчик **НЕ сбрасывается** если `update()` вызван во время обработки очереди (например, из `onUpdated()`). Иначе защита обходится через бесконечный цикл.
- При превышении — `console.error` с понятным сообщением, очистка очереди

### Изоляция ошибок

Каждый компонент в очереди обновлений обрабатывается в **своём `try/catch`**:
- Если компонент падает в `render()` — ошибка логируется, компонент пропускается
- Остальные компоненты в очереди продолжают обновляться
- В ошибке указывается имя компонента (`definition.name` или "Component")
- Ошибка **не** прерывает `flushBatch`

### `this.update(patch?)`

- Без аргументов → принудительное обновление
- С пустым объектом `{}` → эквивалентно `update()` (принудительное)
- С объектом → shallow comparison, `Object.assign(this, patch)` если есть отличия, иначе отмена
- Если внутри `init()` → применяется patch, но rerender блокируется

### memo() — защита render() текущего компонента

`memo()` блокирует `render()` **только для текущего компонента**. Дети (HTML и компоненты) всё равно проходят через свою цепочку `props → memo → render`.

| `memo()` вернул        | Компонент                 | Дети                |
|------------------------|---------------------------|---------------------|
| Те же зависимости      | ❌ render не выполняется  | ✅ проходят цепочку |
| Другие зависимости     | ✅ render выполняется     | ✅ проходят цепочку |
| Нет `memo()`           | ✅ render выполняется     | ✅ проходят цепочку |

**Следствие:** `memo()` НЕ создаёт "барьер" для pull-based контекста — дети-компоненты всегда получают шанс перечитать контекст через свою цепочку.

**Важно:** `onUpdated()` вызывается **только** если `memo()` разрешил render. Если `render()` не выполняется — `onUpdated()` не вызывается.

**Техническая реализация:**
Если `render()` не выполняется, компонент использует **старый vnode** (`newVdom = oldVdom`).
Это позволяет `reconcile()` продолжить обход детей по старому vnode-дереву,
давая каждому ребёнку шанс пройти свою цепочку.

### Цепочка обновления
1. Обновление `this.props` через `props(incoming)` (или `p => p`)
2. `memo(this.props)` → массив зависимостей
3. Сравнение с предыдущими зависимостями поэлементно через `===`
4. Совпадают → `render()` не выполняется, но **дети проходят свою цепочку** `props → memo → render`
5. Отличаются → `render()` + `onUpdated()`

### Первый рендер через `_rerender()`
- Первый render **обязан** идти через внутреннюю функцию обновления, а не напрямую через `render()`
- Это обеспечивает: `memo()` работает с первого рендера, `syncDOMChildren` не выполняется, `onUpdated()` не вызывается

---

## 6. REFS

`this.refs` — одновременно функция и объект.

**Использование:**
```javascript
h('input', { ref: this.refs('input') })     // HTML
h(Child, { ref: this.refs('child') })       // компонент
h(Portal(...), { ref: this.refs('portal') }) // портал

this.refs.input.focus();         // DOM-узел
this.refs.child.someMethod();    // instance компонента
this.refs.portal._container;     // instance портала
```

**Lifecycle refs:**
- **Mount:** `ref(node/instance)` — DOM-узел для HTML, instance для компонента, instance портала для портала
- **Unmount:** `ref(null)` — всегда
- **Update (тот же instance):** для HTML вызывается снова; для компонентов и порталов — не вызывается

Все коллекторы отрабатывают до `onMounted()`.

---

## 7. PORTALS WITH DEFERRED MOUNTING

`createPortal(children, containerGetter)` возвращает vnode с `tag: Symbol(Portal)`.

**Поведение:**
- Движок строит VDOM-детей и генерирует DOM-ноды в памяти (вызывается `init()`)
- Вызывается `containerGetter()`. Если вернул DOM-узел → физический монтаж (вызывается `onMounted()`). Если `null` → ожидание
- В основное дерево вставляется текстовый узел-якорь
- При каждом ререндере заново вызывается `containerGetter()`:
  - Контейнер появился → монтаж
  - Контейнер тот же → точечный дифф
  - Контейнер сменился → unmount старого + mount нового
  - Контейнер пропал → удаление детей
- При `onUnmounted` портала → удаление детей из контейнера и якоря из основного дерева

---

## 8. RECONCILIATION & GLOBAL KEYS

**Базовый diff:**
- Разные `tag` → уничтожение старого, создание нового
- Одинаковые HTML-теги → обновление атрибутов (плоское сравнение props)
- Одинаковые компоненты (проверяется через `tag._definition`) → сохранение instance, обновление `_parentContext`, пропсов, запуск `props() → memo()`
- `null` в VDOM → игнорируется при диффе

**Global Keys (в пределах одного render одного компонента):**
- Любой ключ уникален **в пределах одного render()**
- Движок держит Map для текущего render: `key → instance`
- При перемещении компонента между родителями **внутри одного render** instance сохраняется и физически переносится
- При следующем render Map пересоздаётся

**Система ключей:**
- Автоматические: `,0,1,2` (путь от корня через запятые, включая индексы массивов)
- Пользовательские: `#fio,5` (префикс `#`, ключ, запятая, индекс)
- Запятая в пользовательских ключах экранируется: `,` → `,,`
- Символ `#` не экранируется

**Пример дерева ключей:**
```javascript
h('B', null,
    h(X, { key: 'fio' },           // ключ: #fio, в Map: #fio → instanceX
        h('E'),                    // ключ: #fio,0
        h('Y')                     // ключ: #fio,1, в Map: #fio,1 → instanceY
    )
)
```
При переносе X в другое место ключи не меняются, инстансы сохраняются.

**Batch-вставка детей:**
- При вставке большого количества узлов использовать **batch-операции** (`prepend`) для минимизации reflow
- Для защиты от лимита аргументов функции использовать **чанки** (например, по 20 000)
- При batch-обработке с конца сохраняется правильный порядок
- ЗАПРЕЩЕНО: `DocumentFragment`, `document.createTextNode('')` для `null`

---

## 9. ATTRIBUTE HANDLING

Разработчик пишет атрибуты в camelCase. Движок конвертирует при применении к DOM.

**HTML:** `className → class`, `htmlFor → for`, `tabIndex → tabindex`, остальные camelCase → lowercase.

**SVG:** `viewBox` остаётся camelCase, `xlinkHref → xlink:href` (через `setAttributeNS`), остальные lowercase (`cx`, `cy`, `r`, `fill`, `stroke`) — как есть.

**События:** `onClick`, `onChange` и т.д. — через `addEventListener`.

**Специальные:**
- `data-*` и `aria-*` — остаются с дефисами
- `style` — объект → CSS-строка
- `dangerouslySetInnerHTML` — `{ __html: '...' }`

---

## 10. SVG NAMESPACE

SVG требует специальный namespace при создании элементов.

**Решение:** Namespace пробрасывается через всё дерево (строка: HTML, SVG, Math и т.д.):
- При встрече тега `svg` включается SVG-режим
- SVG наследуется всем потомкам (кроме `foreignObject`)
- `foreignObject` переключает детей обратно в HTML-режим
- Namespace сохраняется в instance компонента для будущих rerender

---

## 11. CONTROLLED FORMS

Для форм использовать **DOM property**, а не HTML-атрибуты (после ввода пользователя `setAttribute` не обновляет видимое значение).

**Контролируемые:**
- `value` на INPUT/TEXTAREA/SELECT — через `element.value`
- `checked` на INPUT — через `element.checked`
- `selected` на OPTION — через `element.selected`

**Специальные случаи:**

| Случай | Обработка |
|--------|-----------|
| **Textarea** | Игнорировать children, использовать только `value` |
| **Select multiple** | Обрабатывать массив значений через `option.selected` |
| **File input** | Read-only, игнорировать попытки записи `value` |

**Пересоздание при смене критических атрибутов:**
При изменении атрибутов, которые нельзя безопасно модифицировать у существующего элемента, элемент уничтожается и создаётся заново:
- `type` у `<input>` (text → password, text → file и т.д.)
- `multiple` у `<select>` (single ↔ multiple)
- `is` у custom elements

---

## 12. MOUNT — универсальная функция

`mount(input, container)` — единая точка входа для всех операций с деревом.

**Поведение:**
- Первый вызов с vnode → создаёт DOM и вставляет в container
- Повторный вызов с vnode → выполняет diff, применяет изменения к существующему DOM
- Вызов с `null` → размонтирует дерево (вызывает `onUnmounted()`, `ref(null)`)

**Поддерживаемые типы `input`:**
- **vnode** (объект с `tag`, `props`, `childs`) — используется как есть
- **Конструктор компонента** — оборачивается в `h(Component, {})`
- **Массив vnode** — оборачивается в `h(Fragment, {}, ...array)`
- **Строка/число** — оборачивается в текстовый узел
- **null/undefined** — размонтирует дерево

**Примеры:**
```javascript
import { h, Component, mount } from './core.js';

mount(App, container);                              // конструктор
mount(h(App, { theme: 'dark' }), container);       // vnode
mount([h('div', null, 'A'), h('div', null, 'B')], container);  // массив
mount('Hello World', container);                    // текст
mount(h(App, { theme: 'light' }), container);      // update
mount(null, container);                             // unmount
```

**Хранение состояния:** `WeakMap<container, vnode>` — позволяет не загрязнять DOM-объекты и автоматически очищать при удалении контейнера.

При `mount(null, container)` запись удаляется из `WeakMap`, что позволяет контейнеру быть garbage collected.

**Ограничения:**
- Один контейнер = одно дерево
- `onMounted()` вызывается только при первом mount

---

## 13. GLOBAL REFRESH

### refresh() — глобальное асинхронное обновление

**Импорт:**
```javascript
import { refresh } from './core.js';
```

**Сигнатура:**
```javascript
const time = await refresh();  // Promise<number> — время в миллисекундах
```

**Поведение:**
- Находит все корневые компоненты через `mountedTrees`
- Вызывает `update()` у каждого
- Возвращает `Promise`, который разрешается после завершения всех обновлений (включая вложенные)
- Значение — время от вызова `refresh()` до завершения всех render'ов

**Примеры:**

```javascript
import { refresh } from './core.js';

// Измерение производительности
store.items = processData(bigData);
const time = await refresh();
console.log(`Render: ${time.toFixed(2)}ms`);
if (time > 16) console.warn('Slow render');

// В тестах
test('renders user name', async () => {
    store.user = 'Alice';
    await refresh();
    expect(document.body.textContent).toContain('Alice');
});

// Интеграция с глобальным store
store.user = newUserData;
await refresh();  // все компоненты перечитают store
```

**Use cases:**
- Измерение производительности рендера
- Интеграция с глобальным state (store, singleton)
- Async тесты
- Профилирование slow renders

**Предупреждения:**
- Expensive operation — обновляет ВСЁ дерево
- Используйте когда нет более точечного способа обновления

---

## 14. GLOBAL STORE PATTERN

Компоненты могут читать данные из любых внешних источников (глобальный store, singleton, window). В этом случае компонент не имеет автоматической подписки — разработчик явно вызывает `refresh()` после изменения данных.

```javascript
// store.js
export const store = { count: 0 };

// App.js
import { h, Component, refresh } from './core.js';

const Counter = Component({
    render() {
        return h('div', null, 'Count: ', store.count);
    }
});

// Внешний триггер
store.count = 55;
await refresh();  // явный trigger
```

**Когда использовать:**
- Простые приложения без сложной архитектуры
- Интеграция с legacy кодом
- Когда не нужна fine-grained реактивность

**Когда НЕ использовать:**
- Большие приложения с множеством компонентов
- Когда нужна изоляция обновлений (лучше props/context)

---

## 📝 СТИЛЬ КОДА

- Отступ 4 пробела
- ES6 модули (`export { ... }`)
- Чистый JavaScript без внешних зависимостей
- Комментарии на русском языке только там, где это помогает пониманию логики

---

## 📖 ГАЙДЛАЙН ПО ТЕРМИНОЛОГИИ

Документация и комментарии к коду должны использовать **однозначную терминологию**, которая не теряет смысл при переводе на английский и обратно.

### ✅ Рекомендуемые формулировки

| Ситуация | RU формулировка | EN формулировка |
|----------|----------------|-----------------|
| render() выполнился | `render()` выполняется | `render()` is executed |
| render() не выполнился | `render()` не выполняется | `render()` is not executed |
| memo() остановил render | `memo()` заблокировал render | `memo()` blocked render |
| memo() пропустил render | `memo()` разрешил render | `memo()` allowed render |
| rerender не запущен | rerender блокируется | rerender is blocked |
| null в VDOM | `null` игнорируется | `null` is ignored |
| Lifecycle hook | `onUpdated()` (со скобками) | `onUpdated()` |

### ❌ Формулировки которых следует избегать

| Слово | Почему избегать | Пример проблемы |
|-------|-----------------|-----------------|
| **пропущен / пропуск** | Двусмысленно: "прошёл мимо" vs "не был выполнен" | "render пропущен" — читатель не поймёт выполнился он или нет |
| **подавлен** | Звучит как ошибка или аварийная ситуация | "rerender подавлен" — воспринимается как сбой |
| **подавление** | Носит негативный оттенок | "Подавление rerender" — звучит как workaround |
| **скип / скипнут** | Сленг, теряет смысл в формальной документации | "скипнуть render" — непрофессионально |

### 🌐 Проверка через перевод (EN ↔ RU)

При написании документации полезно мысленно перевести формулировку на английский и обратно. Если смысл сохраняется — термин удачен.

**Примеры удачных формулировок:**
- "render не выполняется" → "render is not executed" → "render не выполняется" ✅
- "memo() заблокировал render" → "memo() blocked render" → "memo() заблокировал render" ✅

**Примеры проблемных формулировок:**
- "render пропущен" → "render is skipped" → "render пропущен (мимо? или не сделан?)" ❌
- "rerender подавлен" → "rerender is suppressed" → "rerender подавлен" ⚠️ (звучит как ошибка)

### 💡 Общее правило

Используйте глаголы с **чёткой семантикой выполнения/невыполнения**:
- Выполняется / не выполняется
- Разрешён / заблокирован
- Выполнен / не выполнен

Это делает документацию профессиональной, однозначной и удобной для международной команды.