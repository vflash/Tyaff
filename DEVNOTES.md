## 2026-07-19 — Исправлен Баг #1 (Portal + memo-skip)

### Проблема
При вызове `update()` на компоненте с `memo()`, когда render пропускается (memo-skip), порталы внутри компонента вызывали:
1. `ReferenceError: version is not defined` в `refreshMemoSubtree`
2. Пересоздание DOM-узлов портала (сателлит 1)
3. Зависание Promise при ошибке в render (сателлит 2)

### Корень проблемы
1. `refreshMemoSubtree` не принимала `keyMap` и `version` как параметры, но использовала их внутри
2. В Portal handling создавался новый `keyMap` вместо использования родительского
3. `version` определялась внутри `if (shouldRender)`, но использовалась в `else` ветке
4. `updateResolvers` не резолвились в `finally` блоке при ошибке

### Решение
1. Изменили сигнатуру `refreshMemoSubtree(vnode, keyMap, version, ctx, namespace, out)`
2. Убрали `const keyMap = new Map()` в Portal handling, используем родительский
3. Переместили `const version = ++reconcileVersion` и `keyMap._count = 0` до `if (shouldRender)`
4. Добавили резолв `updateResolvers` в `finally` блоке `_rerender`
5. В `refreshMemoSubtree` для Portal используем упрощённую логику (только проверка смены контейнера, без reconcile детей)

### Результат
Все 170 тестов проходят ✅

---

# DEVNOTES.md — Заметки для разработчиков

> **Для AI-агентов:** читай раздел "📍 Текущее состояние" первым — там что реально в коде.

## ⚠️ Правила работы с файлами

**Создание и удаление файлов — ТОЛЬКО с одобрения пользователя!**

- Все изменения в коде должны соответствовать SPEC.md
- Документация (README, DOCS, SPEC, CHANGELOG) — зона AISEC, не трогать
- AIDEV работает с: `src/core.js`, `DEVNOTES.md`, `AIDEV.md`, `tests/`
- Перед изменением кода изучить SPEC.md и этот файл

---

## ⚠️⚠️ ВАЖНО О МИКРО-БЕНЧМАРКАХ

**Микро-бенчмарки могут врать.** Это не теория — это подтверждённый факт.

### Примеры когда микро-бенчмарки вводили в заблуждение:

1. **"keyMap.get/set стоит 0.4ms на 5000"** — микро-бенчмарк показал 0.4ms.
   В реальном коде это не подтвердилось как узкое место. Откат fast path
   (if keyMap) не дал видимого эффекта. **Помогло: не помогло.**

2. **"Symbol на instance медленнее строк"** — тест создавал `Symbol()` на каждый
   объект (уникальный). Наш код использует shared Symbol константы (`const _X = Symbol()`).
   При правильном тесте — паритет. **Помогло: не помогло (тест был неверный).**

3. **"Прототип быстрее замыканий"** — микро-бенчмарк показал -33% на создание.
   В реальном bench.html — разница в шуме. **Помогло: не помогло.**

4. **"buildIncomingProps дорогой"** — микро-бенчмарк показал 0.1ms.
   Упростили — не дало эффекта. **Помогло: не помогло.**

5. **"if (keyMap) fast path для первого mount"** — микро-бенчмарк показал что
   keyMap.set на пустом Map дешевле. В реальном коде — сломало update, откатили.
   **Помогло: не помогло (ломает поведение).**

### Правило:
**Если микро-бенчмарк показывает "X стоит Y ms" — не верь. Проверяй в реальном bench.html.**
Только реальный bench (с DOM, с V8 в реальном контексте) даёт правдивые цифры.

---

## 📍 Текущее состояние кода

