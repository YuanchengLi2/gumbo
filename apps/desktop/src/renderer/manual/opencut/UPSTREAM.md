# OpenCut interaction code

Source: https://github.com/opencut-app/opencut-classic
Pinned commit: cf5e79e919144200294fb9fed22a222592a0aeea
License: MIT; original notice included in OpenCut-LICENSE.txt and the desktop distribution.

Files retain their upstream selection, snapping, grouped resize, ruler, coordinate and zoom algorithms. Changes are import rewrites and a compatibility layer for Dream's frame rates, tick units and constant-speed retiming. Dream's timeline-to-operation adapter and all editor layout/components are original; OpenCut's UI, persistence and WASM editor are not embedded.

Upstream paths are the corresponding paths below apps/web/src/. The main OpenCut repository points to Classic as its current working editor while the Rust rewrite proceeds.
