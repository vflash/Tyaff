<center>
  <img src="logo.svg" alt="Логотип" width="220">
</center>

# Tyaff — VDOM библиотека для JavaScript

Легковесная альтернатива React на чистом JavaScript (ES6+) с собственным виртуальным DOM и философией минимализма. Библиотека отходит от каноничной модели React там, где она кажется избыточной: вместо иммутабельности — прямая мутация состояния, вместо Provider/Consumer — прозрачный pull-based контекст, вместо чёрного ящика мемоизации — явные массивы зависимостей с точечным контролем над рендером.

**Ключевые отличия от React:**

- **`memo()` блокирует только текущий компонент** — принимает массив зависимостей и не выполняет `render()` только для себя. Дочерние компоненты продолжают свою цепочку обновлений независимо, что делает оптимизацию предсказуемой и не ломает работу контекста.

- **Мутабельные данные из любых источников** — компонент может читать глобальный store, singleton или `window` напрямую, без props drilling. Данные живут там, где им удобно, а компонент просто их потребляет.

- **Pull-based контекст без Provider/Consumer** — любой компонент объявляет себя провайдером через объект `context: { key() { ... } }`, а дети ниже по дереву запрашивают значения через `this.context(key)` по мере необходимости. Никаких обёрток и HOC.

- **Props первым аргументом** — сигнатуры `init(props)`, `memo(props)`, `render({ title, items })` позволяют деструктурировать props прямо в определении, делая код декларативным и компактным.

- **Ключи уникальны в пределах всего render** (а не только среди братьев, как в React) — это позволяет перемещать компоненты между разными родителями с сохранением instance и state.


## Основные возможности

### 🎯 Компактный и производительный
- Минимальный размер API
- Собственный diff/patch алгоритм
- Кеширование refs и обработчиков
- Batching обновлений через microtask

### 🔄 Динамическое дерево контекстов
- Иерархическая система провайдеров
- Методы `context()` и `contextSelf()`
- Автоматическая передача контекста через HTML-теги
- Защита от рекурсии

### 🏗️ Компоненты на основе фабрик
- Единый способ создания компонентов
- Автоматический биндинг пользовательских методов
- Локальное состояние и свойства
- Гибкий lifecycle

### 🚪 Порталы с отложенным монтированием
- Монтирование в произвольный DOM-контейнер
- Якорные текстовые узлы для стабильности
- Отложенная активация при появлении контейнера
- Автоматическая очистка при unmount

### 🔑 Система ключей (отличие от React)
- Пользовательские ключи уникальны в пределах всего render
- Сохранение instance при перемещении между разными родителями
- Автоматические ключи на основе пути
- Экранирование специальных символов

### 🧩 Fragment с key
- Группировка детей без обёртки (без key)
- Виртуальный instance для перемещения групп (с key)
- Сохранение состояния детей при перемещении группы

### 📦 Защита структуры детей
- Сохранение вложенности массивов
- Иерархическая генерация ключей
- Предотвращение сдвига индексов
- Стабильная идентификация элементов


## Установка

```javascript
import { h, Component, createPortal, Fragment, mount, refresh } from 'tyaff';
```


## Публичный API

### h(type, props, ...children)
Создание VDOM узла.

**Параметры:**
- `type` — строка (HTML-тег), функция (компонент) или Symbol (Fragment/Portal)
- `props` — объект свойств (может быть `null`)
- `children` — дочерние элементы

**Возвращает:** VDOM объект `{ tag, props, childs }`

**Пример:**
```javascript
h('div', { className: 'container' },
  h('h1', null, 'Заголовок'),
  h('p', null, 'Текст')
)
```

### Component(definition)
Фабрика для создания компонентов.

**Параметры:**
- `definition` — объект с lifecycle методами, свойствами и пользовательскими методами

**Возвращает:** Конструктор компонента (с маркером `_definition`)