### Архитектура reconcile2
- **Однопроходный** алгоритм с `out`-параметром (не возвращает, заполняет переданный массив)
- **Инкрементальный keyMap** — персистентный на instance, без populateKeyMap
- **cleanup с keyMap.delete** — удаляет неиспользуемые элементы
- **duplicate keys** — первый выигрывает, остальные path-based UID, warning в dev
- **_HAS_CHILD_COMPS флаг** — skip refreshMemoSubtree для leaf-компонентов
- **NO_ACTUAL_UIDS заглушка** — на первом mount в prod, не аллоцируем Set
- **callRefs убран** — ref инлайн в reconcile2*
- **triggerMounted через mountedQueue** — сбор во время reconcile2, вызов после
- **try/catch только в DEV** — PROD fail fast

### Структура instance
- **Symbol константы** для внутренних полей (_DEF, _VDOM, _NODES, _KEY_MAP, ...)
- ComponentClass конструктор — фиксированные поля (V8 hidden class стабилен)
- Пользовательские методы — `val.bind(this)` в конструкторе через `for...in`
- `attachInstanceAPI` — 6 замыканий (_rerender, update, _scheduleUpdate, refs, context, contextSelf)

### Оптимизации h()
- In-place мутация children (не создаём normalized массив)
- `props || {}` (не false)
- `c == null` проверка для null/undefined

### bench.html
- 16 сценариев, median + min
- tyaff использует массив (не spread) — честное сравнение с React
- Кнопка ONE (warmup=0, runs=1) для исследований
- benchMax.html — tyaff vs React vs Preact vs Solid vs Vue

---

## 📊 Производительность (bench.html, min значения)

> ⚠️ Цифры колеблются от запуска к запуску. min — лучший случай, median — типичный.
> Сравнивай min с min, median с median. Не смешивай.

### tyaff vs React (16 сценариев)

| Сценарий | tyaff min | React min | Лучший | Заметка |
|---|---|---|---|---|
| Mount 5000 rows | 24.1 | 24.9 | **tyaff** | паритет, иногда React |
| Update 1 of 5000 | 3.1 | 1.2 | React 2.6x | React bailout |
| Reverse 5000 | 9.2 | 36.2 | **tyaff 3.9x** | keyMap + инкрементальный |
| Swap first/last | 9.1 | 35.1 | **tyaff 3.9x** | keyMap |
| Mount 5000 components | 37.1 | 30.2 | React 1.2x | конструктор + attachAPI |
| Deep tree 100 | 4.6 | 4.7 | паритет | |
| Move between parents | 0.2 | 0.3 | **tyaff 1.5x** | keyMap |
| Move heavy | 0.6 | 1.4 | **tyaff 2.3x** | keyMap |
| Clear + remount | 15.7 | 38.9 | **tyaff 2.5x** | fast unmount |
| Update all 5000 | 7.3 | 6.1 | React 1.2x | |
| Insert middle | 3.6 | 2.2 | React 1.6x | |
| Insert comp mid | 6.4 | 4.0 | React 1.6x | overhead компонентов |
| Insert comp mid memo | 3.7 | 1.5 | React 2.5x | React.memo не вызывает функцию |
| Memo skip | 3.6 | 1.0 | React 3.6x | React.memo не вызывает функцию |
| No memo | 6.6 | 3.5 | React 1.9x | overhead reconcile2 |
| Memo hit | 1.2 | 1.5 | **tyaff 1.3x** | наш memo быстрее |

**Счёт: 6 побед tyaff, 1 паритет, 9 React быстрее.**

### tyaff vs Solid (benchMax.html)
- Solid быстрее почти везде (fine-grained reactivity, не VDOM)
- tyaff конкурент на Move heavy (0.6 vs 0.6ms)
- tyaff быстрее React на reverse/swap (4x)

### Прогресс оптимизации Mount 5000 rows
```
Baseline:     44.4ms
После раунда 1: 29.6ms (-33%)
После раунда 2: 24.1ms (-46%)
```

---

## 🔧 Архитектурные решения

### Инкрементальный keyMap (убран populateKeyMap)

