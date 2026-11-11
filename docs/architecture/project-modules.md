# Renderer module loading

`app/renderer/index.html` owns classic-script loading. The project controllers register factories before `boot.js` instantiates them; they do not access editor state during script evaluation. `tools/checks/check-structure.js` verifies the required ordering.

## Project controllers

- `snapshots`: canonical dirty snapshots, detached captures, media embedding and encoding cache.
- `document`: save/open pickers, handle permissions, validation and error handling.
- `safety`: discard and session-video confirmation dialogs with focus handling.
- `lifecycle`: document identity, revisions, warning/file baselines, restoration and close coordination.
- `recovery`: debounced durable copies and cleanup fencing.
- `recovery-ui`: startup session chooser, editing gate and accessible status.

See [Project lifecycle and recovery](project-recovery.md) for behavior and IPC contracts.

## Script order

1. `assets/fonts/local-fonts.manifest.js`
2. `src/fonts/coverage-loader.js`
3. `assets/stickers/stickers.manifest.js`
4. `src/fonts/compatibility.js`
5. `src/fonts/local-fonts/families.js`
6. `src/fonts/local-fonts/bootstrap.js`
7. `src/utils/uid.js`
8. `src/images/effects.js`
9. `src/images/effects-runtime.js`
10. `src/project/serialization.js`
11. `src/project/validation.js`
12. `src/history/stack.js`
13. `src/text/wrapping.js`
14. `src/bubbles/hit-testing.js`
15. `src/bubbles/duplication.js`
16. `src/bubbles/saved-styles.js`
17. `src/bubbles/outline.js`
18. `src/selection-hit-test-utils.js`
19. `src/color-sampler-utils.js`
20. `src/tails/outline.js`
21. `src/tails/curve.js`
22. `src/media/mediabunny-loader.js`
23. `src/media/gif.js`
24. `src/media/video.js`
25. `src/media/mp4-export.js`
26. `src/media/mp4-finalize.js`
27. `src/i18n/locales/en.js`
28. `src/i18n/locales/es.js`
29. `src/i18n/locales/zh-hans.js`
30. `src/i18n/locales/ja.js`
31. `src/i18n/locales/id.js`
32. `src/i18n/locales/de.js`
33. `src/i18n/locales/fr.js`
34. `src/i18n/locales/ru.js`
35. `src/i18n/locales/uk.js`
36. `src/i18n/index.js`
37. `src/ui/themes.js`
38. `src/ui/dock-layouts.js`
39. `src/ui/dock-controller.js`
40. `src/ui/startup.js`
41. `src/project/snapshots.js`
42. `src/project/document.js`
43. `src/project/safety.js`
44. `src/project/lifecycle.js`
45. `src/project/recovery.js`
46. `src/project/recovery-ui.js`
47. `src/selection/alignment-geometry.js`
48. `src/selection/alignment-controller.js`
49. `src/selection/alignment-overlay.js`
50. `src/boot.js`
51. `src/ui/tool-buttons.js`

Bubble movement guides are documented in [alignment-guides.md](alignment-guides.md).