**Структура definition:**
```javascript
{
  name: 'MyComponent',  // опционально, для логов ошибок

  // Lifecycle методы
  init(props),
  render(props),
  props(incoming),
  memo(props),
  onMounted(),
  onUpdated(),
  onUnmounted(),

  // Объект контекста
  context: {
    theme() { return 'light'; }
  },

  // Пользовательские методы (АВТОМАТИЧЕСКИ биндятся)
  increment() { this.count++; },

  // Пользовательские свойства (копируются на инстанс)
  count: 0,
  config: { theme: 'dark' }
}
```

### createPortal(children, containerGetter)
Создание портала для монтирования в произвольный DOM-контейнер.

**Параметры:**
- `children` — VDOM дети
- `containerGetter` — функция, возвращающая DOM-элемент или `null`

**Возвращает:** VDOM узел с `tag: Symbol(Portal)`

**Пример:**
```javascript
createPortal(
  h('div', { className: 'modal' }, 'Содержимое'),
  () => document.getElementById('modal-root')
)
```

### Fragment
Symbol для создания фрагментов. Поддерживает `key` prop для перемещения групп детей.

**Примеры:**
```javascript
// Простая группировка без overhead
h(Fragment, null,
  h('li', null, 'Item 1'),
  h('li', null, 'Item 2')
)

// Группа с key — можно перемещать, дети сохраняют instance
h(Fragment, { key: 'group-a' },
  h(Item, { key: 'i1' }),
  h(Item, { key: 'i2' })
)
```

### mount(input, container)
**Универсальная функция** — единая точка входа для mount, update и unmount.

**Поведение:**
- **Первый вызов** с vnode → создаёт DOM и вставляет в container
- **Повторный вызов** с vnode → выполняет diff, применяет изменения к существующему DOM
- **Вызов с `null`** → размонтирует дерево (выполняется `onUnmounted`, `ref(null)`)

**Поддерживаемые типы `input`:**
- **vnode** (объект с `tag`, `props`, `childs`)
- **Конструктор компонента** — оборачивается в `h(Component, {})`
- **Массив vnode** — оборачивается в `h(Fragment, {}, ...array)`
- **Строка/число** — оборачивается в текстовый узел
- **`null`/`undefined`** — размонтирует дерево

**Примеры:**
```javascript
// Первый mount
mount(App, container);
mount(h(App, { theme: 'dark' }), container);

// Массив
mount([h('div', null, 'A'), h('div', null, 'B')], container);

// Текст
mount('Hello World', container);

// Update
mount(h(App, { theme: 'light' }), container);

// Unmount
mount(null, container);
```

**Ограничения:**
- Один контейнер = одно дерево
- `onMounted()` выполняется только при первом mount

### refresh()
Глобальное асинхронное обновление всех примонтированных деревьев.

**Сигнатура:**
```javascript
const time = await refresh();  // Promise<number> — время в миллисекундах
```

**Поведение:**
- Находит все корневые компоненты
- Выполняет `update()` у каждого
- Возвращает `Promise`, который разрешается после завершения всех обновлений

**Use cases:**
- Измерение производительности рендера
- Интеграция с глобальным state (store, singleton)
- Async тесты
- Профилирование slow renders

**Пример:**
```javascript
store.items = processData(bigData);
const time = await refresh();
console.log(`Render: ${time.toFixed(2)}ms`);
if (time > 16) console.warn('Slow render');
```


## Архитектура

### Виртуальный DOM
- Плоские объекты с `tag`, `props`, `childs`
- Сохранение вложенной структуры массивов
- Текстовые узлы оборачиваются в объекты `{ _text: '...' }`
- `null` в VDOM игнорируется при диффе

### Diff алгоритм
- Сравнение по `tag` и `key`
- Точечное обновление атрибутов
- Рекурсивная обработка детей
- Ключи для сохранения instance при перемещении

### Lifecycle
- `init(props)` — инициализация (один раз при создании instance)
- `props(incoming)` — нормализация пропсов (чистая функция)
- `memo(props)` — массив зависимостей для оптимизации
- `render(props)` — возврат VDOM
- `onMounted()` — после вставки в DOM
- `onUpdated()` — после обновления DOM (только если render выполнен)
- `onUnmounted()` — перед удалением