**Было:** populateKeyMap(oldVdom) перед reconcile2 — O(n) обход старого дерева.
**Стало:** keyMap персистентный, reconcile2 заполняет через keyMap.set, cleanup с delete.

**Почему:** populateKeyMap перестраивал keyMap каждый rerender — избыточно.
reconcile2 сам заполняет keyMap.set'ом. Cleanup удаляет неиспользуемые через delete.

**⚠️ Грабли:** Каждая функция-обработчик (reconcile2HTML, reconcile2Component,
reconcile2Fragment, reconcile2Portal) **ОБЯЗАНА** делать keyMap.set.
Если забыть — элемент не найдётся на следующем rerender, будет пересоздаваться.
Баг с textarea (дублирование) был именно из-за этого.

**Помогло:** Да, убрало O(n) обход, упростило логику.

### out-параметр в reconcile2

**Было:** reconcile2 возвращает массив DOM-узлов, caller делает Array.isArray + обёртку.
**Стало:** reconcile2 заполняет переданный out массив, не возвращает.

**Помогло:** Микро-улучшение. Убраны pushAll, Array.isArray, создание промежуточных массивов.

### _HAS_CHILD_COMPS флаг

**Идея:** Если в поддереве компонента нет дочерних компонентов (только HTML/text) —
пропускаем refreshMemoSubtree при memo-skip.

**Реализация:** В reconcile2 когда встречаем Component — поднимаем флаг на ctx.
В _doRerender (shouldRender path) — сбрасываем флаг перед reconcile2.
В memo-skip path — если флаг false, skip refreshMemoSubtree.

**Помогло:** Да, -0.4ms на Memo skip (4.0 → 3.6ms).

### callRefs убран

**Было:** O(n) обход дерева после mount, для каждого проверяет props.ref.
**Стало:** ref вызывается инлайн в reconcile2* после создания/переиспользования узла.

**Помогло:** Да, убрало O(n) обход. ~1ms экономии на Mount.

### triggerMounted через mountedQueue

**Было:** O(n) обход дерева после mount, ищет компоненты с !_isMounted.
**Стало:** reconcile2Component добавляет inst в mountedQueue. triggerMounted()
вызывает onMounted в обратном порядке (children-first).

**Помогло:** Да, убрало O(n) обход. ~1.6ms экономии на Mount.

### refresh() через rootInst.update()

**Было:** collectAllInstances — O(n) обход дерева, потом update() на каждом.
**Стало:** mountedRootInstances хранит корневой inst. refresh() вызывает update() на нём.

**Помогло:** Да, огромный буст. refresh() на Memo hit: 4.0ms → 1.1ms.

### mountedNodes (без collectDOMNodes)

**Было:** collectDOMNodes — O(n) обход старого дерева при повторном mount.
**Стало:** mountedNodes WeakMap хранит flat массив, переиспользуем.

**Помогло:** Да, убрало O(n) обход при повторном mount.

### Duplicate keys — первый выигрывает

**Было:** populateKeyMap перезаписывал — последний выигрывал. Но порядок зависел от обхода.
**Стало:** В reconcile2 — если actualUIDs.has(keyedUID) → duplicate, elementUID = path.
populateKeyMap — if (!keyMap.has(key)) keyMap.set (не перезаписывать).

**Помогло:** Да, решило проблему Tabs test (duplicate keys ломали рендер).

### Portal использует родительский keyMap

**Было:** inst._portalKeyMap — изолированный keyMap для детей портала.
**Стало:** Portal использует родительский keyMap/actualUIDs.

**Почему:** Portal — как компонент без своих элементов, только children.
Дети обрабатываются внешним reconcile2, cleanup делает родитель.

**Помогло:** Да, убрало дублирование логики, упростило код.

---

## ❌ Откаченные оптимизации (и почему)

