// Progressive enhancement for public pages: tabs, carousel, active nav link.
(() => {
  // Respect "reduce motion": autoplaying videos start paused (viewers can press play).
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('video[autoplay]').forEach(v => { v.removeAttribute('autoplay'); v.pause(); v.loop = false; });

  document.querySelectorAll('[data-tabs]').forEach(root => {
    const tabs = [...root.querySelectorAll('[role=tab]')];
    const panels = [...root.querySelectorAll('[role=tabpanel]')];
    const select = (i, focus) => {
      tabs.forEach((t, j) => { t.setAttribute('aria-selected', j === i); t.tabIndex = j === i ? 0 : -1; });
      panels.forEach((p, j) => { p.hidden = j !== i; });
      panels[i].querySelectorAll('video').forEach(v => { if (!v.autoplay) v.pause(); });
      if (focus) tabs[i].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i));
      t.addEventListener('keydown', e => {
        const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (k) { e.preventDefault(); select((i + k + tabs.length) % tabs.length, true); }
      });
    });
  });

  document.querySelectorAll('[data-carousel]').forEach(root => {
    const track = root.querySelector('.track');
    root.querySelectorAll('.cbtn').forEach(b => b.addEventListener('click', () => {
      const slide = track.querySelector('.slide');
      track.scrollBy({ left: Number(b.dataset.dir) * (slide.offsetWidth + 20), behavior: 'smooth' });
    }));
    track.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * track.querySelector('.slide').offsetWidth, behavior: 'smooth' });
    });
  });

  const links = [...document.querySelectorAll('.links a')];
  if (links.length && 'IntersectionObserver' in window) {
    const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { links.forEach(a => a.classList.remove('on')); map.get(e.target.id)?.classList.add('on'); }
    }), { rootMargin: '-35% 0px -60% 0px' });
    map.forEach((_, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
  }
})();