### Update Engine
- Batching через microtask — множественные `update()` объединяются в один render
- Защита от рекурсии и бесконечных циклов (лимит 50 итераций)
- Изоляция ошибок — падающий компонент не ломает другие
- `memo()` блокирует только текущий компонент, дети продолжают цепочку


## Обработка атрибутов

### HTML-атрибуты
```javascript
// camelCase → lowercase
{ className: 'box' }     // → class="box"
{ htmlFor: 'input' }     // → for="input"
{ tabIndex: 0 }          // → tabindex="0"
```

### SVG-атрибуты
```javascript
// camelCase остаются camelCase или конвертируются
{ viewBox: '0 0 100 100' }           // → viewBox
{ xlinkHref: '#icon' }               // → xlink:href (через setAttributeNS)
{ preserveAspectRatio: 'xMidYMid' }  // → preserveAspectRatio
```

### Контролируемые формы
```javascript
// Используются DOM property, а не атрибуты
{ value: 'text' }       // → element.value
{ checked: true }       // → element.checked
{ selected: true }      // → element.selected
```

### Специальные атрибуты
```javascript
{
  style: { fontSize: '16px' },
  dangerouslySetInnerHTML: { __html: '<b>Bold</b>' },
  ref: this.refs('element')
}
```

### События
```javascript
{
  onClick: (e) => console.log(e),
  onChange: this.handleChange
}
```


## Производительность

### Оптимизации
- **Batching обновлений** — множественные `update()` в одной задаче объединяются
- **WeakMap** — автоматическая очистка памяти при удалении контейнеров
- **Кеширование refs** — одна функция на имя
- **Batch-вставка** — `prepend()` с чанками по 20 000 для больших деревьев
- **memo()** — блокировка ненужных ререндеров

### Рекомендации
- Используйте `memo()` для оптимизации компонентов
- Включайте контекстные значения в `memo()`, если компонент их использует
- Избегайте создания объектов в `render()`
- Используйте ключи для списков
- Минимизируйте вложенность компонентов


## Совместимость

- ES6+ (ES2015 и выше)
- Современные браузеры
- `WeakMap`, `Symbol`, `Promise`, `Array.from`
- Без внешних зависимостей


## Лицензия

MIT


---


# Примеры использования

## 1. Простой компонент

```javascript
import { h, Component, mount } from './core.js';

const HelloWorld = Component({
    render() {
        return h('div', { className: 'hello' },
            h('h1', null, 'Привет, мир!'),
            h('p', null, 'Это tyaff')
        );
    }
});

// Монтаж в DOM
mount(HelloWorld, document.body);
```

## 2. Компонент с состоянием

```javascript
const Counter = Component({
    count: 0,

    increment() {
        this.update({ count: this.count + 1 });
    },

    decrement() {
        this.update({ count: this.count - 1 });
    },

    render() {
        return h('div', null,
            h('span', null, 'Счётчик: ' + this.count),
            h('button', { onClick: this.decrement }, '-'),
            h('button', { onClick: this.increment }, '+')
        );
    }
});

mount(Counter, document.getElementById('app'));
```

## 3. Props первым аргументом

```javascript
const Button = Component({
    // Нормализация пропсов
    props(incoming) {
        const { label, type = 'button', disabled = false, onClick } = incoming;
        return { label, type, disabled, onClick };
    },

    // Деструктуризация прямо в сигнатуре
    render({ label, type, disabled, onClick }) {
        return h('button', { type, disabled, onClick }, label);
    }
});

// Использование
mount(
    h(Button, {
        label: 'Отправить',
        onClick: () => alert('Клик!')
    }),
    document.body
);
```

## 4. Lifecycle методы

```javascript
const Timer = Component({
    count: 0,
    intervalId: null,

    init(props) {
        console.log('Инициализация компонента');
        this.intervalId = setInterval(() => {
            this.update({ count: this.count + 1 });
        }, 1000);
    },

    onMounted() {
        console.log('Компонент смонтирован, DOM доступен');
    },

    onUpdated() {
        console.log('Компонент обновлён:', this.count);
    },

    onUnmounted() {
        console.log('Компонент будет удалён');
        clearInterval(this.intervalId);
    },

    render() {
        return h('div', null, 'Таймер: ' + this.count);
    }
});
```

