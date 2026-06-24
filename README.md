## 📄 README.md - Описание библиотеки

```markdown
# VDOM Library

Легковесная альтернатива React на чистом JavaScript (ES6+) с собственным виртуальным DOM, diff/patch алгоритмом и уникальными возможностями.

## Основные возможности

### 🎯 Компактный и производительный
- Минимальный размер API
- Собственный diff/patch алгоритм
- Делегирование событий для оптимизации
- Кеширование refs и обработчиков

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
- Якорные комментарии для стабильности
- Отложенная активация при появлении контейнера
- Автоматическая очистка при unmount

### 🔑 Система глобальных ключей
- Сохранение инстансов при перемещении
- Автоматические ключи на основе пути
- Пользовательские ключи с экранированием
- Map-based хранение инстансов

### 📦 Защита структуры детей
- Сохранение вложенности массивов
- Иерархическая генерация ключей
- Предотвращение сдвига индексов
- Стабильная идентификация элементов

## Установка

```javascript
import VDOM from './vdom-library.js';

const { h, Component, createPortal, Fragment, mount, patch, unmount } = VDOM;
```

## Публичный API

### h(type, props, ...children)
Создание VDOM узла.

**Параметры:**
- `type` - строка (HTML-тег), функция (компонент) или Symbol (Fragment/Portal)
- `props` - объект свойств (может быть null)
- `children` - дочерние элементы

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
- `definition` - объект с lifecycle методами, свойствами и пользовательскими методами

**Возвращает:** Конструктор компонента

**Структура definition:**
```javascript
{
  // Lifecycle методы (НЕ биндятся автоматически)
  init(),
  render(),
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
- `children` - VDOM дети
- `containerGetter` - функция, возвращающая DOM-элемент или null

**Возвращает:** VDOM узел с `tag: Symbol(Portal)`

**Пример:**
```javascript
createPortal(
  h('div', { className: 'modal' }, 'Содержимое'),
  () => document.getElementById('modal-root')
)
```

### Fragment
Symbol для создания фрагментов без обёртки.

**Пример:**
```javascript
h(Fragment, null,
  h('li', null, 'Item 1'),
  h('li', null, 'Item 2')
)
```

### mount(vnode, parentDOM)
Первоначальный монтаж VDOM дерева в DOM.

**Параметры:**
- `vnode` - корневой VDOM узел
- `parentDOM` - родительский DOM-элемент

**Возвращает:** Массив смонтированных DOM-узлов

### patch(oldVnode, newVnode, parentDOM)
Обновление VDOM дерева (diff/patch).

**Параметры:**
- `oldVnode` - предыдущее VDOM дерево
- `newVnode` - новое VDOM дерево
- `parentDOM` - родительский DOM-элемент

**Возвращает:** Обновлённый VDOM

### unmount(vnode)
Удаление VDOM дерева и вызов lifecycle методов.

**Параметры:**
- `vnode` - VDOM дерево для удаления

## Архитектура

### Виртуальный DOM
- Плоские объекты с `tag`, `props`, `childs`
- Сохранение вложенной структуры массивов
- Нормализация детей (null для falsy значений)

### Diff алгоритм
- Сравнение по `tag` и `key`
- Точечное обновление атрибутов
- Рекурсивная обработка детей
- Глобальные ключи для сохранения инстансов

### Event Delegation
- Один глобальный слушатель на тип события
- WeakMap для хранения обработчиков
- Автоматическая очистка при unmount
- Поддержка всплытия событий

### Lifecycle
- `init()` - инициализация (один раз)
- `props(incoming)` - нормализация пропсов
- `memo(props)` - зависимости для оптимизации
- `render()` - возврат VDOM
- `onMounted()` - после вставки в DOM
- `onUpdated()` - после обновления DOM
- `onUnmounted()` - перед удалением

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
// camelCase остаются camelCase
{ viewBox: '0 0 100 100' }
{ xlinkHref: '#icon' }   // → xlink:href="#icon"
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
- **Делегирование событий** - один слушатель вместо тысяч
- **WeakMap** - автоматическая очистка памяти
- **Кеширование refs** - одна функция на имя
- **Batch операции** - `prepend()` для массовой вставки
- **Memoization** - пропуск ненужных ререндеров

### Рекомендации
- Используйте `memo()` для оптимизации компонентов
- Избегайте создания объектов в `render()`
- Используйте ключи для списков
- Минимизируйте вложенность компонентов

## Совместимость

- ES6+ (ES2015 и выше)
- Современные браузеры
- WeakMap, Symbol, Array.from
- Без внешних зависимостей

## Лицензия

MIT
```

---

## 📄 EXAMPLES.md - Примеры использования

```markdown
# Примеры использования

## 1. Простой компонент

```javascript
import VDOM from './vdom-library.js';
const { h, Component, mount } = VDOM;

const HelloWorld = Component({
  render() {
    return h('div', { className: 'hello' },
      h('h1', null, 'Привет, мир!'),
      h('p', null, 'Это VDOM библиотека')
    );
  }
});

// Монтаж в DOM
mount(h(HelloWorld, null), document.body);
```

## 2. Компонент с состоянием

```javascript
const Counter = Component({
  // Пользовательское свойство
  count: 0,
  
  // Пользовательский метод (автобиндинг)
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

mount(h(Counter, null), document.getElementById('app'));
```

## 3. Пропсы и нормализация

```javascript
const Button = Component({
  // Нормализация пропсов
  props(incoming) {
    return {
      label: incoming.label || 'Нажми меня',
      type: incoming.type || 'button',
      disabled: incoming.disabled || false
    };
  },
  
  render() {
    return h('button', 
      { 
        type: this.props.type,
        disabled: this.props.disabled,
        onClick: this.props.onClick
      },
      this.props.label
    );
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
  
  init() {
    console.log('Инициализация компонента');
    this.intervalId = setInterval(() => {
      this.update({ count: this.count + 1 });
    }, 1000);
  },
  
  onMounted() {
    console.log('Компонент смонтирован');
    console.log('DOM доступен');
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

## 5. Memoization для оптимизации

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
  
  render() {
    console.log('Render вызван');
    const result = this.props.data.reduce((sum, item) => 
      sum + item * this.props.multiplier, 0
    );
    
    return h('div', null, 'Результат: ' + result);
  }
});

// Render будет вызван только при изменении длины массива или multiplier
```

## 6. Context (провайдеры)

```javascript
// Провайдер темы
const ThemeProvider = Component({
  context: {
    theme() {
      return this.props.theme || 'light';
    },
    
    toggleTheme() {
      const current = this.props.theme || 'light';
      const newTheme = current === 'light' ? 'dark' : 'light';
      this.update({ theme: newTheme });
    }
  },
  
  theme: 'light',
  
  render() {
    return h('div', { className: 'theme-provider' },
      h('button', { onClick: () => this.contextSelf('toggleTheme') },
        'Переключить тему'
      ),
      this.props.children
    );
  }
});

// Потребитель темы
const ThemedButton = Component({
  render() {
    // Получаем тему от родителя
    const theme = this.context('theme');
    
    return h('button', 
      { 
        className: 'btn-' + theme,
        onClick: this.props.onClick
      },
      this.props.children
    );
  }
});

// Использование
mount(
  h(ThemeProvider, { theme: 'dark' },
    h(ThemedButton, null, 'Кнопка с темой')
  ),
  document.body
);
```

## 7. Вложенный Context

```javascript
const UserProvider = Component({
  context: {
    user() {
      return this.props.user || null;
    },
    
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
    // Проверяем через contextSelf (сначала свой context, потом родитель)
    const isAdmin = this.contextSelf('isAdmin');
    
    if (!isAdmin) {
      return h('div', null, 'Доступ запрещён');
    }
    
    return h('div', { className: 'admin-panel' },
      'Админ-панель'
    );
  }
});

mount(
  h(UserProvider, { user: { name: 'John', role: 'admin' } },
    h(AdminPanel, null)
  ),
  document.body
);
```

## 8. Refs (ссылки на DOM)

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
        defaultValue: 'Кликни для выделения'
      }),
      h('button', { onClick: this.handleClick }, 'Выделить')
    );
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
          h('button', 
            { onClick: this.props.onClose },
            'Закрыть'
          )
        )
      ),
      () => document.getElementById('modal-root')
    );
  }
});

