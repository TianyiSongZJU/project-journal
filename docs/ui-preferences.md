# Device-local UI preferences

Native windows use non-persistent web caches and the backend may select a new port after restart. Persistent presentation choices therefore belong in the local `/api/view-state` file, not in DOM properties, module variables or origin-scoped localStorage.

Version 2 adds `ui` to the existing page/scroll/timeline snapshot. `web/ui-preferences.js` owns the bounded, typed preference schema, list scopes, boolean flags and panel keys. `view-state.js` sanitizes it during restoration; project-specific folder panels belonging to deleted projects are discarded. The registry is restored before the first data render and sends changes directly to the existing serialized save queue, including controls whose click handlers stop propagation. The native close path awaits the queue and keeps the window open if preference saving fails.

Project lists use independent stable scopes for the project sidebar, review filter, record picker, inspector picker, timeline default picker and timeline row pickers. Only grouping, completed-section expansion and folded group names are stored. Search text and popup visibility stay transient. Recreated list nodes read their scope again, so re-rendering does not reset saved preferences. Settings and project fold panels use `bindPreferencePanel`; persistent panels are excluded from the generic outside-click menu dismissal handler. Month-view analytics popovers remain transient and do not overwrite the annual panel preference.

Existing synchronized preferences such as project ordering and year/month distribution grouping retain their existing storage. Client filters can migrate from native preferences or localStorage when no API snapshot exists; an explicit API snapshot, including an empty client list, takes precedence. Client comparison joins the timeline snapshot.

For a new presentation control, register its typed key in `ui-preferences.js`, read it before rendering, and write through the registry rather than storing only a DOM class. Extend the snapshot sanitizer for new timeline fields. Do not persist editor text, open menus, drag selections or destructive-action modes as presentation preferences.

Validation: `node --test tests/*.test.js`. The browser regression uses a separate temporary data directory and actual backend process; it recreates fresh browser contexts, restarts the backend on a new port, checks both desktop host styles, and verifies business state is unchanged. Run `JOURNAL_CORE=/path/to/test-core JOURNAL_PLAYWRIGHT_MODULE=/path/to/playwright node tests/ui-persistence.browser.cjs` from `src/` (Edge channel by default). No personal data directory is used.

时段回顾另保存 `timeReview`：起止日期、范围预设、`startHour`（0 或 8）、`colorMode`（投入或项目）、所选日期，以及图内横纵滚动位置。恢复时验证日期与 366 天上限；无效选择回到最近四周。`mode` 增加 `time`，只用于显示偏好，不改变业务数据结构。