## 5. memo() для оптимизации

```javascript
const ExpensiveComponent = Component({
    props(incoming) {
        return {
            data: incoming.data || [],
            multiplier: incoming.multiplier || 1
        };
    },

    // Зависимости для мемоизации
    memo(props) {
        return [props.data.length, props.multiplier];
    },

    render(props) {
        console.log('render() выполняется');
        const result = props.data.reduce((sum, item) =>
            sum + item * props.multiplier, 0
        );

        return h('div', null, 'Результат: ' + result);
    }
});

// render() выполняется только при изменении длины массива или multiplier
// Если зависимости совпадают — render() блокируется
```

## 6. Context (провайдеры)

```javascript
// Провайдер темы
const ThemeProvider = Component({
    theme: 'light',

    context: {
        theme() { return this.theme; },
        toggleTheme() {
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            this.update();
        }
    },

    render() {
        return h('div', { className: 'theme-provider' },
            h('button',
                { onClick: () => this.contextSelf('toggleTheme') },
                'Переключить тему'
            ),
            this.props.children
        );
    }
});

// Потребитель темы
const ThemedButton = Component({
    memo(props) {
        // ✅ Включаем контекст в зависимости
        return [this.context('theme')];
    },

    render() {
        const theme = this.context('theme');
        return h('button',
            { className: 'btn-' + theme },
            this.props.children
        );
    }
});

mount(
    h(ThemeProvider, null,
        h(ThemedButton, null, 'Кнопка с темой')
    ),
    document.body
);
```

## 7. Вложенный Context

```javascript
const UserProvider = Component({
    context: {
        user() { return this.props.user || null; },
        isAdmin() {
            const user = this.context('user');
            return user && user.role === 'admin';
        }
    },

    render() {
        return h('div', null, this.props.children);
    }
});

const AdminPanel = Component({
    render() {
        const isAdmin = this.contextSelf('isAdmin');

        if (!isAdmin) {
            return h('div', null, 'Доступ запрещён');
        }

        return h('div', { className: 'admin-panel' }, 'Админ-панель');
    }
});

mount(
    h(UserProvider, { user: { name: 'John', role: 'admin' } },
        h(AdminPanel, null)
    ),
    document.body
);
```

## 8. Refs (ссылки на DOM и компоненты)

```javascript
const InputFocus = Component({
    onMounted() {
        // DOM доступен после монтирования
        if (this.refs.input) {
            this.refs.input.focus();
        }
    },

    handleClick() {
        if (this.refs.input) {
            this.refs.input.select();
        }
    },

    render() {
        return h('div', null,
            h('input', {
                ref: this.refs('input'),
                type: 'text',
                value: 'Кликни для выделения',
                readOnly: true
            }),
            h('button', { onClick: this.handleClick }, 'Выделить')
        );
    }
});

// Ref на компонент
const Parent = Component({
    onMounted() {
        this.refs.child.someMethod();  // вызов метода дочернего компонента
    },

    render() {
        return h(Child, { ref: this.refs('child') });
    }
});
```

## 9. Порталы

```javascript
const Modal = Component({
    render() {
        if (!this.props.visible) return null;

        return createPortal(
            h('div', { className: 'modal-overlay' },
                h('div', { className: 'modal-content' },
                    h('h2', null, this.props.title),
                    h('p', null, this.props.children),
                    h('button', { onClick: this.props.onClose }, 'Закрыть')
                )
            ),
            () => document.getElementById('modal-root')
        );
    }
});

const App = Component({
    showModal: false,

    toggleModal() {
        this.update({ showModal: !this.showModal });
    },

    render() {
        return h('div', null,
            h('button', { onClick: this.toggleModal }, 'Открыть модал'),
            h(Modal, {
                visible: this.showModal,
                title: 'Привет!',
                onClose: this.toggleModal
            }, 'Содержимое модального окна')
        );
    }
});
```

## 10. Списки с ключами