### Итеративный reconcile2 (paintDOM)
**Что:** Явный стек задач вместо рекурсии.
**Результат:** Хуже. Аллокация task объектов, branching. V8 оптимизирует рекурсию лучше.
**Урок:** Рекурсия с out-параметром — оптимальна для V8.

### Прототип вместо замыканий
**Что:** Методы на ComponentClass.prototype вместо attachInstanceAPI замыканий.
**Результат:** В реальном bench — разница в шуме. Микро-бенчмарк показал -33%.
**Урок:** Микро-бенчмарк ≠ реальный код.

### if (keyMap) fast path для первого mount
**Что:** Передавать null вместо new Map() на первом mount.
**Результат:** Слóмало update. Множество if (keyMap) проверок усложнили код.
**Урок:** Оптимизация не должна ломать архитектуру.

### Inline syncDOMChildren для 1 child
**Что:** Skip вызова syncDOMChildren когда 1 child unchanged.
**Результат:** Проверка уже есть внутри syncDOMChildren. Inline не дал эффекта.
**Урок:** Не дублируй проверки.

### Fast path для oc === nc (та же ссылка на vnode)
**Что:** Если newVnode === oldVnode — skip reconcile.
**Результат:** Ломает context propagation. Компоненты всегда должны проходить reconcileComponent.
**Урок:** Спека важнее производительности.

---

## 🕵️ Найденные баги

### Bug: reconcile2HTML не делал keyMap.set в create-ветке
**Симптом:** Textarea дублировалась при вводе. Старый не удалялся, новый создавался.
**Причина:** В else-ветке (создание нового элемента) не было keyMap.set.
**Маскировка:** populateKeyMap перестраивал keyMap, баг не проявлялся.
**Фикс:** Добавили keyMap.set(path, vnode) в else-ветку.

### Bug: reconcile2Portal не делал keyMap.set в create-ветке
**Симптом:** Portal не находился при повторном mount, создавался новый.
**Причина:** Та же проблема — keyMap.set только в reuse-ветке.
**Фикс:** keyMap.set после if/else, для обоих путей.

### Bug: onUpdated не вызывался после render→null→render
**Симптом:** Если прошлый render вернул null, onUpdated не вызывался.
**Причина:** Использовали oldVdom как индикатор первого mount. oldVdom=null после render→null.
**Фикс:** Использовать _isMounted вместо oldVdom.

### Bug: _isRendering в memo-skip path был бесполезен
**Симптом:** try/finally вокруг refreshMemoSubtree сбрасывал _isRendering.
**Причина:** _isRendering на родителе не влияет на дочерние update() — те проверяют свой _isRendering.
**Фикс:** Убран try/finally и _isRendering в memo-skip path.

---

## 📋 TODO / Идеи для будущих оптимизаций

> ⚠️ Эти идеи **не проверены**. Микро-бенчмарки могут врать. Проверять в реальном bench.html.

1. **Shallow compare props до вызова _rerender** — как React.memo bailout.
   Проблема: props() трансформер мешает — нельзя сравнить raw props.
   Если props() не определён — можно. Если определён — вынуждены вызывать.

2. **Lazy _keyMap** — создавать new Map() только при первом update, не при mount.
   Экономит 5000 × new Map() при Mount components.

3. **Уменьшить замыкания в attachInstanceAPI** — 5 из 6 методов на прототип.
   _rerender оставить замыканием (нужен inst).

4. **Список дочерних компонентов** — вместо refreshMemoSubtree обхода.
   Хранить массив child instances на parent. При memo-skip — итерировать массив.
   Проблема: список нужно поддерживать актуальным при добавлении/удалении.

5. **Кэширование path prefix** — path + ',' делается один раз для массива.
   Уже сделано для массивов. Можно расширить для HTML children.

6. **Убрать for...in + .bind() из конструктора** — методы на прототип.
   Проблема: this теряется при передаче метода как callback.
   Решение: обёртка через apply(this) или пользователь использует стрелки.