// HTML
// <div id="app"></div>
// <div id="modal-root"></div>

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
    { id: 1, text: 'Изучить VDOM', done: false },
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
            key: todo.id,  // Ключ для стабильной идентификации
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

## 11. Fragment (группировка без обёртки)

```javascript
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

// Использование в таблице
mount(
  h('table', null,
    h('tbody', null,
      h(TableRows, null)
    )
  ),
  document.body
);
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
      
      // Условный рендеринг
      this.showDetails ? 
        h('div', { className: 'details' },
          h('p', null, 'Это детализированная информация'),
          h('p', null, 'Здесь больше контента')
        ) : 
        null
    );
  }
});
```

## 13. Обработка событий с аргументами

```javascript
const ItemList = Component({
  items: ['Яблоко', 'Банан', 'Апельсин'],
  
  handleItemClick(item, index, event) {
    console.log('Клик на:', item, 'индекс:', index, 'событие:', event);
  },
  
  render() {
    return h('ul', null,
      this.items.map((item, index) =>
        h('li', 
          { 
            key: index,
            onClick: (e) => this.handleItemClick(item, index, e)
          },
          item
        )
      )
    );
  }
});
```

## 14. Формы с контролируемым вводом

```javascript
const Form = Component({
  formData: {
    name: '',
    email: ''
  },
  
  handleChange(field, value) {
    this.update({
      formData: {
        ...this.formData,
        [field]: value
      }
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

## 15. SVG компоненты

```javascript
const Icon = Component({
  render() {
    return h('svg', 
      { 
        viewBox: '0 0 24 24',
        width: 24,
        height: 24,
        fill: this.props.color || 'currentColor'
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

## 16. Анимации и transitions

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

## 17. Вложенные компоненты

```javascript
const Card = Component({
  render() {
    return h('div', { className: 'card' },
      h('h3', null, this.props.title),
      h('div', { className: 'card-body' },
        this.props.children
      )
    );
  }
});

const App = Component({
  render() {
    return h('div', { className: 'container' },
      h(Card, { title: 'Карточка 1' },
        h('p', null, 'Содержимое первой карточки'),
        h('button', null, 'Действие')
      ),
      h(Card, { title: 'Карточка 2' },
        h('p', null, 'Содержимое второй карточки')
      )
    );
  }
});
```

## 18. Динамическое обновление

```javascript
const DynamicList = Component({
  items: [],
  
  init() {
    this.update({ items: ['Item 1'] });
  },
  
  addItem() {
    this.update({
      items: [...this.items, 'Item ' + (this.items.length + 1)]
    });
  },
  
  removeItem(index) {
    this.update({
      items: this.items.filter((_, i) => i !== index)
    });
  },
  
  render() {
    return h('div', null,
      h('button', { onClick: this.addItem }, 'Добавить'),
      h('ul', null,
        this.items.map((item, index) =>
          h('li', { key: index },
            h('span', null, item),
            h('button', 
              { onClick: () => this.removeItem(index) },
              'Удалить'
            )
          )
        )
      )
    );
  }
});
```

## 19. dangerouslySetInnerHTML

```javascript
const HTMLContent = Component({
  render() {
    const htmlString = '<strong>Жирный</strong> и <em>курсив</em>';
    
    return h('div', {
      dangerouslySetInnerHTML: {
        __html: htmlString
      }
    });
  }
});
```

## 20. Обновление всего приложения

```javascript
let currentVnode = null;

const App = Component({
  count: 0,
  
  increment() {
    this.update({ count: this.count + 1 });
  },
  
  render() {
    return h('div', null,
      h('h1', null, 'Счётчик: ' + this.count),
      h('button', { onClick: this.increment }, '+')
    );
  }
});

// Первоначальный монтаж
currentVnode = h(App, null);
mount(currentVnode, document.getElementById('app'));

// При необходимости обновить всё приложение
// const newVnode = h(App, null);
// currentVnode = patch(currentVnode, newVnode, document.getElementById('app'));
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

// Запуск приложения
mount(h(TodoApp, null), document.getElementById('app'));
```

Эти примеры демонстрируют основные возможности библиотеки и могут быть использованы как основа для ваших проектов.
```

---

Готово! Создал два полных Markdown документа:

1. **README.md** - полное описание библиотеки с API, архитектурой и возможностями
2. **EXAMPLES.md** - 20 практических примеров использования от простых компонентов до полноценного Todo приложения

Вы можете скопировать содержимое каждого документа и сохранить в соответствующие файлы.