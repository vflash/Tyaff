<center>
  <img src="logo.svg" alt="Логотип" width="220">
</center>

# Tyaff — VDOM библиотека для JavaScript

Легковесная альтернатива React на чистом JavaScript (ES6+) с собственным виртуальным DOM и философией минимализма.

## Ключевые отличия от React

- **`memo()` блокирует только текущий компонент** — дети продолжают свою цепочку обновлений независимо, что делает оптимизацию предсказуемой
- **Мутабельные данные из любых источников** — компонент может читать глобальный store, singleton или `window` напрямую, без props drilling
- **Pull-based контекст без Provider/Consumer** — любой компонент объявляет себя провайдером через `context: { key() { ... } }`, дети запрашивают значения через `this.context(key)`
- **Props первым аргументом** — сигнатуры `init(props)`, `memo(props)`, `render({ title, items })` позволяют деструктурировать props прямо в определении
- **Ключи уникальны в пределах всего render** — это позволяет перемещать компоненты между разными родителями с сохранением instance и state

## Установка

```bash
npm install tyaff
```

## Быстрый старт

```javascript
import { h, Component, mount } from 'tyaff';

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

## Ресурсы

- **[Документация](DOCS.md)** — полное описание API, примеры использования, lifecycle, контекст, порталы, оптимизации
- **[Живой пример](example/index.html)** — интерактивное демо в браузере
- **[История изменений](CHANGELOG.md)** — что нового появилось в проекте

## Основные возможности

- **Компактный и производительный** — минимальный размер API, собственный diff/patch алгоритм, batching обновлений через microtask
- **Динамическое дерево контекстов** — иерархическая система провайдеров с автоматической передачей через HTML-теги
- **Компоненты на основе фабрик** — единый способ создания, автоматический биндинг методов, гибкий lifecycle
- **Порталы с отложенным монтированием** — монтирование в произвольный DOM-контейнер с якорными узлами
- **Система ключей** — пользовательские ключи уникальны в пределах всего render, автоматические ключи на основе пути
- **Fragment с key** — группировка детей без обёртки с возможностью перемещения групп

## Пример: компоненты с context

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

const ThemedButton = Component({
    render() {
        const theme = this.context('theme');
        return h('button', { className: 'btn-' + theme }, 'Кнопка');
    }
});

mount(
    h(ThemeProvider, null,
        h(ThemedButton)
    ),
    document.body
);
```

## Пример: глобальный store

```javascript
// store.js
export const store = { count: 0 };

// app.js
import { store } from './store.js';
import { h, Component, mount, refresh } from 'tyaff';

const Counter = Component({
    render() {
        return h('div', null, 'Count: ', store.count);
    }
});

mount(Counter, document.getElementById('app'));

// Обновление
store.count = 55;
await refresh();  // все компоненты перечитают store
```

## Browser Support

- Chrome 86+
- Firefox 78+
- Safari 14+
- Все современные браузеры с поддержкой ES6 modules

## Лицензия

MIT