```javascript
const TodoList = Component({
    todos: [
        { id: 1, text: 'Изучить tyaff', done: false },
        { id: 2, text: 'Создать проект', done: false },
        { id: 3, text: 'Написать тесты', done: false }
    ],

    toggleTodo(id) {
        this.update({
            todos: this.todos.map(todo =>
                todo.id === id ? { ...todo, done: !todo.done } : todo
            )
        });
    },

    render() {
        return h('ul', null,
            this.todos.map(todo =>
                h('li',
                    {
                        key: todo.id,  // пользовательский ключ
                        onClick: () => this.toggleTodo(todo.id),
                        style: {
                            textDecoration: todo.done ? 'line-through' : 'none'
                        }
                    },
                    todo.text
                )
            )
        );
    }
});
```

## 11. Fragment

```javascript
// Простая группировка без обёртки
const TableRows = Component({
    render() {
        return h(Fragment, null,
            h('tr', null,
                h('td', null, 'Ячейка 1'),
                h('td', null, 'Ячейка 2')
            ),
            h('tr', null,
                h('td', null, 'Ячейка 3'),
                h('td', null, 'Ячейка 4')
            )
        );
    }
});

// Fragment с key — можно перемещать группу
const Tabs = Component({
    activeTab: 'a',

    switchTab(tab) {
        this.update({ activeTab: tab });
    },

    render() {
        return h('div', null,
            this.activeTab === 'a'
                ? h(Fragment, { key: 'group-a' },
                    h(Item, { key: 'i1' }),
                    h(Item, { key: 'i2' })
                )
                : h(Fragment, { key: 'group-b' },
                    h(Item, { key: 'i3' }),
                    h(Item, { key: 'i4' })
                )
        );
    }
});
```

## 12. Условный рендеринг

```javascript
const ConditionalRender = Component({
    showDetails: false,

    toggle() {
        this.update({ showDetails: !this.showDetails });
    },

    render() {
        return h('div', null,
            h('button', { onClick: this.toggle }, 'Показать детали'),

            this.showDetails
                ? h('div', { className: 'details' },
                    h('p', null, 'Это детализированная информация'),
                    h('p', null, 'Здесь больше контента')
                )
                : null
        );
    }
});
```

## 13. Контролируемые формы

```javascript
const Form = Component({
    formData: { name: '', email: '' },

    handleChange(field, value) {
        this.update({
            formData: { ...this.formData, [field]: value }
        });
    },

    handleSubmit(e) {
        e.preventDefault();
        console.log('Отправлено:', this.formData);
    },

    render() {
        return h('form', { onSubmit: this.handleSubmit },
            h('div', null,
                h('label', null, 'Имя:'),
                h('input', {
                    type: 'text',
                    value: this.formData.name,
                    onChange: (e) => this.handleChange('name', e.target.value)
                })
            ),
            h('div', null,
                h('label', null, 'Email:'),
                h('input', {
                    type: 'email',
                    value: this.formData.email,
                    onChange: (e) => this.handleChange('email', e.target.value)
                })
            ),
            h('button', { type: 'submit' }, 'Отправить')
        );
    }
});
```

## 14. SVG компоненты

```javascript
const Icon = Component({
    render({ color = 'currentColor' }) {
        return h('svg',
            {
                viewBox: '0 0 24 24',
                width: 24,
                height: 24,
                fill: color
            },
            h('path', {
                d: 'M12 2L2 22h20L12 2z'
            })
        );
    }
});

const Button = Component({
    render() {
        return h('button', { className: 'btn' },
            h(Icon, { color: 'blue' }),
            this.props.children
        );
    }
});
```

## 15. Global Store Pattern

```javascript
// store.js
export const store = { count: 0, user: null };

// App.js
import { h, Component, mount, refresh } from './core.js';
import { store } from './store.js';

const Counter = Component({
    render() {
        return h('div', null, 'Count: ', store.count);
    }
});

const UserProfile = Component({
    render() {
        return store.user
            ? h('div', null, 'User: ', store.user.name)
            : h('div', null, 'Not logged in');
    }
});

mount(
    h('div', null,
        h(Counter),
        h(UserProfile)
    ),
    document.getElementById('app')
);

// Внешнее обновление
async function updateCount() {
    store.count = 55;
    await refresh();  // явный trigger, все компоненты перечитают store
}
```

