# Tyaff — документация

Легковесная VDOM библиотека для JavaScript с философией минимализма.

## Содержание

- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Компоненты](#компоненты)
- [Props и children](#props-и-children)
- [State и обновления](#state-и-обновления)
- [Lifecycle](#lifecycle)
- [memo() оптимизация](#memo-оптимизация)
- [Context](#context)
- [Refs](#refs)
- [Порталы](#порталы)
- [Ключи (keys)](#ключи-keys)
- [Атрибуты и события](#атрибуты-и-события)
- [Формы](#формы)
- [refresh() и global store](#refresh-и-global-store)
- [Production mode](#production-mode)
- [Известные ограничения](#известные-ограничения)

---

## Установка

```bash
npm install tyaff
```

```javascript
import { h, Component, mount, refresh } from 'tyaff';
```

---

## Быстрый старт

```javascript
import { h, Component, mount } from 'tyaff';

const Hello = Component({
    render() {
        return h('h1', null, 'Привет, мир!');
    }
});

mount(Hello, document.getElementById('app'));
```

**С компонентом с состоянием:**

```javascript
const Counter = Component({
    count: 0,

    increment() {
        this.update({ count: this.count + 1 });
    },

    render() {
        return h('div', null,
            h('p', null, 'Счётчик: ' + this.count),
            h('button', { onClick: this.increment }, '+')
        );
    }
});

mount(Counter, document.getElementById('app'));
```

---

## Компоненты

Компоненты создаются через фабрику `Component(definition)`:

```javascript
const MyComponent = Component({
    // Начальные значения state
    count: 0,
    items: [],

    // Пользовательские методы (автоматически привязаны к instance)
    increment() { this.count++; this.update(); },

    // Lifecycle методы
    init() { /* инициализация */ },
    onMounted() { /* после вставки в DOM */ },
    onUpdated() { /* после обновления */ },
    onUnmounted() { /* перед удалением */ },

    // Обязательный метод
    render() {
        return h('div', null, 'Content');
    }
});
```

**Важно:**
- Нет отдельного понятия "state" — все переменные это свойства instance
- Методы автоматически привязываются к `this`
- Lifecycle методы не привязываются автоматически

---

## Props и children

### Props первым аргументом

Все ключевые функции получают `this.props` как первый аргумент:

```javascript
const Card = Component({
    render({ title, text }) {
        return h('div', { className: 'card' },
            h('h2', null, title),
            h('p', null, text)
        );
    }
});

// Использование
h(Card, { title: 'Заголовок', text: 'Текст карточки' })
```

### Нормализация props

Опциональная функция `props()` позволяет трансформировать входящие данные:

```javascript
const Button = Component({
    props(incoming) {
        return {
            label: incoming.label || 'Нажми',
            type: incoming.type || 'button',
            disabled: Boolean(incoming.disabled)
        };
    },

    render({ label, type, disabled }) {
        return h('button', { type, disabled }, label);
    }
});
```

### Children

Дети передаются как `children` в props:

```javascript
const Container = Component({
    render({ title, children }) {
        return h('div', { className: 'container' },
            h('h1', null, title),
            h('div', { className: 'content' }, children)
        );
    }
});

// Использование
h(Container, { title: 'Мой контейнер' },
    h('p', null, 'Параграф 1'),
    h('p', null, 'Параграф 2')
)
```

---

## State и обновления

### Прямая мутация

Все переменные — мутабельные свойства на instance:

```javascript
const Counter = Component({
    count: 0,
    items: [],

    add() {
        this.items.push('Новый элемент');  // прямая мутация
        this.count++;
        this.update();  // уведомить о изменениях
    }
});
```

### update()

```javascript
// Принудительное обновление
this.update();

// С патчем
this.update({ count: this.count + 1 });

// Возвращает Promise<boolean>
const changed = await this.update({ count: 10 });
if (changed) {
    console.log('Данные изменились');
}
```

**После `await update()` визуал гарантированно актуален.**

### Правила update()

| Вызов | Возвращает |
|-------|-----------|
| `update()` | `true` (принудительный render) |
| `update({})` | `false` (пустой патч) |
| `update(patch)` с изменениями | `true` |
| `update(patch)` без изменений | `false` |

---

## Lifecycle

### Порядок вызова при первом mount

1. `props(incoming)` — нормализация props
2. `init(props)` — инициализация state
3. `memo(props)` — вычисление зависимостей
4. `render(props)` — создание VDOM
5. `onMounted()` — после вставки в DOM

### Порядок вызова при update

1. `props(incoming)` — обновление props
2. `memo(props)` — проверка зависимостей
3. `render(props)` — создание VDOM (только если memo разрешил)
4. `onUpdated()` — после обновления DOM

### Доступ к this

Все ключевые методы имеют доступ к instance:

```javascript
Component({
    props(incoming) { /* this доступен */ },
    init(props) { /* this доступен */ },
    memo(props) { /* this доступен */ },
    render(props) { /* this доступен */ }
});
```

### Пример с lifecycle

```javascript
const Timer = Component({
    count: 0,
    intervalId: null,

    init() {
        this.intervalId = setInterval(() => {
            this.update({ count: this.count + 1 });
        }, 1000);
    },

    onMounted() {
        console.log('Компонент смонтирован');
    },

    onUnmounted() {
        clearInterval(this.intervalId);
    },

    render() {
        return h('div', null, 'Таймер: ' + this.count);
    }
});
```

---

## memo() оптимизация

`memo()` блокирует render только для текущего компонента. Дети всегда проходят свою цепочку обновлений.

### Базовое использование

```javascript
const ExpensiveList = Component({
    memo(props) {
        // render выполнится только при изменении items
        return [props.items.length];
    },

    render({ items }) {
        return h('ul', null,
            items.map(item => h('li', { key: item.id }, item.text))
        );
    }
});
```

### С внутренним state

```javascript
const Counter = Component({
    count: 0,

    memo(props) {
        // Зависимости от props и state
        return [props.value, this.count];
    },

    render(props) {
        return h('div', null, props.value, this.count);
    }
});
```

### С context

Если компонент читает context и использует memo, включите context в зависимости:

```javascript
const ThemedCard = Component({
    memo(props) {
        return [props.title, this.context('theme')];
    },

    render(props) {
        return h('div', { className: this.context('theme') }, props.title);
    }
});
```

### Важно

`memo()` блокирует render **только для текущего компонента**. Дети всегда проходят свою цепочку `props → memo → render`, даже если родитель защищён memo().

---

## Context

Pull-based контекст без Provider/Consumer.

### Создание провайдера

```javascript
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
        return h('div', null, this.props.children);
    }
});
```

### Использование context

```javascript
const ThemedButton = Component({
    render() {
        const theme = this.context('theme');
        return h('button', { className: 'btn-' + theme }, 'Кнопка');
    }
});

// Монтирование
mount(
    h(ThemeProvider, null,
        h(ThemedButton)
    ),
    document.body
);
```

### Методы

- `this.context(key)` — получить значение от родителя
- `this.contextSelf(key)` — получить значение от себя или родителя

### Переопределение context

Дочерний компонент может переопределять context:

```javascript
const Page = Component({
    context: {
        lang() { return this.props.lang || this.context('lang'); }
    },

    render() {
        return h('div', null, this.props.children);
    }
});
```

---

## Refs

`this.refs` — одновременно функция и объект.

### Использование

```javascript
const InputFocus = Component({
    onMounted() {
        this.refs.input.focus();
    },

    render() {
        return h('div', null,
            h('input', { ref: this.refs('input'), type: 'text' }),
            h('button', { onClick: () => this.refs.input.select() }, 'Выделить')
        );
    }
});
```

### Ref на компонент

```javascript
const Parent = Component({
    onMounted() {
        this.refs.child.someMethod();
    },

    render() {
        return h(Child, { ref: this.refs('child') });
    }
});
```

### Lifecycle refs

- **Mount:** `ref(node/instance)` вызывается
- **Unmount:** `ref(null)` вызывается
- **Update:** для HTML — вызывается снова; для компонентов — не вызывается

---

## Порталы

Монтирование в произвольный DOM-контейнер.

```javascript
const Modal = Component({
    render() {
        if (!this.props.visible) return null;

        return createPortal(
            h('div', { className: 'modal' },
                h('h2', null, this.props.title),
                h('button', { onClick: this.props.onClose }, 'Закрыть')
            ),
            () => document.getElementById('modal-root')
        );
    }
});

// HTML
// <div id="app"></div>
// <div id="modal-root"></div>
```

### Отложенное монтирование

Если контейнер ещё не существует, портал ожидает:

```javascript
createPortal(
    children,
    () => document.querySelector('.dynamic-container')  // может вернуть null
)
```

---

## Ключи (keys)

### Отличие от React

В React ключ уникален среди братьев. В tyaff — **среди всех элементов в render**.

Это позволяет перемещать элементы между разными родителями с сохранением instance и state.

### Два типа ключей

**User key** (элемент с `key` prop):
```javascript
h(Component, { key: 'fio' }, ...)  // идентификатор: #fio
```

**Automatic key** (элемент без `key` prop):
- Формируется на основе позиции в дереве
- Элемент пересоздаётся при изменении порядка

### Примеры

```javascript
// Список с ключами
h('ul', null,
    items.map(item =>
        h('li', { key: item.id }, item.text)
    )
)

// Перемещение между родителями
h('div', null,
    h(Component, { key: 'card' }, ...)  // можно переместить
)
```

### Fragment с key

Fragment с key позволяет перемещать группы детей:

```javascript
h(Fragment, { key: 'group-a' },
    h(Item, { key: 'i1' }),
    h(Item, { key: 'i2' })
)
```

---

## Атрибуты и события

### HTML атрибуты (camelCase → lowercase)

```javascript
h('div', {
    className: 'box',      // → class="box"
    htmlFor: 'input',      // → for="input"
    tabIndex: 0            // → tabindex="0"
})
```

### События

```javascript
h('button', {
    onClick: (e) => console.log(e),
    onChange: this.handleChange
})
```

### Style

```javascript
h('div', {
    style: { fontSize: '16px', backgroundColor: 'red' }
})
```

### dangerouslySetInnerHTML

```javascript
h('div', {
    dangerouslySetInnerHTML: { __html: '<b>Bold</b>' }
})
```

### SVG

```javascript
h('svg', {
    viewBox: '0 0 24 24',
    width: 24,
    height: 24
},
    h('path', { d: 'M12 2L2 22h20L12 2z' })
)
```

---

## Формы

### Контролируемые поля

Используйте DOM property, а не атрибуты:

```javascript
const Form = Component({
    formData: { name: '', email: '' },

    handleChange(field, value) {
        this.update({
            formData: { ...this.formData, [field]: value }
        });
    },

    render() {
        return h('form', null,
            h('input', {
                type: 'text',
                value: this.formData.name,
                onChange: (e) => this.handleChange('name', e.target.value)
            }),
            h('input', {
                type: 'email',
                value: this.formData.email,
                onChange: (e) => this.handleChange('email', e.target.value)
            })
        );
    }
});
```

### Select multiple

```javascript
h('select', {
    multiple: true,
    value: this.selected,  // массив
    onChange: (e) => {
        const values = Array.from(e.target.selectedOptions, opt => opt.value);
        this.update({ selected: values });
    }
},
    options.map(opt => h('option', { value: opt }, opt))
)
```

---

## refresh() и global store

### refresh()

Глобальное обновление всех примонтированных деревьев:

```javascript
const time = await refresh();  // время в миллисекундах
console.log(`Render: ${time.toFixed(2)}ms`);
```

### Global Store Pattern

Компоненты могут читать данные из глобального store:

```javascript
// store.js
export const store = { count: 0, user: null };

// App.js
import { store } from './store.js';
import { refresh } from 'tyaff';

const Counter = Component({
    render() {
        return h('div', null, 'Count: ', store.count);
    }
});

// Обновление
store.count = 55;
await refresh();  // все компоненты перечитают store
```

---

## Production mode

### setDevMode()

Переключение между development и production:

```javascript
import { setDevMode } from 'tyaff';

if (process.env.NODE_ENV === 'production') {
    setDevMode(false);
}
```

**Development mode (по умолчанию):**
- Проверка дубликатов ключей
- Изоляция ошибок компонентов
- Подробные сообщения

**Production mode:**
- Отключение проверок
- Максимальная производительность

**Важно:** В production ошибки в компонентах могут сломать весь batch обновлений.

---

## Известные ограничения

### Условный рендер

Используйте `&&` внутри обёртки:

```javascript
// ✅ Правильно
render() {
    return h('div', null,
        this.show && h('span', null, 'content')
    );
}

// ❌ Не рекомендуется
render() {
    return this.show ? h('div', null, 'text') : null;
}
```

### Большие списки (>10K элементов)

Используйте виртуализацию (рендер только видимых элементов).

### Геттеры

Геттеры из definition не копируются на instance. Используйте методы или вычисляйте в `render()`.

---

## API Reference

### Экспортируемые функции

```javascript
export {
    h,              // Создание VDOM узла
    Component,      // Фабрика компонентов
    createPortal,   // Создание портала
    Fragment,       // Fragment символ
    mount,          // Монтаж в DOM
    refresh,        // Обновление всех компонентов
    setDevMode      // Переключение dev/production режима
};
```

### h(type, props, ...children)

Создание VDOM узла.

### Component(definition)

Фабрика для создания компонентов.

### mount(input, container)

Универсальная функция для mount, update и unmount.

### refresh()

Глобальное асинхронное обновление.

### setDevMode(isDev)

Переключение режима разработки.

