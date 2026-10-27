Motion primitives adapted from **Amicro** (MIT, https://github.com/Subhan-code/Amicro--Micro-transitions-):
fade-up, scroll-reveal, tilt-card, blur-text, card-cover-flow and the spring presets.

Copied as source (their recommended "you own the code" install) instead of the
`@subhanhq/amicro` npm package, which pulls in unrelated runtime dependencies
(express, @google/genai, vite 6). Only `motion` is a real dependency.
Respect for reduced motion comes from `<MotionConfig reducedMotion="user">` in App.tsx.
