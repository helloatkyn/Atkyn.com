/* modules/news/news.css — Google News style */

.news-list {
  display: flex;
  flex-direction: column;
  padding: 0 0 32px;
}

/* ── Hero card (first) ── */
.news-hero {
  display: block;
  text-decoration: none;
  color: inherit;
  margin: 12px 12px 4px;
  border-radius: 16px;
  overflow: hidden;
  background: var(--color-bg);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.05);
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s ease;
}

.news-hero:active {
  transform: scale(0.98);
}

.news-hero-img {
  width: 100%;
  aspect-ratio: 16/9;
  object-fit: cover;
  display: block;
}

.news-hero-body {
  padding: 12px 14px 14px;
}

.news-hero .news-source {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
  display: block;
}

.news-hero .news-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text-strong);
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.news-hero .news-time {
  font-size: 12px;
  color: var(--color-text-subtle);
}

/* ── Divider between hero and list ── */
.news-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: 12px 0 4px;
}

/* ── Regular cards ── */
.news-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 14px;
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid var(--color-border-subtle);
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s ease;
}

.news-card:active {
  background: var(--color-press-light);
}

.news-card-body {
  flex: 1;
  min-width: 0;
}

.news-card .news-source {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.news-card .news-title {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--color-text-strong);
  margin-bottom: 5px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.news-card .news-time {
  font-size: 11.5px;
  color: var(--color-text-subtle);
}

/* ── Card thumbnail ── */
.news-thumb {
  flex-shrink: 0;
  width: 92px;
  height: 92px;
  border-radius: 12px;
  object-fit: cover;
  display: block;
  background: var(--color-bg-alt);
}

/* ── Empty ── */
.tab-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}

.tab-empty p {
  font-size: 14px;
  color: var(--color-text-subtle);
  margin: 0;
}

/* ── Skeleton ── */
.tab-skeleton {
  padding: 0;
  display: flex;
  flex-direction: column;
}

.sk-hero {
  margin: 12px 12px 4px;
  border-radius: 16px;
  overflow: hidden;
  background: var(--color-bg-alt);
}

.sk-hero-img {
  width: 100%;
  aspect-ratio: 16/9;
  background: var(--color-bg-alt);
}

.sk-hero-body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sk-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.sk-card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sk-thumb {
  flex-shrink: 0;
  width: 92px;
  height: 92px;
  border-radius: 12px;
  background: var(--color-bg-alt);
}

.sk-line {
  height: 13px;
  border-radius: 6px;
  background: var(--color-bg-alt);
}

.sk-line.sk-short { width: 55%; height: 11px; }
.sk-line.sk-src   { width: 35%; height: 10px; }

/* ── Dark mode ── */
@media (prefers-color-scheme: dark) {
  .news-hero {
    background: var(--color-bg-alt-dark);
    box-shadow: 0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05);
  }
  .news-hero .news-title  { color: var(--color-text-dark); }
  .news-hero .news-time   { color: var(--color-text-dark-faint); }
  .news-card              { border-bottom-color: var(--color-border-dark-subtle); }
  .news-card:active       { background: var(--color-press-dark); }
  .news-card .news-title  { color: var(--color-text-dark); }
  .news-card .news-time   { color: var(--color-text-dark-faint); }
  .news-thumb             { background: var(--color-bg-alt-dark); }
  .news-divider           { background: var(--color-border-dark-subtle); }
  .sk-hero, .sk-hero-img,
  .sk-thumb, .sk-line     { background: var(--color-bg-alt2-dark); }
  .sk-card                { border-bottom-color: var(--color-border-dark-subtle); }
}
