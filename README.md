<center>
  <img src="logo.svg" alt="Logo" width="220">
</center>

# Tyaff — VDOM library for JavaScript

The project is experimental — testing a new approach to memo(), the ability to move elements between parents, mutable data handling, and the capabilities of modern AI in solving complex tasks.

## Key differences from React

- **`memo()` blocks only the current component** — children continue their own update chains independently, making optimization predictable
- **Mutable data from any source** — a component can read a global store, singleton, or `window` directly, without props drilling
- **Pull-based context without Provider/Consumer** — any component declares itself a provider via `context: { key() { ... } }`, children request values via `this.context(key)`
- **Props as first argument** — signatures like `init(props)`, `memo(props)`, `render({ title, items })` allow destructuring props right in the definition
- **Keys are unique across the entire render** — this allows moving components between different parents while preserving instance and state

## Main features

- **Compact and performant** — minimal API surface, custom diff/patch algorithm, batching updates via microtask
- **Optimized for bulk operations** — reverse, swap, reparenting faster than React
- **Dynamic context tree** — hierarchical provider system with automatic propagation through HTML tags
- **Factory-based components** — unified creation pattern, automatic method binding, flexible lifecycle
- **Portals with deferred mounting** —!mounting into arbitrary DOM containers with anchor nodes
- **Key system** — user-defined keys are unique across the entire render, automatic path-based keys
- **Fragment with key** — grouping children without wrapper with ability to move groups

## Installation

```bash
npm install tyaff
```

## Quick start

```javascript
import { h, Component, mount } from 'tyaff';

const Counter = Component({
    count: 0,

    increment() {
        this.update({ count: this.count + 1 });
    },

    render() {
        return h('div', null,
            h('p', null, 'Counter: ' + this.count),
            h('button', { onClick: this.increment }, '+')
        );
    }
});

mount(Counter, document.getElementById('app'));
```

## Example: components with context
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
        return h('button', { className: 'btn-' + theme }, 'Button');
    }
});

mount(
    h(ThemeProvider, null,
        h(ThemedButton)
    ),
    document.body
);
```

## Example: global store

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

// Update
store.count = 55;
await refresh();  // all components will re-read the store
```

## Resources

- **[Documentation](DOCS.md)** — full API description, usage examples, lifecycle, context, portals, optimizations
- **[Live example](example/index.html)** — interactive demo in the browser
- **[Memo demo](example/big-list-input.html)** — Tyaff vs React
- **[Benchmark](example/bench.html)** — performance comparison tyaff vs React (14 scenarios)
- **[Changelog](CHANGELOG.md)** — what's new in the project

## Acknowledgments

This project is a showcase of human-AI collaboration:

- **Human**: architecture, design decisions, code review, vision
- **Qwen**: development, optimization, documentation, visual design
- **GLM**: development, optimization
- **Gemini**: research and analysis (via Search)

## Browser Support

- Chrome 86+
- Firefox 78+
- Safari 14+
- All modern browsers with ES6 modules support

## License

MIT
