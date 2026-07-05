# DEVNOTES.md — Заметки для разработчиков

> **Для AI-агентов:** читай раздел "📍 Текущее состояние" первым — там что реально в коде.
> Если нужна конкретная тема — ищи в "📋 Содержание" по триггерам.

## ⚠️ Правила работы с файлами

**Создание и удаление файлов — ТОЛЬКО с одобрения пользователя!**

- Все изменения в коде должны соответствовать SPEC.md
- Документация (README, DOCS, SPEC, CHANGELOG) — зона AISEC, не трогать
- AIDEV работает с: `src/`, `DEVNOTES.md`, `AIDEV.md`, `tests/`
- Перед изменением кода изучить SPEC.md и этот файл

---


## 📍 Оптимизация reconcile2 — array path (2026-07-03)

### Контекст
Пользователь указал на узкое место в `reconcile2` для массивов: на каждой итерации аллоцируется массив, делается `push()` для каждого ребёнка.

### Что аллоцировалось в старом коде
1. `return []` для `vnode == null` — пустой массив на каждый null/false в children
2. `nodes.push(r[j])` — method call + capacity re-sizing (4→8→16→...→8192)
3. `r.length` в inner loop — property lookup на каждой итерации

### Фикс
- `const EMPTY = []` — шарится между вызовами для null/empty случаев (caller'ы только читают, проверено)
- `if (len === 0) return EMPTY` — short-circuit для пустых массивов
- `nodes[n++] = r[j]` — прямой индекс вместо `push()` (нет method call, нет capacity lookup)
- `const rlen = r.length` — кэш property lookup
- `nodes.length = n` в конце — trim если были null'ы

### Замеры (медиана из 3 прогонов, Node 22.22 + happy-dom)

| Сценарий | До | После | Эффект |
|---|---|---|---|
| mount 1000 rows | ~62ms | ~61ms | шум |
| **mount 5000 rows** | **~289ms** | **~212ms** | **−27%** |
| reverse 1000 rows | ~25ms | ~25ms | 0% |
| mount 1000 + null placeholders | ~7.5ms | ~7.8ms | шум |

### Урок
- Push method-call overhead и capacity re-sizing накапливаются только на больших N (5000+). На 1000 и меньше — в пределах шума.
- `new Array(len)` для pre-allocate не подходит — создал бы sparse (HOLEY) array, в V8 это медленнее packed. `[]` + direct index остаётся лучшим вариантом.
- EMPTY константа безопасна: проверил все caller'ы (`mount`, `_doRerender`, `reconcile2HTML`, `reconcile2Fragment`, `reconcile2Portal`) — только читают, не мутируют.

### Счёт vs React
Раньше Mount rows: 26.6ms (React 24.3ms) — React быстрее на 1.1x.
В браузере (bench.html) эффект может быть меньше чем в Node+happy-dom, но направление правильное. После следующего прогона bench.html — обновлю DEVNOTES с актуальным счётом.

### Локация фикса
- `const EMPTY = []` — строки 11-12
- `reconcile2` (array case) — строки 744-765
## 📍 Рефакторинг core.js — этапы 1, 3, 4 (2026-07-04)

### Контекст
Пользователь попросил аудит core.js на запутанность (не на скорость). Был большой рефакторинг reconcile, остались артефакты от старого подхода. Этап 2 (syncDOMChildren vs doc) отложен — doc устарел относительно реализации, обсудим отдельно.

### Этап 1 — Удаление мёртвого кода

**Поля instance, которые писались но нигде не читались:**
- `_cachedIncomingProps` — пишется в reconcile2Component (×2), нигде не читается
- `_cachedPropsVnode` — пишется в reconcile2Component (×2), нигде не читается
- `_isKeyedFragment` — пишется в reconcile2Fragment, нигде не читается
- `inst._mounted` — пишется в reconcilePortalChildren (×2) и в inst объекте reconcile2Portal, нигде не читается
- `inst._parentDOM` — пишется в Component ctor + reconcile2Component (×2) = всегда null, проверяется в условиях `if (inst._parentDOM)` — всегда false

**Мёртвые блоки удалены:**
- `if (!wasFirstRender && inst._parentDOM) { syncDOMChildren(...) }` в _doRerender (shouldRender path)
- `if (inst._parentDOM) { syncDOMChildren(...) }` в _doRerender (memo-skip path)

Эти блоки были наследием старого подхода, где компонент сам синхронизировал свои DOM-узлы. В новом подходе (reconcile2) это делает родитель через reconcile2HTML → syncDOMChildren, или mount → syncDOMChildren на верхнем уровне.

**Мёртвый параметр удалён:**
- `parentDOM` в `refreshMemoSubtree(vnode, parentDOM, ctx, namespace)` — только прокидывался в рекурсию, нигде не использовался для DOM-операций. Убран. Функция стала `refreshMemoSubtree(vnode, ctx, namespace)`.

### Этап 3 — Дедупликация

**reconcile2Component:**
Было: две ветки (reuse/create) с дублированием setup (buildIncomingProps, _parentContext, _namespace, vnode._instance, try/catch вокруг _rerender).
Стало: одна структура с `canReuse` флагом. Общий setup, условная инициализация (props/init/callRefs/triggerMounted только для create).

**reconcilePortalChildren:**
Было: три ветки, из которых "смена контейнера" и "тот же контейнер" почти идентичны (reconcile + cleanup + syncDOMChildren).
Стало: case 1 (первый mount) и case 2 (контейнер исчез) с ранним return. Case 3 — общий код для "контейнер есть", с условным перемещением узлов при смене контейнера.

**unmountVdom:**
Было: 4 копии логики "удалить DOM-узел из родителя" (`if (node?.parentNode) node.parentNode.removeChild(node)`) для text/HTML/Fragment/component, плюс особый случай для Portal (anchor + container nodes).
Стало: helper `removeDOMNode(node)`, используется везде. ref(null) вынесен наверх — общий для всех non-text узлов.

**applyProps (form-element логика):**
- Убран мёртвый блок `if (isFormElement && tag === 'SELECT' && 'multiple' in newProps)` — всегда no-op, потому что если multiple изменился, reconcile2HTML делает shouldRecreate и не доходит до applyProps.
- Убран `if (k === 'multiple' && tag === 'SELECT') continue;` в цикле — applyProp обработает, но не вызовется из-за shouldRecreate.
- Изменён `if (isFormElement)` → `if (isFormElement && tag !== 'SELECT')` для применения value/checked — SELECT value не применяется здесь, это делает reconcile2HTML после syncDOMChildren.
- Добавлен skip `if (tag === 'SELECT' && k === 'value') continue;` в цикле удаления — SELECT value не удаляем (поведение, которое раньше обеспечивалось фильтрацией в reconcile2HTML).
- В reconcile2HTML убрана фильтрация value для SELECT (5 строк) — теперь applyProps сам правильно обрабатывает SELECT value.

### Этап 4 — Мелочи

**`⚡` комментарии:** все 9 маркеров удалены в предыдущих этапах (они были без контекста "почему").

**`attachInstanceAPI` — inst vs this:**
Было: смесь `inst` (из замыкания) и `this` (из bound methods). `_doRerender(inst)` принимал inst как параметр.
Стало: везде `inst` из замыкания. `doRerender()` без параметра. Убран неиспользуемый `const def = inst._definition`.

**`isSelect` в reconcile2HTML:**
Было: `const isSelect` объявлен на 9 строк раньше использования, между ними `if (vnode.tag === 'textarea')` и `syncDOMChildren`.
Стало: `dom.tagName === 'SELECT'` проверяется inline в месте использования, с поясняющим комментарием.

**collectDOMNodes:** оставлен как есть. Объединение с populateKeyMap потребует архитектурного изменения — это не "мелочь".

### Размеры
- До: 45866 bytes, 1239 lines
- После: 44431 bytes, 1216 lines
- Экономия: 1435 bytes, 23 lines

### Тесты
Все этапы — 139/139 pass. Спека не нарушена.

### Что НЕ сделано (отложено)
- Этап 2 (syncDOMChildren vs doc-reconciliation.md) — пользователь сказал что doc устарел, обсудим отдельно.