## 16. Анимации через style

```javascript
const AnimatedBox = Component({
    visible: true,

    toggle() {
        this.update({ visible: !this.visible });
    },

    render() {
        return h('div', null,
            h('button', { onClick: this.toggle }, 'Переключить'),
            h('div', {
                style: {
                    opacity: this.visible ? 1 : 0,
                    transition: 'opacity 0.3s ease',
                    width: '100px',
                    height: '100px',
                    backgroundColor: 'blue'
                }
            })
        );
    }
});
```

## 17. dangerouslySetInnerHTML

```javascript
const HTMLContent = Component({
    render() {
        const htmlString = '<strong>Жирный</strong> и <em>курсив</em>';
        return h('div', {
            dangerouslySetInnerHTML: { __html: htmlString }
        });
    }
});
```

## 18. Измерение производительности через refresh()

```javascript
async function loadData() {
    const bigData = await fetch('/api/data').then(r => r.json());
    store.items = processData(bigData);

    const time = await refresh();
    console.log(`Render time: ${time.toFixed(2)}ms`);

    if (time > 16) {
        console.warn('Slow render detected');
    }
}
```

## 19. Тестирование с refresh()

```javascript
test('renders user name after store update', async () => {
    mount(UserProfile, container);

    store.user = { name: 'Alice' };
    await refresh();

    expect(container.textContent).toContain('Alice');
});
```

## 20. Update через mount()

```javascript
const App = Component({
    count: 0,
    increment() { this.update({ count: this.count + 1 }); },
    render() {
        return h('div', null,
            h('h1', null, 'Счётчик: ' + this.count),
            h('button', { onClick: this.increment }, '+')
        );
    }
});

// Первоначальный mount
mount(App, document.getElementById('app'));

// При повторном вызове mount() с тем же контейнером
// выполняется diff и обновление существующего дерева
mount(h(App, { initialCount: 10 }), document.getElementById('app'));

// Unmount
mount(null, document.getElementById('app'));
```


## Полноценный пример: Todo приложение

```javascript
const TodoApp = Component({
    todos: [],
    inputValue: '',

    addTodo() {
        if (!this.inputValue.trim()) return;

        this.update({
            todos: [...this.todos, {
                id: Date.now(),
                text: this.inputValue,
                completed: false
            }],
            inputValue: ''
        });
    },

    toggleTodo(id) {
        this.update({
            todos: this.todos.map(todo =>
                todo.id === id
                    ? { ...todo, completed: !todo.completed }
                    : todo
            )
        });
    },

    deleteTodo(id) {
        this.update({
            todos: this.todos.filter(todo => todo.id !== id)
        });
    },

    render() {
        return h('div', { className: 'todo-app' },
            h('h1', null, 'Todo список'),

            h('div', { className: 'todo-input' },
                h('input', {
                    type: 'text',
                    value: this.inputValue,
                    onChange: (e) => this.update({ inputValue: e.target.value }),
                    onKeyPress: (e) => e.key === 'Enter' && this.addTodo()
                }),
                h('button', { onClick: this.addTodo }, 'Добавить')
            ),

            h('ul', { className: 'todo-list' },
                this.todos.map(todo =>
                    h('li', {
                        key: todo.id,
                        className: todo.completed ? 'completed' : ''
                    },
                        h('input', {
                            type: 'checkbox',
                            checked: todo.completed,
                            onChange: () => this.toggleTodo(todo.id)
                        }),
                        h('span', null, todo.text),
                        h('button',
                            { onClick: () => this.deleteTodo(todo.id) },
                            'Удалить'
                        )
                    )
                )
            ),

            h('div', { className: 'todo-stats' },
                'Всего: ' + this.todos.length + ', ',
                'Выполнено: ' + this.todos.filter(t => t.completed).length
            )
        );
    }
});

mount(TodoApp, document.getElementById('app'));
```

Эти примеры демонстрируют основные возможности библиотеки tyaff и могут быть использованы как основа для ваших проектов.

