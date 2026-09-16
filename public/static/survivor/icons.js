// Functional line symbols for ability controls, rather than tiny illustrations.
const PATHS={
 bounce:'<path d="m4 24 9-15 8 14 7-17"/><path d="m22 6 6-1 2 6"/><circle cx="4" cy="24" r="2"/>',
 pierce:'<path d="M3 16h25m-6-6 6 6-6 6M11 7v18m8-18v18"/>',
 split:'<path d="M3 16h10m0 0L26 5m-13 11h15m-15 0 13 11"/><circle cx="27" cy="5" r="2"/><circle cx="28" cy="16" r="2"/><circle cx="27" cy="27" r="2"/>',
 giant:'<circle cx="17" cy="16" r="10"/><path d="M12 10a7 7 0 0 1 7-1M2 13h3m-4 6h4"/>',
 orbit:'<ellipse cx="16" cy="16" rx="13" ry="9" transform="rotate(-35 16 16)"/><circle cx="16" cy="16" r="3"/><circle cx="6" cy="22" r="3" fill="currentColor"/>',
 meteor:'<path d="m13 19 15-15M8 17 21 4m-6 20 14-14"/><circle cx="10" cy="23" r="6"/>',
 blast:'<path d="m16 2 3 8 8-4-4 9 7 3-9 3 2 9-7-6-8 5 2-9-8-4 9-2-1-9Z"/>',
 frost:'<path d="M16 2v28M4 9l24 14M4 23 28 9M12 5l4 4 4-4m-8 22 4-4 4 4M4 14l6-2-1-6m14 0-1 6 6 2M4 18l6 2-1 6m14 0-1-6 6-2"/>',
 shield:'<path d="m16 3 11 4v9c0 6-5 10-11 13C10 26 5 22 5 16V7Z"/><path d="m11 16 4 4 7-8"/>',
 heal:'<path d="M16 28 5 17C-3 9 9-1 16 8c7-9 19 1 11 9Z"/><path d="M16 12v10m-5-5h10"/>',
 magnet:'<path d="M6 5v12a10 10 0 0 0 20 0V5h-6v12a4 4 0 0 1-8 0V5ZM6 10h6m8 0h6"/>',
 speed:'<path d="m15 4 9 12-9 12m-5-18 5 6-5 6M2 8h5M1 16h5M2 24h5"/>',
 ricochet:'<path d="m3 23 9-16 8 17 9-15m-6-1 6 1-1 6M18 4l-1 3m7-6-2 3M29 3l-3 2"/><circle cx="12" cy="7" r="3"/>',
 army:'<path d="M2 16h26m-5-5 5 5-5 5M5 7h17m-4-4 4 4-4 4M5 25h17m-4-4 4 4-4 4"/>',
 blizzard:'<ellipse cx="16" cy="16" rx="14" ry="10" transform="rotate(-30 16 16)"/><path d="M16 7v18m-8-14 16 10M8 21l16-10"/>',
 comet:'<circle cx="11" cy="22" r="8"/><path d="m9 13 9-10m0 17L29 7M18 10l8-8M22 23l8-8"/>',
};
export function iconSvg(id){return `<svg class="ability-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[id]||PATHS.giant}</svg>`;}
